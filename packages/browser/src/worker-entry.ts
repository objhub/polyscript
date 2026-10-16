/**
 * PolyScript Web Worker entry point.
 *
 * Runs PolyScriptEngine inside a Web Worker to avoid blocking the UI thread.
 * Communicates with the main thread via postMessage.
 *
 * Usage: new Worker(new URL('@polyscript/browser/worker-entry', import.meta.url), { type: 'module' })
 */

import { PolyScriptEngine } from './index.js';
import type { BuildOptions, BuildError } from './index.js';
import type { Diagnostic } from '@polyscript/core';
import { hasDistinctColors, shapeInfo } from '@polyscript/core/ocp-kernel';
import type { ColorPart, ShapeInfo } from '@polyscript/core/ocp-kernel';

let engine: PolyScriptEngine | null = null;

/** Noto Sans JP, shipped in this package (fonts/, SIL OFL 1.1). The same
 *  family the CLI prefers among system fonts, so text looks the same. */
const DEFAULT_FONT_URL = new URL('../fonts/NotoSansJP-Regular.otf', import.meta.url).href;

export interface WorkerRequest {
  id: number;
  type: 'init' | 'build' | 'export';
  /** init */
  wasmUrl?: string;
  /** init: the font `text` draws with. Default: the bundled Noto Sans JP. */
  fontUrl?: string;
  /** build */
  code?: string;
  buildOptions?: { overrides?: Record<string, unknown>; imports?: Record<string, string> };
  /** export */
  format?: 'stl' | 'step' | 'gltf' | 'brep';
}

/** One colored piece of the model. See MeshData in @polyscript/ui. */
export interface WorkerMeshPart {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  color?: [number, number, number];
  alpha?: number;
}

export interface WorkerMesh {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  /** CAD edges of the whole (fused) shape. */
  edgePoints?: Float32Array;
  /** Present only when the model has more than one color: the faces then
   *  live in the parts and the top-level arrays are empty. */
  parts?: WorkerMeshPart[];
  lines?: { positions: Float32Array; indices: Uint32Array };
}

export interface WorkerResponse {
  id: number;
  type: 'init' | 'build' | 'export';
  ok: boolean;
  /** build result */
  mesh?: WorkerMesh;
  color?: [number, number, number];
  volume?: number;
  /** B-Rep summary of the built shape (absent for non-solids). */
  info?: ShapeInfo;
  errors?: BuildError[];
  diagnostics?: Diagnostic[];
  params?: any[];
  parameterSets?: Record<string, Record<string, unknown>>;
  profile?: { entries: { name: string; values: Record<string, any> }[] };
  /** build wall-clock in ms: evaluation (parse through implicit union) and
   *  tessellation. */
  timing?: { evaluate: number; tessellate: number };
  /** kernel-call cache figures for this build (see memoizeKernel in core) */
  kernelCache?: { hits: number; misses: number; size: number };
  /** export result */
  data?: ArrayBuffer | string;
  filename?: string;
  mime?: string;
  /** error */
  error?: string;
}

// Current build shape (retained in worker for subsequent export calls)
let lastShape: any = null;
let lastParts: ColorPart[] = [];
let lastColor: [number, number, number] | undefined;

async function handleInit(req: WorkerRequest): Promise<WorkerResponse> {
  try {
    engine = await PolyScriptEngine.init({
      ...(req.wasmUrl ? { wasm: req.wasmUrl } : {}),
      // Resolved by the bundler as an asset next to the worker, like the
      // kernel's wasm; fetched only when a build uses `text`.
      font: req.fontUrl ?? DEFAULT_FONT_URL,
    });
    return { id: req.id, type: 'init', ok: true };
  } catch (e: any) {
    return { id: req.id, type: 'init', ok: false, error: e.message ?? String(e) };
  }
}

