/**
 * A union of solids whose bounding boxes do not meet is a compound, not a
 * fuse (devel/perf.md 2026-10-27, proposal 3). The result must be what the
 * fuse would have returned -- the same solids side by side -- and parts that
 * touch or overlap must still go through the kernel.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { parse } from '../src/parser.js';
import { Evaluator } from '../src/evaluator.js';
import { initOC } from '../src/ocp-kernel/init.js';
import { drainDiagnostics } from '../src/diagnostics.js';
import type { OC, WpState } from '../src/ocp-kernel/types.js';

let oc: OC;
beforeAll(async () => {
  oc = await initOC();
});

/** The real kernel, counting how often `fuse` is asked. */
function counting(): { oc: OC; fuses: () => number } {
  let n = 0;
  const k = new Proxy(oc, {
    get(target, prop, recv) {
      const v = Reflect.get(target, prop, recv);
      if (prop === 'fuse') return (...a: unknown[]) => { n++; return (v as Function).apply(target, a); };
      return typeof v === 'function' ? v.bind(target) : v;
    },
  });
  return { oc: k, fuses: () => n };
}

function build(src: string, kernel: OC): WpState {
  drainDiagnostics();
  const r = new Evaluator({ oc: kernel, parseFn: parse }).evaluate(parse(src));
  return r as WpState;
}

function facts(s: WpState) {
  const shape = s.shape!;
  return {
    solids: oc.getSubShapes(shape, 'solid').length,
    faces: oc.getSubShapes(shape, 'face').length,
    volume: Math.round(oc.getVolume(shape) * 1000) / 1000,
  };
}

describe('union of parts that are apart', () => {
  it('is a compound of both without a fuse', () => {
    const k = counting();
    const r = build('(box 10 10 10) + (box 10 10 10 | translate 30 0 0)', k.oc);
    expect(k.fuses()).toBe(0);
    expect(facts(r)).toEqual({ solids: 2, faces: 12, volume: 2000 });
  });

  it('matches what the fuse returns', () => {
    const src = '(box 10 10 10) + (cylinder 4 20 | translate 30 0 0) + (sphere 6 | translate 0 40 0)';
    const fast = facts(build(src, oc));
    // Force the old path: a kernel whose bounding boxes always meet.
    const meeting = new Proxy(oc, {
      get(target, prop, recv) {
        const v = Reflect.get(target, prop, recv);
        if (prop === 'getBoundingBox') return () => ({ xmin: -1e9, ymin: -1e9, zmin: -1e9, xmax: 1e9, ymax: 1e9, zmax: 1e9 });
        return typeof v === 'function' ? v.bind(target) : v;
      },
    });
    const slow = facts(build(src, meeting));
    expect(fast).toEqual(slow);
    expect(fast.solids).toBe(3);
  });

  it('still fuses parts that touch on a face', () => {
    const k = counting();
    const r = build('(box 10 10 10) + (box 10 10 10 | translate 10 0 0)', k.oc);
    expect(k.fuses()).toBe(1);
    // The fuse keeps the faces split at the seam; what matters is one solid.
    expect(facts(r)).toMatchObject({ solids: 1, volume: 2000 });
  });

  it('still fuses parts that overlap', () => {
    const k = counting();
    const r = build('(box 10 10 10) + (box 10 10 10 | translate 5 0 0)', k.oc);
    expect(k.fuses()).toBe(1);
    expect(facts(r)).toMatchObject({ solids: 1, volume: 1500 });
  });

  it('fuses a third part into the compound when it reaches one of them', () => {
    const k = counting();
    // Bound to a variable so the second `+` is a pair, not a chain of three
    // (a chain is one n-ary fuse, union-nary.test.ts).
    const r = build('two = (box 10 10 10) + (box 10 10 10 | translate 30 0 0)\ntwo + (box 10 10 10 | translate 35 0 0)', k.oc);
    expect(k.fuses()).toBe(1);
    expect(facts(r)).toMatchObject({ solids: 2, volume: 2500 });
  });

  it('lays out a print plate with no fuse at all', () => {
    const k = counting();
    const r = build('union [box 10 10 10 | translate ($i * 15) 0 0 for $i in range(6)]', k.oc);
    expect(k.fuses()).toBe(0);
    expect(facts(r)).toEqual({ solids: 6, faces: 36, volume: 6000 });
  });

  it('keeps a hair of overlap on the fuse path', () => {
    const k = counting();
    build('(box 10 10 10) + (box 10 10 10 | translate 9.9999999 0 0)', k.oc);
    expect(k.fuses()).toBe(1);
  });
});
