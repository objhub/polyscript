/**
 * OCP Kernel initialization -- manages the OcctKernel instance.
 */

import type { OC } from './types.js';
import { OcctKernel } from 'occt-wasm';
import { memoizeMeasures } from './measure-memo.js';

let _cachedOC: OC | null = null;

export async function initOC(
  options?: { wasm?: string | ArrayBuffer },
): Promise<OC> {
  if (_cachedOC) return _cachedOC;
  // `bun build --compile` only embeds what its bundler sees statically, so the
  // Bun entry names the .wasm with an import attribute and leaves the embedded
  // path here. Node and Deno never set it and fall through to the loader's own
  // import.meta.url resolution.
  const embedded = (globalThis as Record<string, unknown>).__POLY_OCCT_WASM__;
  const wasm = options?.wasm ?? (embedded as string | undefined);
  const kernel = await OcctKernel.init(wasm ? { wasm } : undefined);
  // Volume, area and bbox are read many times per shape; answer once.
  _cachedOC = memoizeMeasures(kernel);
  return _cachedOC;
}

// Allow injecting a pre-initialized kernel (for browser or test)
export function setOC(oc: OC): void {
  _cachedOC = oc;
}
