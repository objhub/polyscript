/**
 * PolyScript browser-friendly high-level API.
 *
 * Provides a single-entry-point {@link PolyScriptEngine} class that bundles
 * parsing, validation, evaluation, and BREP-centric shape access.
 *
 * The build() method returns an opaque Shape handle. Export and tessellation
 * are performed separately via dedicated methods, enabling a
 * "tessellate for preview, export on save" workflow.
 */

import { parse, ParseError, type Program } from '@polyscript/core';
import { validate } from '@polyscript/core';
import { Evaluator } from '@polyscript/core';
import { EvalError, drainDiagnostics } from '@polyscript/core';
import type { Diagnostic } from '@polyscript/core';
import { extractParams as _extractParams } from '@polyscript/core';
import type { ParamInfo, ParamSet } from '@polyscript/core';
import type { Profile } from '@polyscript/core';
import type { DiagnosticCode } from '@polyscript/core';
import { asDiagnosticCode } from '@polyscript/core';
import { initOC, memoizeKernel, setTextFont } from '@polyscript/core/ocp-kernel';
import {
  exportSTLBuffer,
  exportSTEPString,
  exportBREPString,
  importBREP as _importBREP,
  exportGLTFBuffer,
  tessellate as _tessellate,
  edgeSegments as _edgeSegments,
  colorParts,
} from '@polyscript/core/ocp-kernel';
import type { ExportOptions, TessellationMesh, TessellateOptions, ColorPart, KernelMemo, KernelMemoOptions, KernelMemoStats } from '@polyscript/core/ocp-kernel';
import type { OC, Shape, Wire, WpState } from '@polyscript/core/ocp-kernel';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface BuildOptions {
  /** Parameter override values (e.g. from a GUI slider). */
  overrides?: Record<string, unknown>;
  /** Raw JSON string containing parameter-set definitions. */
  paramsJson?: string;
  /** Resolve `import "path"` statements to source strings. */
  importResolver?: (path: string) => string | null;
}

export interface BuildResult {
  /** The produced Shape handle, or null on failure. */
  shape: Shape | null;
  /** Color hint from the source (RGB 0..1), if set. */
  color?: [number, number, number];
  /** The shape split by color (see colorParts in core). One part when the
   *  model is monochrome; pass to exportGLTF / tessellate per part. */
  parts: ColorPart[];
  /** Errors collected across all phases. A failed `assert` is here too, with
   *  phase 'assert', while the shape is still returned. */
  errors: BuildError[];
  /** Everything the run reported besides errors: kernel warnings, `print`
   *  lines (code `print`, severity info). Same records as `poly verify`. */
  diagnostics?: Diagnostic[];
  /** Declared @param annotations found in the source. */
  params: ParamInfo[];
  /** Named parameter sets declared in the source. */
  parameterSets: Record<string, Record<string, unknown>>;
  /** @profile presets extracted from source (undefined when absent). */
  profile?: Profile;
  /** True when a shape was successfully produced. */
  success: boolean;
  /** Tessellated polyline data for open wires (rendered as LineSegments). */
  lineMesh?: { positions: Float32Array; indices: Uint32Array };
  /** Kernel-call cache hits/misses for this build (see memoizeKernel in
   *  core). Absent when the engine was created with `memoize: false`. */
  kernelCache?: KernelMemoStats;
}

export interface BuildError {
  /** `assert`: an assertion in the model did not hold. The shape was still
   *  produced, so the viewer can show it next to the error. */
  phase: 'parse' | 'validate' | 'evaluate' | 'assert' | 'export';
  message: string;
  line?: number;
  column?: number;
  /** Stable diagnostic code (`selector.empty`, `context.invalid-op`, ...).
   *  Safe to key off; `message` is prose and may be reworded. */
  code?: DiagnosticCode;
  /** What to do about it. Kept apart from the message so a caller can show it
   *  in a tooltip, or drop it. */
  hint?: string;
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

export interface EngineOptions {
  /** URL or bytes of the WASM binary (browser). */
  wasm?: string | ArrayBuffer;
  /** Memoize kernel calls across builds so unchanged statements cost
   *  nothing on a rebuild. On by default; pass false for one-shot use, or
   *  options to size the cache. */
  memoize?: boolean | KernelMemoOptions;
  /** The font `text` draws with: a URL (fetched the first time a source
   *  uses `text`, see {@link PolyScriptEngine.ensureFont}) or the font's
   *  bytes. A browser has no system fonts to fall back on, so without one
   *  `text` is an error. The worker passes the bundled Noto Sans JP; any
   *  TrueType / OpenType file works (not WOFF2). */
  font?: string | URL | ArrayBuffer;
}

/** Does the source draw text? A cheap test: `text` as a word. A false
 *  positive only costs an early font download. */
export function usesText(source: string): boolean {
  return /\btext\b/.test(source);
}

export class PolyScriptEngine {
  private oc: OC;
  private memo: KernelMemo | null;
  /** The kernel the evaluator sees: memoized when enabled. */
  private evalOc: OC;