function handleBuild(req: WorkerRequest): WorkerResponse {
  if (!engine) {
    return { id: req.id, type: 'build', ok: false, error: 'Engine not initialized' };
  }
  try {
    const opts: BuildOptions = {};
    if (req.buildOptions?.overrides) opts.overrides = req.buildOptions.overrides;
    if (req.buildOptions?.imports) {
      const imports = req.buildOptions.imports;
      opts.importResolver = (path: string) => imports[path] ?? null;
    }

    const t0 = performance.now();
    const result = engine.build(req.code ?? '', opts);
    const evaluateMs = performance.now() - t0;

    if (!result.success) {
      lastShape = null;
      lastParts = [];
      lastColor = undefined;
      return {
        id: req.id,
        type: 'build',
        ok: false,
        errors: result.errors,
        params: result.params,
        parameterSets: result.parameterSets,
        profile: result.profile,
        kernelCache: result.kernelCache,
      };
    }

    lastShape = result.shape;
    lastParts = result.parts;
    lastColor = result.color;

    const t1 = performance.now();
    const mesh = result.shape ? tessellateResult(engine, result.shape, result.parts) : emptyMesh();
    if (result.lineMesh) {
      mesh.lines = result.lineMesh;
    }
    const tessellateMs = performance.now() - t1;
    // The whole B-Rep summary, not just the volume. A non-solid (an open wire,
    // a bare face) has no volume and shapeInfo throws; the viewer simply gets
    // nothing to show.
    let info: ShapeInfo | undefined;
    let volume: number | undefined;
    if (result.shape) {
      try {
        info = cachedShapeInfo(engine, result.shape);
        volume = info.volume;
      } catch {
        try { volume = engine.kernel.getVolume(result.shape); } catch { /* non-solid */ }
      }
    }
    return {
      id: req.id,
      type: 'build',
      ok: true,
      mesh,
      color: result.color,
      volume,
      info,
      errors: result.errors,
      diagnostics: result.diagnostics,
      params: result.params,
      parameterSets: result.parameterSets,
      profile: result.profile,
      timing: { evaluate: Math.round(evaluateMs), tessellate: Math.round(tessellateMs) },
      kernelCache: result.kernelCache,
    };
  } catch (e: any) {
    lastShape = null;
    lastParts = [];
    lastColor = undefined;
    return { id: req.id, type: 'build', ok: false, error: e.message ?? String(e) };
  }
}

/**
 * shapeInfo for a handle the kernel memo hands back unchanged.
 *
 * The summary (exact bbox, volume, area, sub-shape counts, BRepCheck validity)
 * cost 60-250ms per build on the examples, and on a rebuild whose result is
 * the same handle -- an unchanged model, a parameter put back -- every figure
 * is the same too. Handles are stable for as long as the memo holds them, so
 * the handle is the key. Bounded: the shapes a person cycles through while
 * editing are few, and an evicted entry just costs the recompute.
 */
const INFO_CACHE_MAX = 64;
const infoCache = new Map<number, ShapeInfo>();
function cachedShapeInfo(engine: PolyScriptEngine, shape: any): ShapeInfo {
  const key = shape as number;
  const hit = infoCache.get(key);
  if (hit) {
    infoCache.delete(key);
    infoCache.set(key, hit);
    return hit;
  }
  const info = shapeInfo(engine.kernel, shape);
  infoCache.set(key, info);
  if (infoCache.size > INFO_CACHE_MAX) infoCache.delete(infoCache.keys().next().value as number);
  return info;
}

/**
 * Run `fn` against a throwaway copy of `shape`, then release the copy.
 *
 * BRepMesh_IncrementalMesh writes its triangulation into the shape it meshes,
 * and BRepBndLib::Add -- behind getBoundingBox({ precise: false }), behind faceCenter, behind
 * every selector -- prefers that triangulation to the geometry when it is
 * there. So meshing the shape the memo holds moved face centres by up to
 * 0.06 on 07_keyboard_case, which changed the arguments of everything a
 * selector fed, which turned an all-hit rebuild (72/72, 9ms) into 41/72 and
 * 543ms -- and could pick a different face next time two centres are close.
 * A copy costs ~3ms and keeps the memoized geometry exactly as built.
 */
function withMeshCopy<T>(engine: PolyScriptEngine, shape: any, fn: (copy: any) => T): T {
  const kernel = engine.kernel;
  const copy = kernel.copy(shape);
  try {
    return fn(copy);
  } finally {
    kernel.release(copy);
  }
}

function emptyMesh(): WorkerMesh {
  return { positions: new Float32Array(0), normals: new Float32Array(0), indices: new Uint32Array(0) };
}

/**
 * A monochrome model is one mesh, exactly as before. A model whose parts
 * carry different colors is tessellated part by part (each part gets one
 * material in the viewer) under the edge outline of the fused shape, so
 * internal edges where parts meet are not drawn.
 */
