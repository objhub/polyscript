/**
 * Results that used to be wrong without a word (devel/lessons.md, 2026-11-18):
 * a polar array piled on one spot, a NaN travelling into a placement, len()
 * of a string, and a tube swept thin along a space curve.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { parse, parseExpression } from '../src/parser.js';
import { Evaluator } from '../src/evaluator.js';
import { initOC } from '../src/ocp-kernel/init.js';
import { drainDiagnostics } from '../src/diagnostics.js';
import type { OC } from '../src/ocp-kernel/types.js';

let oc: OC;
beforeAll(async () => {
  oc = await initOC();
});

function run(source: string) {
  drainDiagnostics();
  const ev = new Evaluator({ oc, parseFn: parse });
  const result = ev.evaluate(parse(source));
  return { ev, result, diagnostics: drainDiagnostics() };
}

function measure(source: string, query: string) {
  const { ev } = run(source);
  return ev.evalExpr(parseExpression(query));
}

describe('polar with radius 0', () => {
  const BAR = '$b = box 1 10 1 center:(true, false, false)';

  it('warns that every copy lands on the original', () => {
    const { diagnostics } = run(`${BAR} | polar 4 0\n`);
    expect(diagnostics.map((d) => [d.code, d.severity])).toEqual([['check.no-effect', 'warning']]);
    expect(diagnostics[0].message).toBe('polar 4 0 places all 4 copies in the same spot');
    expect(diagnostics[0].line).toBe(1);
  });

  it('is silent with orient:true, with a radius, and for a single copy', () => {
    expect(run(`${BAR} | polar 4 0 orient:true\n`).diagnostics).toEqual([]);
    expect(run(`${BAR} | polar 4 5\n`).diagnostics).toEqual([]);
    expect(run(`${BAR} | polar 1 0\n`).diagnostics).toEqual([]);
    expect(measure(`${BAR} | polar 4 0 orient:true\n`, '$b.bbox.x')).toBeCloseTo(20);
  });
});

describe('a result that is not a number', () => {
  it('is an error where it is computed', () => {
    expect(() => run('$x = sqrt(-1)\n')).toThrow(/sqrt\(-1\) is not a number/);
    expect(() => run('$x = acos(2)\n')).toThrow(/acos\(2\) is not a number/);
    expect(() => run('$x = (-8) ** 0.5\n')).toThrow(/-8 \*\* 0.5 is not a number/);
  });

  it('never reaches a placement', () => {
    expect(() => run('box 1 1 1 | rotate 0 0 sqrt(-1)\n')).toThrow(/not a number/);
    expect(() => run('box 1 1 1 | translate sqrt(-1) 0 0\n')).toThrow(/not a number/);
  });

  it('leaves the ordinary cases alone', () => {
    expect(measure('', 'sqrt(0)')).toBe(0);
    expect(measure('', 'atan2(0, 0)')).toBe(0);
    expect(measure('', '2 ** 10')).toBe(1024);
  });
});

describe('len', () => {
  it('counts the items of a list and the characters of a string', () => {
    expect(measure('', 'len([1, 2, 3])')).toBe(3);
    expect(measure('', 'len([])')).toBe(0);
    expect(measure('', 'len("HELLO")')).toBe(5);
    expect(measure('', 'len("")')).toBe(0);
  });

  it('refuses anything else instead of answering 0', () => {
    expect(() => measure('', 'len(3)')).toThrow(/len\(\) takes a list or a string, got/);
  });
});

describe('sweep along a space curve', () => {
  // A quarter of a trefoil: the path climbs and dives, and a profile that
  // only turns about Z (the +Z binormal) does not follow it (80% of area x
  // length before; the band of check.sweep-distorted starts at 60%).
  const KNOT = 'def pt($t) = ((20 + 8 * cos(3 * $t)) * cos(2 * $t), (20 + 8 * cos(3 * $t)) * sin(2 * $t), 8 * sin(3 * $t))\n'
    + '$k = spline [pt(90 * $i / 12) for $i in range(13)] | sweep (circle 2)\n';

  it('keeps the section perpendicular to the path', () => {
    const { ev, diagnostics } = run(KNOT);
    expect(diagnostics).toEqual([]);
    expect(ev.evalExpr(parseExpression('$k.valid'))).toBe(true);
    // 4 pi x 69.36, the length of the curve.
    const volume = ev.evalExpr(parseExpression('$k.volume')) as number;
    expect(volume / 871.6).toBeGreaterThan(0.98);
    expect(volume / 871.6).toBeLessThan(1.02);
  });

  it('still turns the section about Z on a helix', () => {
    // Steady climb: the +Z binormal stays, and a square section keeps its
    // sides toward the axis (area x length exactly; 30 + 2 cos 9 deg tall).
    const src = '$h = helix 10 30 10 | sweep (rect 2 2)\n';
    expect(run(src).diagnostics).toEqual([]);
    expect(measure(src, '$h.volume')).toBeCloseTo(763.47, 1);
    expect(measure(src, '$h.bbox.z')).toBeCloseTo(31.975, 2);
  });
});
