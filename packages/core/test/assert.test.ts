/**
 * `assert` / `print` statements, property access and `clear()`: the model
 * states an intent and the build checks it (devel/lang-vision202609.md
 * section 6, devel/ai-friendly202609.md C-1).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { parse, parseExpression } from '../src/parser.js';
import { validate } from '../src/validator.js';
import { Evaluator } from '../src/evaluator.js';
import { initOC } from '../src/ocp-kernel/init.js';
import { drainDiagnostics } from '../src/diagnostics.js';
import { Trace } from '../src/trace.js';
import type { OC } from '../src/ocp-kernel/types.js';

let oc: OC;
beforeAll(async () => {
  oc = await initOC();
});

function run(source: string, trace?: Trace) {
  drainDiagnostics();
  const ev = new Evaluator({ oc, parseFn: parse, trace });
  const result = ev.evaluate(parse(source));
  return { ev, result, diagnostics: drainDiagnostics() };
}

function measure(source: string, query: string) {
  const { ev } = run(source);
  return ev.evalExpr(parseExpression(query));
}

const BOX = '$b = box 80 60 25\n';

describe('property access', () => {
  it('reads the figures of a solid', () => {
    expect(measure(BOX, '$b.volume')).toBe(120000);
    expect(measure(BOX, '$b.solids')).toBe(1);
    expect(measure(BOX, '$b.faces')).toBe(6);
    expect(measure(BOX, '$b.edges')).toBe(12);
    expect(measure(BOX, '$b.verts')).toBe(8);
    expect(measure(BOX, '$b.area')).toBe(2 * (80 * 60 + 80 * 25 + 60 * 25));
    expect(measure(BOX, '$b.valid')).toBe(true);
  });

  it('bbox has sizes and corners', () => {
    expect(measure(BOX, '$b.bbox.x')).toBe(80);
    expect(measure(BOX, '$b.bbox.y')).toBe(60);
    expect(measure(BOX, '$b.bbox.z')).toBe(25);
    expect(measure(BOX, '$b.bbox.min')).toEqual([-40, -30, -12.5]);
    expect(measure(BOX, '$b.bbox.max[2]')).toBe(12.5);
    expect(measure(BOX, '$b.bbox.center')).toEqual([0, 0, 0]);
  });

  it('works on a 2D shape', () => {
    const src = '$r = rect 20 10\n';
    expect(measure(src, '$r.area')).toBe(200);
    expect(measure(src, '$r.faces')).toBe(1);
    expect(measure(src, '$r.wires')).toBe(0);
    expect(measure(src, '$r.bbox.x')).toBe(20);
  });

  it('chains after a parenthesised pipeline and in arithmetic', () => {
    expect(measure(BOX, '($b | faces >Z | shell 2).solids')).toBe(1);
    expect(measure(BOX, '$b.bbox.x * 2 + 1')).toBe(161);
  });

  it('refuses an unknown property with the list that applies', () => {
    expect(() => measure(BOX, '$b.weight')).toThrow(/no property 'weight'.*volume area solids/);
    expect(() => measure(BOX, '$b.bbox.w')).toThrow(/x y z min max center/);
    expect(() => measure('$n = 5\n', '$n.volume')).toThrow(/number has no property/);
  });

  it('is an atom in a command argument when adjacent', () => {
    const v = measure(BOX + '$c = box $b.bbox.x 10 10\n', '$c.volume');
    expect(v).toBe(8000);
  });
});

describe('assert', () => {
  it('passes silently and records a trace row', () => {
    const t = new Trace();
    const { diagnostics, result } = run(BOX + 'assert $b.solids == 1\nassert $b.bbox.z <= 25\n$b\n', t);
    expect(diagnostics).toEqual([]);
    expect(result).not.toBeNull();
    const rows = t.steps.filter((s) => s.op.startsWith('assert'));
    expect(rows.map((r) => [r.op, r.context])).toEqual([
      ['assert $b.solids == 1', 'pass'],
      ['assert $b.bbox.z <= 25', 'pass'],
    ]);
    expect(rows[0].line).toBe(2);
  });

  it('a failure is an error diagnostic that quotes both sides, and the run goes on', () => {
    const t = new Trace();
    const { diagnostics, result } = run(BOX + 'assert $b.solids == 2\nassert $b.volume > 1\n$b\n', t);
    expect(result).not.toBeNull();
    expect(diagnostics).toHaveLength(1);
    const [d] = diagnostics;
    expect(d.code).toBe('assert.failed');
    expect(d.severity).toBe('error');
    expect(d.message).toBe('assert $b.solids == 2 failed (left: 1, right: 2)');
    expect(d.line).toBe(2);
    expect(t.steps.map((s) => s.context)).toEqual(['FAIL', 'pass']);
  });

  it('~ is within 1% of the larger value by default', () => {
    expect(run(BOX + 'assert $b.volume ~ 120500\n').diagnostics).toEqual([]);
    const { diagnostics } = run(BOX + 'assert $b.volume ~ 122000\n');
    expect(diagnostics[0].message).toBe('assert $b.volume ~ 122000 failed (left: 120000, right: 122000, tol: 1%)');
  });

  it('tol: is relative with % and absolute without', () => {
    expect(run(BOX + 'assert $b.volume ~ 122000 tol:2%\n').diagnostics).toEqual([]);
    expect(run(BOX + 'assert $b.bbox.x ~ 80.3 tol:0.5\n').diagnostics).toEqual([]);
    const { diagnostics } = run(BOX + 'assert $b.bbox.x ~ 81 tol:0.5\n');
    expect(diagnostics[0].message).toContain('tol: 0.5)');
  });

  it('a non-boolean condition is a mistake in the assert itself', () => {
    expect(() => run(BOX + 'assert $b.volume\n')).toThrow(/assert expects a condition, got number/);
  });

  it('and / or and clear() work as conditions', () => {
    const src = BOX + '$c = box 10 10 10 at:100 0 0\n$d = box 10 10 10\n';
    expect(run(src + 'assert clear($b, $c)\n').diagnostics).toEqual([]);
    expect(run(src + 'assert $b.solids == 1 and $c.solids == 1\n').diagnostics).toEqual([]);
    const { diagnostics } = run(src + 'assert clear($b, $d)\n');
    expect(diagnostics[0].message).toBe('assert clear($b, $d) failed');
  });

  it('touching solids are clear; overlapping ones are not', () => {
    expect(measure('$a = box 10 10 10\n$b = box 10 10 10 at:10 0 0\n', 'clear($a, $b)')).toBe(true);
    expect(measure('$a = box 10 10 10\n$b = box 10 10 10 at:9 0 0\n', 'clear($a, $b)')).toBe(false);
  });

  it('does not count as a top-level shape', () => {
    const { result } = run('box 10 10 10\nassert true\n');
    expect(result).not.toBeNull();
    expect(Array.isArray(result)).toBe(false);
  });

  it('passes validation and is rejected with trailing junk', () => {
    expect(validate(parse(BOX + 'assert $b.solids == 1 tol:1%\n'))).toEqual([]);
    expect(() => parse('assert 1 == 1 extra\n')).toThrow(/after the assert condition/);
  });
});

describe('print', () => {
  it('reports the values as one info diagnostic per statement', () => {
    const { diagnostics, result } = run(BOX + 'print "vol" $b.volume $b.bbox\nprint $b\n$b\n');
    expect(result).not.toBeNull();
    expect(diagnostics.map((d) => [d.code, d.severity, d.message])).toEqual([
      ['print', 'info', 'vol 120000 80x60x25 at (-40,-30,-12.5)'],
      ['print', 'info', 'solid 1 faces 6 volume 120000'],
    ]);
    expect(diagnostics[0].line).toBe(2);
  });

  it('formats lists, booleans and 2D shapes', () => {
    const { diagnostics } = run('$r = rect 4 2\nprint [1, 2.5] true $r\n');
    expect(diagnostics[0].message).toBe('[1, 2.5] true 2d faces 1 wires 0');
  });
});
