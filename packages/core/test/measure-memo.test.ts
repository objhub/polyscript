/**
 * Measurements are memoized per handle (ocp-kernel/measure-memo.ts): the
 * second getVolume of a shape costs a Map lookup, a released handle is
 * forgotten, and a bbox asked with other options is a different entry.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { OcctKernel } from 'occt-wasm';
import { memoizeMeasures } from '../src/ocp-kernel/measure-memo.js';
import { initOC } from '../src/ocp-kernel/init.js';
import type { OC } from '../src/ocp-kernel/types.js';

let kernel: OcctKernel;
beforeAll(async () => {
  await initOC();
  kernel = await OcctKernel.init();
});

function counting() {
  const calls: Record<string, number> = {};
  const counted = new Proxy(kernel as unknown as Record<string, unknown>, {
    get(t, p, r) {
      const v = Reflect.get(t, p, r);
      if (typeof v !== 'function' || typeof p !== 'string') return v;
      return (...a: unknown[]) => { calls[p] = (calls[p] ?? 0) + 1; return (v as Function).apply(t, a); };
    },
  }) as unknown as OC;
  return { oc: memoizeMeasures(counted), calls };
}

describe('memoizeMeasures', () => {
  it('measures a handle once', () => {
    const { oc, calls } = counting();
    const box = oc.makeBox(10, 20, 30);
    expect(oc.getVolume(box)).toBeCloseTo(6000);
    expect(oc.getVolume(box)).toBeCloseTo(6000);
    expect(oc.getSurfaceArea(box)).toBeCloseTo(2200);
    expect(oc.getSurfaceArea(box)).toBeCloseTo(2200);
    expect(calls.getVolume).toBe(1);
    expect(calls.getSurfaceArea).toBe(1);
  });

  it('keeps bbox options apart and hands out copies', () => {
    const { oc, calls } = counting();
    const cyl = oc.makeCylinder(5, 10);
    const a = oc.getBoundingBox(cyl);
    const b = oc.getBoundingBox(cyl);
    const c = oc.getBoundingBox(cyl, { precise: false, useTriangulation: false });
    expect(b).toEqual(a);
    expect(b).not.toBe(a);
    b.xmax = 999;
    expect(oc.getBoundingBox(cyl).xmax).toBeCloseTo(a.xmax);
    expect(c.xmax).toBeGreaterThanOrEqual(a.xmax - 1e-6);
    expect(calls.getBoundingBox).toBe(2);
  });

  it('forgets a released handle', () => {
    const { oc, calls } = counting();
    const box = oc.makeBox(1, 1, 1);
    oc.getVolume(box);
    oc.release(box);
    const again = oc.makeBox(2, 2, 2);
    expect(oc.getVolume(again)).toBeCloseTo(8);
    // Whether or not the arena reused the id, the second box is measured.
    expect(calls.getVolume).toBe(2);
  });

  it('does not change what initOC builds', async () => {
    const oc = await initOC();
    const s = oc.cut(oc.makeBox(20, 20, 20), oc.makeCylinder(5, 30));
    expect(oc.getVolume(s)).toBeCloseTo(8000 - Math.PI * 25 * 20 / 4, 3);
    expect(oc.getVolume(s)).toBeCloseTo(8000 - Math.PI * 25 * 20 / 4, 3);
  });
});