  /** Where to get the font, and the load in flight or done. */
  private font: string | URL | ArrayBuffer | undefined;
  private fontLoad: Promise<void> | null = null;

  private constructor(oc: OC, memo: KernelMemo | null, font?: string | URL | ArrayBuffer) {
    this.oc = oc;
    this.memo = memo;
    this.evalOc = memo?.oc ?? oc;
    this.font = font;
  }

  /**
   * Load the font before a build that draws text. `build()` is synchronous,
   * so the fetch happens here: call it with the source first (the worker
   * does). A source without `text` loads nothing -- the default font is a
   * 9.6MB file. Loads once; later calls return the same promise.
   */
  ensureFont(source?: string): Promise<void> {
    if (this.fontLoad) return this.fontLoad;
    if (this.font === undefined || (source !== undefined && !usesText(source))) return Promise.resolve();
    const font = this.font;
    this.fontLoad = (async () => {
      const bytes = font instanceof ArrayBuffer ? font : await (await fetch(font)).arrayBuffer();
      setTextFont(bytes);
      this.memo?.clear(); // a text drawn without the font must not be replayed
    })().catch((e) => {
      this.fontLoad = null; // let a later build retry
      throw new Error(`text: could not load the font (${String(font)}): ${e instanceof Error ? e.message : String(e)}`);
    });
    return this.fontLoad;
  }

  /**
   * Initialize the engine.  In a browser pass the URL or ArrayBuffer of the
   * WASM binary via `options.wasm`.
   */
  static async init(options?: EngineOptions): Promise<PolyScriptEngine> {
    const oc = await initOC(options);
    const memoize = options?.memoize ?? true;
    const memo = memoize ? memoizeKernel(oc, memoize === true ? {} : memoize) : null;
    return new PolyScriptEngine(oc, memo, options?.font);
  }

  /** Drop every memoized kernel result. */
  clearCache(): void {
    this.memo?.clear();
  }

