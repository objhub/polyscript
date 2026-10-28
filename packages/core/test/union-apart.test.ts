/**
 * A union of solids that are apart is a compound, not a fuse (devel/perf.md
 * 2026-10-27, proposal 3: bounding boxes that do not meet; 2026-10-28,
 * proposal 2: boxes that meet but a measured gap). The result must be what
 * the fuse would have returned -- the same solids side by side -- and parts
 * that touch or overlap must still go through the kernel. clear() takes the
 * same shortcut and runs its boolean only when the parts touch or overlap.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { parse, parseExpression } from '../src/parser.js';
import { Evaluator } from '../src/evaluator.js';
import { initOC } from '../src/ocp-kernel/init.js';
import { drainDiagnostics } from '../src/diagnostics.js';
import type { OC, WpState } from '../src/ocp-kernel/types.js';

type AnyFn = (...args: unknown[]) => unknown;

let oc: OC;
beforeAll(async () => {
  oc = await initOC();
});

type Counts = { fuse: number; fuseAll: number; common: number; distanceBetween: number };

/** The real kernel, counting how often each boolean and the distance query
 *  are asked. */
function counting(): { oc: OC; fuses: () => number; counts: Counts } {
  const counts: Counts = { fuse: 0, fuseAll: 0, common: 0, distanceBetween: 0 };
  const k = new Proxy(oc, {
    get(target, prop, recv) {
      const v = Reflect.get(target, prop, recv);
      if (typeof prop === 'string' && prop in counts) {
        return (...a: unknown[]) => { counts[prop as keyof Counts]++; return (v as AnyFn).apply(target, a); };
      }
      return typeof v === 'function' ? v.bind(target) : v;
    },
  });
  return { oc: k, fuses: () => counts.fuse, counts };
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
    // Force the old path: a kernel whose bounding boxes always meet and
    // whose distance query never sees a gap.
    const meeting = new Proxy(oc, {
      get(target, prop, recv) {
        const v = Reflect.get(target, prop, recv);
        if (prop === 'getBoundingBox') return () => ({ xmin: -1e9, ymin: -1e9, zmin: -1e9, xmax: 1e9, ymax: 1e9, zmax: 1e9 });
        if (prop === 'distanceBetween') return () => 0;
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

// A pin inside a ring: the boxes overlap entirely, the parts leave a 1mm gap.
// Two pins stacked with a gap are an assembly (two solids) that the ring's
// box also meets.
const PIN = '$pin = cylinder 5 10\n';
const PINS = PIN + '$pins = $pin + ($pin | translate 0 0 20)\n';
const RING = '$ring = (cylinder 12 10) - (cylinder 6 10)\n';
const PIN_VOL = Math.PI * 25 * 10;
const RING_VOL = Math.PI * (144 - 36) * 10;
const BRIDGE = 'box 2 1 10 | translate 4.5 0 0';

describe('union of parts whose boxes meet but that leave a gap', () => {
  it('lays an assembly beside the other part after one distance query, no fuse', () => {
    const k = counting();
    const r = build(PINS + RING + '$pins + $ring', k.oc);
    expect(k.counts).toMatchObject({ fuse: 0, fuseAll: 0, distanceBetween: 1 });
    expect(facts(r)).toMatchObject({ solids: 3 });
    expect(facts(r).volume).toBeCloseTo(2 * PIN_VOL + RING_VOL, 2);
  });

  it('fuses two single solids without asking the distance', () => {
    // Measured: on two intricate parts that mesh (a ring gear around a
    // gear) the distance query costs several times the boolean it would
    // save, so single solids keep the fuse, which lays them side by side.
    const k = counting();
    const r = build(PIN + RING + '$pin + $ring', k.oc);
    expect(k.counts).toMatchObject({ fuse: 1, distanceBetween: 0 });
    expect(facts(r)).toMatchObject({ solids: 2 });
    expect(facts(r).volume).toBeCloseTo(PIN_VOL + RING_VOL, 2);
  });

  it('an n-ary union still clusters by boxes alone', () => {
    const k = counting();
    // The bridge (x 3.5..5.5) overlaps the pin and stays clear of the ring.
    // Refining the clusters by distance was measured and rejected (one
    // query per pair of operands cost more than the fuses it saved), so the
    // three are one fuseAll, which lays the ring beside the fused pair.
    const r = build(PIN + RING + `union [$pin, $ring, ${BRIDGE}]`, k.oc);
    expect(k.counts).toMatchObject({ fuse: 0, fuseAll: 1, distanceBetween: 0 });
    expect(facts(r)).toMatchObject({ solids: 2 });
    const pinAndBridge = facts(build(PIN + `$pin + (${BRIDGE})`, oc)).volume;
    expect(facts(r).volume).toBeCloseTo(pinAndBridge + RING_VOL, 1);
  });

  it('still fuses a part that reaches into the other', () => {
    const k = counting();
    const r = build(PIN + `$pin + (${BRIDGE})`, k.oc);
    expect(k.fuses()).toBe(1);
    expect(facts(r)).toMatchObject({ solids: 1 });
  });

  it('fuses as before when the distance query fails', () => {
    const failing = new Proxy(oc, {
      get(target, prop, recv) {
        const v = Reflect.get(target, prop, recv);
        if (prop === 'distanceBetween') return () => { throw new Error('distanceBetween: computation failed'); };
        return typeof v === 'function' ? v.bind(target) : v;
      },
    });
    const k = counting();
    const r = build(PINS + RING + '$pins + $ring', new Proxy(failing, {
      get(target, prop, recv) {
        const v = Reflect.get(target, prop, recv);
        if (prop === 'fuse') return (...a: unknown[]) => { k.counts.fuse++; return (v as AnyFn).apply(target, a); };
        return v;
      },
    }));
    expect(k.counts.fuse).toBe(1);
    expect(facts(r)).toMatchObject({ solids: 3 });
  });
});

describe('clear() with boxes that meet', () => {
  function clear(src: string, expr: string, kernel: OC): boolean {
    const ev = new Evaluator({ oc: kernel, parseFn: parse });
    ev.evaluate(parse(src + 'box 1 1 1\n'));
    return ev.evalExpr(parseExpression(expr)) as boolean;
  }

  it('answers from the gap without a boolean when one side is an assembly', () => {
    const k = counting();
    expect(clear(PINS + RING, 'clear($pins, $ring)', k.oc)).toBe(true);
    expect(k.counts).toMatchObject({ common: 0, distanceBetween: 1 });
  });

  it('runs the boolean for two single solids', () => {
    const k = counting();
    expect(clear(PIN + RING, 'clear($pin, $ring)', k.oc)).toBe(true);
    expect(k.counts).toMatchObject({ common: 1, distanceBetween: 0 });
  });

  it('runs the boolean when the parts touch, and counts touching as clear', () => {
    const k = counting();
    expect(clear('$a = box 10 10 10\n$b = box 10 10 10 | translate 10 0 0\n', 'clear($a, $b)', k.oc)).toBe(true);
    expect(k.counts.common).toBe(1);
  });

  it('runs the boolean when the parts overlap', () => {
    const k = counting();
    expect(clear('$a = box 10 10 10\n$b = box 10 10 10 | translate 9 0 0\n', 'clear($a, $b)', k.oc)).toBe(false);
    expect(k.counts.common).toBe(1);
  });
});
