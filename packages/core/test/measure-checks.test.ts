/**
 * Two silent failures from issue 2026-10-27 (TODO "既知の問題"):
 *
 * - A selection's property measured the whole solid: `(g | faces <Z).area`
 *   of a 20x30x10 box read 2200 (all six faces) instead of 600.
 * - A boolean the kernel got wrong passed as a healthy result: two cones whose
 *   apexes nearly meet intersected to nothing, and verify said ✓.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { parse } from '../src/parser.js';
import { Evaluator } from '../src/evaluator.js';
import { initOC } from '../src/ocp-kernel/init.js';
import { drainDiagnostics } from '../src/diagnostics.js';
import type { OC } from '../src/ocp-kernel/types.js';

let oc: OC;
beforeAll(async () => {
  oc = await initOC();
});

function evalCodes(source: string, kernel: OC = oc): string[] {
  drainDiagnostics();
  new Evaluator({ oc: kernel, parseFn: parse }).evaluate(parse(source));
  return drainDiagnostics().map((d) => d.code);
}

describe('a selection measures what it selected', () => {
  const box = 'g = box 20 30 10\n';
  function value(expr: string): unknown {
    const ev = new Evaluator({ oc, parseFn: parse });
    ev.evaluate(parse(`${box}print "v" ${expr}\ng\n`));
    const line = drainDiagnostics().find((d) => d.code === 'print');
    return line?.message.replace(/^v /, '');
  }

  it.each([
    ['(g | faces <Z).area', '600'],
    ['(g | faces =Z).area', '1000'],
    ['(g | faces =Z).faces', '4'],
    ['(g | faces >Z).bbox', '20x30x0 at (-10,-15,5)'],
    ['(g | edges =Z).edges', '4'],
    ['(g | faces >Z | rect 5 5).area', '25'],
    ['(g | faces >Z | shell 2).area', '2872'],
    ['g.area', '2200'],
  ])('%s is %s', (expr, expected) => {
    drainDiagnostics();
    expect(value(expr)).toBe(expected);
  });

  it("refuses a solid's property on a selection", () => {
    const ev = new Evaluator({ oc, parseFn: parse });
    expect(() => ev.evaluate(parse(`${box}print "v" (g | faces <Z).volume\ng\n`)))
      .toThrow(/face selection has no property 'volume'/);
  });
});

describe('check.boolean-volume', () => {
  it.each([
    ['diff', '(box 20 20 20) - (cylinder 5 30)'],
    ['diff that misses', '(box 20 20 20) - (box 5 5 5 | translate 40 0 0)'],
    ['diff that swallows', '(box 5 5 5) - (box 20 20 20)'],
    ['inter', '(box 20 20 20) * (sphere 12)'],
    ['inter of disjoint parts', '(box 10 10 10) * (box 10 10 10 | translate 50 0 0)'],
    ['union', '(box 20 20 20) + (cylinder 5 30)'],
    ['union of disjoint parts', '(box 10 10 10) + (box 10 10 10 | translate 50 0 0)'],
  ])('stays quiet on a correct %s', (_name, src) => {
    expect(evalCodes(src)).not.toContain('check.boolean-volume');
  });

  // A kernel that breaks each invariant on purpose: the check must not depend
  // on OCCT reproducing one particular failure.
  function lying(op: 'cut' | 'common' | 'fuse', fake: (a: unknown, b: unknown) => unknown): OC {
    return new Proxy(oc, {
      get(target, prop, recv) {
        if (prop === op) return fake;
        const v = Reflect.get(target, prop, recv);
        return typeof v === 'function' ? v.bind(target) : v;
      },
    });
  }

  it('flags a diff that grew the volume', () => {
    const k = lying('cut', (a, b) => oc.fuse(a as never, b as never));
    expect(evalCodes('(box 20 20 20) - (cylinder 5 30)', k)).toContain('check.boolean-volume');
  });

  it('flags an inter that came out empty although the operands overlap', () => {
    const k = lying('common', () => oc.makeCompound([]));
    expect(evalCodes('(box 20 20 20) * (sphere 12)', k)).toContain('check.boolean-volume');
  });

  it('flags a union that lost material', () => {
    const k = lying('fuse', (a) => a);
    // fuse is also what the empty-inter check and the 2D path use; keep to 3D.
    expect(evalCodes('(box 5 5 5) + (box 20 20 20 | translate 30 0 0)', k)).toContain('check.boolean-volume');
  });

  it('catches the cones of issue 2026-10-26 when the kernel loses them', () => {
    const src = 'fz = cone 0 141 57 center:(true, true, false) | translate 0 0 0.16\n'
      + 'fy = cone 0 141 57 center:(true, true, false) | translate 0 0 0.16 | rotate -90 0 0\n'
      + 'fz * fy\n';
    drainDiagnostics();
    const r = new Evaluator({ oc, parseFn: parse }).evaluate(parse(src));
    const codes = drainDiagnostics().map((d) => d.code);
    // Either OCCT gets this right one day (a non-empty result) or the check fires.
    const shape = (r as { shape?: unknown }).shape;
    const vol = shape ? Math.abs(oc.getVolume(shape as never)) : 0;
    if (vol === 0) expect(codes).toContain('check.boolean-volume');
  });
});
