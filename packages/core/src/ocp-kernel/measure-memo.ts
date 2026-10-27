/**
 * Memoization of measurements by shape handle.
 *
 * A handle names one immutable shape, so its volume, surface area and
 * bounding box never change: the first answer is the answer. The same
 * shape is measured many times in one build -- the trace reads the volume
 * after every step, the boolean-volume check reads both operands of every
 * boolean, `assert` and `print` read what the model asks, and an operand
 * such as a cubie reused twelve times in an assembly is integrated twelve
 * times. On bot/toy/rubic-cube that was 806 getVolume calls and 20.7s of a
 * 140s build (devel/perf.md, 2026-10-27).
 *
 * This wraps the kernel so a measurement is computed once per (method,
 * handle, options) and dropped when the handle is released. It differs
 * from memoizeKernel (memo.ts), which caches shape-producing calls by their
 * arguments for interactive rebuilds and is opt-in: this one is always on,
 * costs one Map lookup, and can never return stale geometry because it
 * holds no geometry, only numbers.
 *
 * Only the three measurements are memoized. Sub-shape queries return fresh
 * handles each call, so a per-handle key would never hit on them anyway.
 */

import type { OC } from './types.js';

/** Methods memoized by their first argument, the handle. */
export const MEASURED: ReadonlySet<string> = new Set(['getVolume', 'getSurfaceArea', 'getBoundingBox']);

/** Methods that free handles: their entries must go with them. */
const RELEASES_ONE = 'release';
const RELEASES_MANY: ReadonlySet<string> = new Set(['releaseAll', 'releaseSince']);

type AnyFn = (...args: unknown[]) => unknown;

export function memoizeMeasures(oc: OC): OC {
  // handle -> ("method options" -> value)
  const cache = new Map<number, Map<string, unknown>>();
  const wrappers = new Map<string, AnyFn>();
  const raw = oc as unknown as Record<string, AnyFn>;

  const measured = (name: string): AnyFn => {
    let fn = wrappers.get(name);
    if (fn) return fn;
    const method = raw[name].bind(oc);
    fn = (...args: unknown[]) => {
      const handle = args[0];
      if (typeof handle !== 'number') return method(...args);
      const key = args.length > 1 ? `${name} ${JSON.stringify(args.slice(1))}` : name;
      let entries = cache.get(handle);
      if (entries?.has(key)) return copyOut(entries.get(key));
      // A measurement that throws is not cached; the caller sees the throw.
      const value = method(...args);
      if (!entries) { entries = new Map(); cache.set(handle, entries); }
      entries.set(key, value);
      return copyOut(value);
    };
    wrappers.set(name, fn);
    return fn;
  };

  const releasing = (name: string): AnyFn => {
    let fn = wrappers.get(name);
    if (fn) return fn;
    const method = raw[name].bind(oc);
    fn = name === RELEASES_ONE
      ? (...args: unknown[]) => { if (typeof args[0] === 'number') cache.delete(args[0]); return method(...args); }
      : (...args: unknown[]) => { cache.clear(); return method(...args); };
    wrappers.set(name, fn);
    return fn;
  };

  return new Proxy(oc as unknown as Record<string | symbol, unknown>, {
    get(target, prop, receiver) {
      if (typeof prop === 'string' && typeof target[prop] === 'function') {
        if (MEASURED.has(prop)) return measured(prop);
        if (prop === RELEASES_ONE || RELEASES_MANY.has(prop)) return releasing(prop);
      }
      const value = Reflect.get(target, prop, receiver);
      // Bind other methods to the real kernel: OcctKernel uses private
      // fields, which a Proxy as `this` would break.
      return typeof value === 'function' ? (value as AnyFn).bind(oc) : value;
    },
  }) as unknown as OC;
}

/** A bounding box is an object callers may edit; hand out a copy. */
function copyOut(value: unknown): unknown {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : value;
}
