/**
 * PolyScript Worker client — main-thread API for communicating with the
 * PolyScriptEngine running inside a Web Worker.
 *
 * Usage:
 *   import { PolyWorker } from '@polyscript/browser/worker';
 *   const worker = new PolyWorker('/polyscript-worker.js', '/occt-wasm.wasm');
 *   await worker.init();
 *   const result = await worker.build(code);
 */

import type { BuildError } from './index.js';
import type { Diagnostic } from '@polyscript/core';
import type { ShapeInfo } from '@polyscript/core/ocp-kernel';
import type { WorkerRequest, WorkerResponse, WorkerMesh, WorkerMeshPart } from './worker-entry.js';

export type { WorkerMesh, WorkerMeshPart };
export type { ShapeInfo } from '@polyscript/core/ocp-kernel';

export interface WorkerBuildResult {
  ok: boolean;
  mesh?: WorkerMesh;
  color?: [number, number, number];
  volume?: number;
  /** B-Rep summary: bbox, volume, area, solids, validity and the face / edge /
   *  vertex counts. Absent when the result is not a solid. */
  info?: ShapeInfo;
  /** Failed `assert`s (phase 'assert') come with `ok: true` and a mesh: the
   *  model built, it just contradicts itself. */
  errors: BuildError[];
  /** `print` lines and kernel warnings (see BuildResult.diagnostics). */
  diagnostics?: Diagnostic[];
  params: any[];
  parameterSets: Record<string, Record<string, unknown>>;
  profile?: { entries: { name: string; values: Record<string, any> }[] };
  timing?: { evaluate: number; tessellate: number };
  kernelCache?: { hits: number; misses: number; size: number };
}

export type BuildRequestOptions = { overrides?: Record<string, unknown>; imports?: Record<string, string> };

export interface WorkerExportResult {
  ok: boolean;
  data?: ArrayBuffer | string;
  filename?: string;
  mime?: string;
  error?: string;
}

export class PolyWorker {
  private worker: Worker;
  private wasmUrl: string | undefined;
  private fontUrl: string | undefined;
  private nextId = 0;
  private pending = new Map<number, { resolve: (v: WorkerResponse) => void; reject: (e: Error) => void }>();
  private initPromise: Promise<void> | null = null;
  private _ready = false;
  /** The build the worker is executing right now, if any. */
  private buildInFlight: Promise<void> | null = null;
  /** At most one build waits behind the in-flight one; a newer request
   *  replaces it. See build(). */
  private queuedBuild: {
    code: string;
    options?: BuildRequestOptions;
    resolve: (v: WorkerBuildResult) => void;
    reject: (e: Error) => void;
  } | null = null;

  /**
   * @param workerUrl  URL or Worker instance for the worker script
   * @param wasmUrl    URL of the occt-wasm.wasm file (passed to the worker for init)
   * @param options.fontUrl  TrueType / OpenType font for `text` (default: the
   *   bundled Noto Sans JP). Fetched in the worker the first time a build uses
   *   `text`.
   */
  constructor(workerUrl: string | URL | Worker, wasmUrl?: string, options: { fontUrl?: string } = {}) {
    if (workerUrl instanceof Worker) {
      this.worker = workerUrl;
    } else {
      this.worker = new Worker(workerUrl, { type: 'module' });
    }
    this.wasmUrl = wasmUrl;
    this.fontUrl = options.fontUrl;

    this.worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const resp = e.data;
      const entry = this.pending.get(resp.id);
      if (entry) {
        this.pending.delete(resp.id);
        entry.resolve(resp);
      }
    };
    this.worker.onerror = (e) => {
      console.error('[PolyWorker] error:', e.message, e.filename, e.lineno, e.colno, e.error);
      for (const [, entry] of this.pending) {
        entry.reject(new Error(e.message || `Worker error at ${e.filename}:${e.lineno}:${e.colno}`));
      }
      this.pending.clear();
    };
  }

  get ready(): boolean {
    return this._ready;
  }

  /** Initialize the engine in the worker. Call once before build/export. */
  async init(): Promise<void> {
    if (this._ready) return;
    if (this.initPromise) return this.initPromise;
    this.initPromise = this.doInit();
    return this.initPromise;
  }

  private async doInit(): Promise<void> {
    const resp = await this.send({ type: 'init', wasmUrl: this.wasmUrl, fontUrl: this.fontUrl });
    if (!resp.ok) throw new Error(resp.error ?? 'Worker init failed');
    this._ready = true;
  }

  /** Build code and return tessellated mesh.
   *
   *  Builds are coalesced: the worker is single-threaded and synchronous, so
   *  a request posted while one is running would queue behind it and run to
   *  completion even though its result is already stale. Instead at most one
   *  build waits; a newer call replaces the waiting one, whose promise rejects
   *  with 'Build superseded'. Dragging a slider therefore costs one build in
   *  flight plus one for the final value, not one per debounce tick. */
  build(code: string, options?: BuildRequestOptions): Promise<WorkerBuildResult> {
    return new Promise((resolve, reject) => {
      if (this.queuedBuild) this.queuedBuild.reject(new Error('Build superseded'));
      this.queuedBuild = { code, options, resolve, reject };
      void this.pumpBuilds();
    });
  }

  private async pumpBuilds(): Promise<void> {
    if (this.buildInFlight) return;
    while (this.queuedBuild) {
      const job = this.queuedBuild;
      this.queuedBuild = null;
      this.buildInFlight = this.runBuild(job.code, job.options).then(job.resolve, job.reject);
      await this.buildInFlight;
      this.buildInFlight = null;
    }
  }

  private async runBuild(code: string, options?: BuildRequestOptions): Promise<WorkerBuildResult> {
    await this.init();
    const resp = await this.send({ type: 'build', code, buildOptions: options });
    return {
      ok: resp.ok,
      mesh: resp.mesh,
      color: resp.color,
      volume: resp.volume,
      info: resp.info,
      errors: resp.errors ?? [],
      diagnostics: resp.diagnostics,
      params: resp.params ?? [],
      parameterSets: resp.parameterSets ?? {},
      profile: resp.profile,
      timing: resp.timing,
      kernelCache: resp.kernelCache,
    };
  }

  /** Export last successful build result. */
  async exportFile(
    format: 'stl' | 'step' | 'gltf' | 'brep',
  ): Promise<WorkerExportResult> {
    await this.init();
    const resp = await this.send({ type: 'export', format });
    return {
      ok: resp.ok,
      data: resp.data,
      filename: resp.filename,
      mime: resp.mime,
      error: resp.error,
    };
  }

  /** Terminate the worker. */
  terminate(): void {
    this.worker.terminate();
    for (const [, entry] of this.pending) {
      entry.reject(new Error('Worker terminated'));
    }
    this.pending.clear();
    if (this.queuedBuild) {
      this.queuedBuild.reject(new Error('Worker terminated'));
      this.queuedBuild = null;
    }
    this._ready = false;
  }

  private send(partial: Omit<WorkerRequest, 'id'>): Promise<WorkerResponse> {
    const id = this.nextId++;
    const req = { ...partial, id } as WorkerRequest;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage(req);
    });
  }
}