  /**
   * Full build pipeline: parse -> validate -> evaluate.
   * Returns a Shape handle (no export step).
   */
  build(source: string, options?: BuildOptions): BuildResult {
    const errors: BuildError[] = [];

    // 1. Parse
    let program: Program;
    try {
      program = parse(source);
    } catch (e) {
      if (e instanceof ParseError) {
        errors.push({
          phase: 'parse',
          message: e.message,
          line: e.line,
          column: e.column,
          code: 'syntax.parse',
        });
      } else {
        errors.push({ phase: 'parse', message: String(e) });
      }
      return { shape: null, parts: [], errors, params: [], parameterSets: {}, profile: undefined, success: false };
    }

    // 2. Validate
    const valErrors = validate(program);
    for (const ve of valErrors) {
      errors.push({
        phase: 'validate', message: ve.message,
        code: ve.code, hint: ve.hint, line: ve.line, column: ve.column,
      });
    }

    // 3. Extract params
    let paramSet: ParamSet = { params: [], parameterSets: {} };
    try {
      paramSet = _extractParams(source, options?.paramsJson);
    } catch {
      /* non-fatal */
    }

    // 4. Evaluate
    this.memo?.resetStats();
    let result: ReturnType<Evaluator['evaluate']>;
    try {
      const evaluator = new Evaluator({
        oc: this.evalOc,
        overrides: options?.overrides as Record<string, any> | undefined,
        importResolver: options?.importResolver,
        parseFn: parse,
      });
      result = evaluator.evaluate(program);
    } catch (e) {
      if (e instanceof EvalError) {
        errors.push({
          phase: 'evaluate',
          // rawMessage leaves out the ` at line N` tail: the position is in
          // its own fields, and the editor gutter shows it anyway.
          message: e.rawMessage ?? e.message,
          line: e.loc?.line,
          column: e.loc?.column,
          code: asDiagnosticCode(e.code),
          hint: e.hint,
        });
      } else {
        errors.push({ phase: 'evaluate', message: String(e) });
      }
      return {
        shape: null,
        parts: [],
        errors,
        params: paramSet.params,
        parameterSets: paramSet.parameterSets,
        profile: paramSet.profile,
        success: false,
        kernelCache: this.memo?.stats(),
      };
    }

    // Failed assertions and print lines come out of the diagnostics sink,
    // not as exceptions: the model built, and the viewer shows the shape
    // next to the message.
    const diagnostics = drainDiagnostics();
    for (const d of diagnostics) {
      if (d.severity !== 'error') continue;
      errors.push({ phase: 'assert', message: d.message, code: d.code, hint: d.hint, line: d.line, column: d.column });
    }

    // 5. Extract shape, color, and open wires from evaluation result
    const { shape, color, parts, openWires } = this.extractShapeAndColor(result);
    const lineMesh = this.tessellateWires(openWires);
    if (!shape && !lineMesh) {
      errors.push({ phase: 'export', message: 'No shape produced' });
      return {
        shape: null,
        parts: [],
        errors,
        params: paramSet.params,
        parameterSets: paramSet.parameterSets,
        profile: paramSet.profile,
        success: false,
      };
    }

    return {
      shape,
      color,
      parts,
      errors,
      diagnostics,
      params: paramSet.params,
      parameterSets: paramSet.parameterSets,
      profile: paramSet.profile,
      success: true,
      lineMesh,
      kernelCache: this.memo?.stats(),
    };
  }

  // -----------------------------------------------------------------------
  // Export / import methods
  // -----------------------------------------------------------------------

  /** Export a Shape to STL binary (Uint8Array). */
  exportSTL(shape: Shape, options?: ExportOptions): Uint8Array {
    return exportSTLBuffer(this.oc, shape, options?.linearDeflection);
  }

  /** Export a Shape to STEP string. */
  exportSTEP(shape: Shape): string {
    return exportSTEPString(this.oc, shape);
  }

  /** Export a Shape to glTF (GLB) binary, with optional per-part colors. */
  exportGLTF(shape: Shape, options?: ExportOptions): Uint8Array {
    return exportGLTFBuffer(this.oc, shape, options);
  }

  /** Export a Shape to BREP string. */
  exportBREP(shape: Shape): string {
    return exportBREPString(this.oc, shape);
  }

  /** Import a BREP string back into a Shape. */
  importBREP(data: string): Shape {
    return _importBREP(this.oc, data);
  }

  /** Tessellate a Shape into positions, normals, and indices arrays. */
  tessellate(shape: Shape, options?: TessellateOptions): TessellationMesh {
    return _tessellate(this.oc, shape, options);
  }

  /** CAD edges of a Shape as line-segment pairs (see tessellate's edgePoints). */
  edgeSegments(shape: Shape, deflection?: number): Float32Array {
    return _edgeSegments(this.oc, shape, deflection);
  }

  // -----------------------------------------------------------------------
  // Utility methods
  // -----------------------------------------------------------------------

  /** Extract @param annotations and parameter sets from source. */
  extractParams(source: string, jsonStr?: string): ParamSet {
    return _extractParams(source, jsonStr);
  }

  /** Parse + validate only (no kernel needed). */
  check(source: string): { errors: BuildError[] } {
    const errors: BuildError[] = [];
    let program: Program;
    try {
      program = parse(source);
    } catch (e) {
      if (e instanceof ParseError) {
        errors.push({
          phase: 'parse',
          message: e.message,
          line: e.line,
          column: e.column,
          code: 'syntax.parse',
        });
      } else {
        errors.push({ phase: 'parse', message: String(e) });
      }
      return { errors };
    }
    const valErrors = validate(program);
    for (const ve of valErrors) {
      errors.push({
        phase: 'validate', message: ve.message,
        code: ve.code, hint: ve.hint, line: ve.line, column: ve.column,
      });
    }
    return { errors };
  }

  /** Direct access to the underlying OcctKernel. */
  get kernel(): OC {
    return this.oc;
  }

  // -- internal helpers ----------------------------------------------------