function tessellateResult(engine: PolyScriptEngine, shape: any, parts: ColorPart[]): WorkerMesh {
  if (!hasDistinctColors(parts)) return withMeshCopy(engine, shape, (c) => engine.tessellate(c));
  const mesh = emptyMesh();
  mesh.edgePoints = engine.edgeSegments(shape);
  mesh.parts = parts.map((p) => ({
    ...withMeshCopy(engine, p.shape, (c) => engine.tessellate(c, { edges: false })),
    color: p.color,
    alpha: p.alpha,
  }));
  return mesh;
}

function handleExport(req: WorkerRequest): WorkerResponse {
  if (!engine || !lastShape) {
    return { id: req.id, type: 'export', ok: false, error: 'No shape to export' };
  }
  // A const for the closures below: TypeScript does not carry the narrowing
  // of a module-level `let` into a callback.
  const eng = engine;
  try {
    let data: Uint8Array | string;
    let filename: string;
    let mime: string;

    switch (req.format) {
      // STL and glTF mesh the shape on the way out; see withMeshCopy.
      case 'stl':
        data = withMeshCopy(eng, lastShape, (c) => eng.exportSTL(c));
        filename = 'model.stl';
        mime = 'application/octet-stream';
        break;
      case 'step':
        data = engine.exportSTEP(lastShape);
        filename = 'model.step';
        mime = 'application/STEP';
        break;
      case 'gltf': {
        // exportGLTF meshes each coloured part as well as the whole.
        const kernel = eng.kernel;
        const partCopies = lastParts.map((p) => ({ ...p, shape: kernel.copy(p.shape) }));
        try {
          data = withMeshCopy(eng, lastShape, (c) => eng.exportGLTF(c, { parts: partCopies, color: lastColor }));
        } finally {
          for (const p of partCopies) kernel.release(p.shape);
        }
        filename = 'model.glb';
        mime = 'model/gltf-binary';
        break;
      }
      case 'brep':
        data = engine.exportBREP(lastShape);
        filename = 'model.brep';
        mime = 'application/octet-stream';
        break;
      default:
        return { id: req.id, type: 'export', ok: false, error: `Unknown format: ${req.format}` };
    }

    const buffer = typeof data === 'string' ? data : data.buffer;
    return { id: req.id, type: 'export', ok: true, data: buffer as any, filename, mime };
  } catch (e: any) {
    return { id: req.id, type: 'export', ok: false, error: e.message ?? String(e) };
  }
}

// Catch errors inside the worker and log them from worker context
self.onerror = (msg, src, lineno, colno, error) => {
  console.error('[PolyWorker:inner] onerror:', msg, src, lineno, colno, error);
};

// Catch unhandled promise rejections inside the worker
self.addEventListener('unhandledrejection', (e) => {
  console.error('[PolyWorker:inner] unhandled rejection:', e.reason);
});

// Worker message handler
const ctx = globalThis as unknown as { onmessage: ((e: MessageEvent) => void) | null; postMessage: (msg: any, transfer?: Transferable[]) => void };
ctx.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const req = e.data;
  let resp: WorkerResponse;

  switch (req.type) {
    case 'init':
      resp = await handleInit(req);
      break;
    case 'build':
      try {
        await engine?.ensureFont(req.code ?? '');
        resp = handleBuild(req);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        resp = {
          id: req.id, type: 'build', ok: false, error: message,
          errors: [{ phase: 'evaluate', code: 'eval.error', message, hint: 'check that the font file is served next to the worker' }],
        };
      }
      break;
    case 'export':
      resp = handleExport(req);
      break;
    default:
      resp = { id: req.id, type: req.type, ok: false, error: `Unknown request type: ${req.type}` };
  }

  // Transfer typed arrays for zero-copy
  const transferables: Transferable[] = [];
  if (resp.mesh) {
    transferables.push(
      resp.mesh.positions.buffer,
      resp.mesh.normals.buffer,
      resp.mesh.indices.buffer,
    );
    if (resp.mesh.edgePoints) {
      transferables.push(resp.mesh.edgePoints.buffer);
    }
    for (const part of resp.mesh.parts ?? []) {
      transferables.push(part.positions.buffer, part.normals.buffer, part.indices.buffer);
    }
  }
  if (resp.data instanceof ArrayBuffer) {
    transferables.push(resp.data);
  }

  ctx.postMessage(resp, transferables);
};
