/**
 * A union of three or more solids is one n-ary fuse (devel/perf.md
 * 2026-10-27, proposal 4): `union [a, b, c]`, `a | union [b, c]` and the
 * chain `a + b + c` all reach wpUnionAll. The result must match the
 * pairwise fold, parts that are apart must still cost no fuse, the volume
 * check must cover the n-ary fuse, and a `+` chain that is not all shapes
 * must behave exactly as before.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { parse } from '../src/parser.js';
import { Evaluator } from '../src/evaluator.js';
import { initOC } from '../src/ocp-kernel/init.js';
import { drainDiagnostics } from '../src/diagnostics.js';
import type { OC, WpState } from '../src/ocp-kernel/types.js';

type AnyFn = (...args: unknown[]) => unknown;

let oc: OC;
beforeAll(async () => {
  oc = await initOC();
});

type Counts = { fuse: number; fuseAll: number; fuseAllArgs: number[] };

/** The real kernel, counting the fuses it is asked for. */
function counting(): { oc: OC; counts: Counts } {
  const counts: Counts = { fuse: 0, fuseAll: 0, fuseAllArgs: [] };
  const k = new Proxy(oc, {
    get(target, prop, recv) {
      const v = Reflect.get(target, prop, recv);
      if (prop === 'fuse') return (...a: unknown[]) => { counts.fuse++; return (v as AnyFn).apply(target, a); };
      if (prop === 'fuseAll') return (shapes: unknown[]) => { counts.fuseAll++; counts.fuseAllArgs.push(shapes.length); return (v as AnyFn).call(target, shapes); };
      return typeof v === 'function' ? v.bind(target) : v;
    },
  });
  return { oc: k, counts };
}

function run(src: string, kernel: OC = oc): unknown {
  drainDiagnostics();
  return new Evaluator({ oc: kernel, parseFn: parse }).evaluate(parse(src));
}

function facts(v: unknown) {
  const shape = (v as WpState).shape!;
  return {
    solids: oc.getSubShapes(shape, 'solid').length,
    faces: oc.getSubShapes(shape, 'face').length,
    volume: Math.round(oc.getVolume(shape) * 1000) / 1000,
  };
}

const A = 'box 10 10 10';
const B = 'box 10 10 10 | translate 5 0 0';
const C = 'box 10 10 10 | translate 10 0 0';
const FAR = 'box 10 10 10 | translate 50 0 0';

describe('a union of three or more solids is one fuse', () => {
  it.each([
    ['source form', `union [${A}, ${B}, ${C}]`],
    ['pipe op', `(${A}) | union [${B}, ${C}]`],
    ['operator chain', `(${A}) + (${B}) + (${C})`],
    ['operator with a list', `(${A}) + [${B}, ${C}]`],
  ])('%s', (_name, src) => {
    const k = counting();
    const r = run(src, k.oc);
    expect(k.counts).toEqual({ fuse: 0, fuseAll: 1, fuseAllArgs: [3] });
    expect(facts(r)).toMatchObject({ solids: 1, volume: 2000 });
  });

  it('matches the pairwise fold', () => {
    const nary = facts(run(`(${A}) + (${B}) + (${C})`));
    // Through a variable the inner `+` is its own pair, not part of a chain
    // (the parser unwraps parentheses, so `((a + b) + c)` is still a chain).
    const k = counting();
    const fold = facts(run(`ab = (${A}) + (${B})\nab + (${C})`, k.oc));
    expect(k.counts.fuse).toBe(2);
    expect(nary).toEqual(fold);
  });

  it('fuses only the operands whose boxes meet, and lays the rest beside them', () => {
    const k = counting();
    const r = run(`(${A}) + (${FAR}) + (${B}) + (${FAR} | translate 0 30 0)`, k.oc);
    expect(k.counts).toEqual({ fuse: 0, fuseAll: 1, fuseAllArgs: [2] });
    expect(facts(r)).toMatchObject({ solids: 3, volume: 3500 });
  });

  it('a print plate costs no fuse', () => {
    const k = counting();
    const r = run('union [box 10 10 10 | translate ($i * 15) 0 0 for $i in range(6)]', k.oc);
    expect(k.counts).toEqual({ fuse: 0, fuseAll: 0, fuseAllArgs: [] });
    expect(facts(r)).toMatchObject({ solids: 6, volume: 6000 });
  });

  it('keeps a drawing on the first operand', () => {
    const r = run(`(${A}) | faces >Z | rect 4 4 | union [${B}, ${C}]`) as WpState;
    expect(r.faces.length).toBe(1);
    expect(facts(r)).toMatchObject({ solids: 1, volume: 2000 });
  });
});

describe('check.boolean-volume on an n-ary union', () => {
  function codes(src: string, kernel: OC): string[] {
    run(src, kernel);
    return drainDiagnostics().map((d) => d.code);
  }
  const lying = (): OC => new Proxy(oc, {
    get(target, prop, recv) {
      if (prop === 'fuseAll') return (shapes: unknown[]) => shapes[0];
      const v = Reflect.get(target, prop, recv);
      return typeof v === 'function' ? v.bind(target) : v;
    },
  });

  it('stays quiet on a correct union', () => {
    expect(codes(`union [${A}, ${B}, ${C}]`, oc)).not.toContain('check.boolean-volume');
    expect(codes(`union [${A}, ${B}, ${FAR}]`, oc)).not.toContain('check.boolean-volume');
  });

  it('flags a fuse that lost material', () => {
    // The lying kernel keeps the first operand: smaller than the largest,
    // which no correct union can be. (Keeping the largest and dropping the
    // rest would pass, as it does for a pair: the invariant cannot see it.)
    expect(codes(`union [box 5 5 5, ${B}, ${C}]`, lying())).toContain('check.boolean-volume');
  });
});

describe('a + chain that is not all shapes', () => {
  function print(expr: string): string | undefined {
    run(`print "v" ${expr}\nbox 1 1 1\n`);
    return drainDiagnostics().find((d) => d.code === 'print')?.message.replace(/^v /, '');
  }

  it.each([
    ['1 + 2 + 3', '6'],
    ['1 + 2 + "a"', '3a'],
    ['"a" + 1 + 2', 'a12'],
    ['"a" + (1 + 2)', 'a3'],
  ])('%s is %s', (expr, expected) => {
    expect(print(expr)).toBe(expected);
  });

  it('fails at the operator that mixes a number into shapes, as before', () => {
    expect(() => run(`(${A}) + (${B}) + 1`)).toThrow(/right operand of '\+' must be a shape/);
    expect(() => run(`1 + "a" + (${A})`)).toThrow(/left operand of '\+' must be a shape/);
  });

  it('fuses the shapes before a later operand fails', () => {
    const k = counting();
    expect(() => run(`(${A}) + (${B}) + (${C}) + 1`, k.oc)).toThrow(/must be a shape/);
    expect(k.counts.fuseAll).toBe(1);
  });
});