  private extractShapeAndColor(value: unknown): {
    shape: Shape | null;
    color?: [number, number, number];
    parts: ColorPart[];
    openWires: Wire[];
  } {
    const allOpenWires: Wire[] = [];
    const states: WpState[] = Array.isArray(value)
      ? (value as unknown[]).filter((v): v is WpState => !!v && typeof v === 'object' && 'shape' in v)
      : value && typeof value === 'object' && 'shape' in value
        ? [value as WpState]
        : [];

    // Top-level shapes are implicitly unioned into one result (as the CLI's
    // resultShape does). Colors are resolved per top-level state *before*
    // fusing, since fusing produces new handles; a part stays a separate
    // part only in `parts`, the fused `shape` is what gets exported as STL.
    let fusedShape: Shape | null = null;
    let firstColor: [number, number, number] | undefined;
    const parts: ColorPart[] = [];

    for (const wp of states) {
      // Since the 2D split (devel/2d-face-wire202609.md) a state carries its
      // regions in `faces` and its curves in `wires`. Faces are drawn as
      // surfaces, holes included; wires are drawn as lines, closed or not --
      // a closed wire is not a face, and `offset` is what makes one of it.
      // Reading only `shape` and `wires` here is why `rect 80 60` stopped
      // rendering after the split ("No shape produced").
      const facesShape = wp.faces.length === 0 ? null
        : wp.faces.length === 1 ? wp.faces[0]
        : this.evalOc.makeCompound(wp.faces);
      allOpenWires.push(...wp.wires);
      if (wp.shape) parts.push(...colorParts(this.evalOc, wp, wp.shape));
      if (facesShape) parts.push({ shape: facesShape, color: wp.color, alpha: wp.alpha });

      const pieces = [wp.shape, facesShape].filter((x): x is Shape => x !== null && x !== undefined);
      const wpShape = pieces.length === 0 ? null : pieces.length === 1 ? pieces[0] : this.evalOc.makeCompound(pieces);
      if (!wpShape) continue;
      if (!firstColor && wp.color) firstColor = wp.color;
      fusedShape = fusedShape ? this.evalOc.fuse(fusedShape, wpShape) : wpShape;
    }

    return { shape: fusedShape, color: firstColor, parts, openWires: allOpenWires };
  }

  /**
   * Tessellate a list of open wires into a single LineSegments mesh
   * (each edge's consecutive samples form line segments).
   *
   * Note: occt-wasm's EdgeData uses FLAT FLOAT indices for pointStart/pointCount
   * in edgeGroups (despite the spec wording), and `pointCount` (top-level) is
   * also the float count. Each point is 3 floats.
   */
  tessellateWires(wires: Wire[], deflection: number = 0.1): { positions: Float32Array; indices: Uint32Array } | undefined {
    if (wires.length === 0) return undefined;
    const positionsAll: number[] = [];
    const indicesAll: number[] = [];
    for (const wire of wires) {
      let wf: ReturnType<typeof this.oc.wireframe>;
      try {
        wf = this.oc.wireframe(wire, deflection);
      } catch {
        continue;
      }
      const baseIdx = positionsAll.length / 3;  // point-index base for this wire
      for (let i = 0; i < wf.points.length; i++) positionsAll.push(wf.points[i]);
      // edgeGroups: [floatStart, floatCount, hash] per edge
      for (let g = 0; g < wf.edgeCount; g++) {
        const floatStart = wf.edgeGroups[g * 3];
        const floatCount = wf.edgeGroups[g * 3 + 1];
        const pointStart = floatStart / 3;
        const pointCount = floatCount / 3;
        for (let i = 0; i < pointCount - 1; i++) {
          indicesAll.push(baseIdx + pointStart + i);
          indicesAll.push(baseIdx + pointStart + i + 1);
        }
      }
    }
    if (indicesAll.length === 0) return undefined;
    return {
      positions: new Float32Array(positionsAll),
      indices: new Uint32Array(indicesAll),
    };
  }
}

export type { ParamInfo, ParamSet };
export type { Profile, ProfileEntry } from '@polyscript/core';
export type { ExportOptions, TessellationMesh, TessellateOptions, ColorPart, KernelMemoStats, KernelMemoOptions } from '@polyscript/core/ocp-kernel';
export type { Shape } from '@polyscript/core/ocp-kernel';
