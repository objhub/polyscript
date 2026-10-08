/**
 * Commands and pipelines as function-call arguments, `name(args)` inside a
 * command's arguments, and lines continued by an operator.
 * See devel/call-args202610.md.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { parse } from '../src/parser.js';
import { preprocess } from '../src/preprocessor.js';
import { Evaluator } from '../src/evaluator.js';
import { validate } from '../src/validator.js';
import { initOC } from '../src/ocp-kernel/init.js';
import { shapeInfo } from '../src/ocp-kernel/analysis.js';
import type { OC, WpState } from '../src/ocp-kernel/types.js';
import type { Expression, FuncCall, Statement } from '../src/ast.js';

let oc: OC;
beforeAll(async () => {
  oc = await initOC();
});

function run(source: string): WpState {
  const ev = new Evaluator({ oc, parseFn: parse });
  const v = ev.evaluate(parse(source));
  return (Array.isArray(v) ? v[0] : v) as WpState;
}

function info(source: string) {
  return shapeInfo(oc, run(source).shape!);
}

function last(source: string): Statement {
  const p = parse(source);
  return p.statements[p.statements.length - 1];
}

function call(source: string): FuncCall {
  const s = last(source);
  expect(s.type).toBe('FuncCall');
  return s as FuncCall;
}

const LIFT = 'def lift($s) = $s | translate 0 0 5\n';

describe('function-call arguments are pipelines', () => {
  it('a command is one argument', () => {
    const c = call(`${LIFT}lift(box 10 10 10)`);
    expect(c.args).toHaveLength(1);
    expect(c.args[0].type).toBe('BoxExpr');
  });

  it('a pipeline is one argument', () => {
    const c = call(`${LIFT}lift(box 10 10 10 | fillet 1)`);
    expect(c.args).toHaveLength(1);
    expect(c.args[0].type).toBe('Pipeline');
  });

  it('a comma ends the command\'s greedy arguments', () => {
    const c = call('def lift($s, $h) = $s | translate 0 0 $h\nlift(box 10 10 10, 5)');
    expect(c.args.map((a) => a.type)).toEqual(['BoxExpr', 'NumberLit']);
  });

  it('a boolean command with a list is one argument', () => {
    const c = call(`${LIFT}lift(union [box 10 10 10, sphere 6])`);
    expect(c.args).toHaveLength(1);
  });

  it('a named argument takes a pipeline too', () => {
    const c = call('def lift($s) = $s\nlift(s: box 10 10 10 | fillet 1)');
    expect(c.namedArgs[0].value.type).toBe('Pipeline');
  });

  it('plain expressions read as before', () => {
    const c = call('max($a, $b)');
    expect(c.args.map((a) => a.type)).toEqual(['VarRef', 'VarRef']);
    const n = call('f(floor(3.7))');
    expect(n.args[0].type).toBe('FuncCall');
    const m = call('f($n -1)');
    expect(m.args).toHaveLength(1);
    expect(m.args[0].type).toBe('BinOp');
  });

  it('builds what it says', () => {
    expect(info(`${LIFT}lift(box 10 10 10)`).bbox).toEqual({ min: [-5, -5, 0], max: [5, 5, 10] });
    expect(info(`${LIFT}lift(box 10 10 10 | fillet 1)`).volume).toBeLessThan(1000);
  });
});

describe('name(args) inside a command\'s arguments', () => {
  const R = 'def r($k) = $k * 2\n';

  it('adjacent parentheses are a call', () => {
    const s = last(`${R}cylinder r(3) 10`) as Expression & { args: Expression[] };
    expect(s.args.map((a) => a.type)).toEqual(['FuncCall', 'NumberLit']);
    expect(info(`${R}cylinder r(3) 10`).bbox.max[0]).toBeCloseTo(6);
  });

  it('a space keeps them separate arguments, as before', () => {
    const s = last(`${R}cylinder r (3) 10`) as Expression & { args: Expression[] };
    expect(s.args.map((a) => a.type)).toEqual(['VarRef', 'NumberLit', 'NumberLit']);
  });

  it('a built-in call works in an arithmetic argument', () => {
    const s = last('box sin(30)*10 10 10') as Expression & { args: Expression[] };
    expect(s.args).toHaveLength(3);
    expect(s.args[0].type).toBe('BinOp');
  });

  it('inside the call, the enclosing command\'s greedy rules do not apply', () => {
    // `$a -1` inside the parentheses is a subtraction, not two arguments.
    const s = last(`${R}a = 4\ncylinder r(a -1) 10`) as Expression & { args: Expression[] };
    expect(s.args).toHaveLength(2);
  });
});

describe('operators continue a line', () => {
  it('a leading * / - joins the previous line', () => {
    expect(preprocess('$a\n  * $b').source).toBe('$a * $b');
    expect(preprocess('$a\n  / 2').source).toBe('$a / 2');
    expect(preprocess('$a\n  - $b').source).toBe('$a - $b');
  });

  it('a leading - keeps its spacing: unary when attached, as on one line', () => {
    expect(preprocess('$a\n  -$b').source).toBe('$a -$b');
  });

  it('a trailing operator joins the next line', () => {
    expect(preprocess('$a *\n  $b').source).toBe('$a * $b');
    expect(preprocess('$a -\n  $b').source).toBe('$a - $b');
    expect(preprocess('$a //\n  $b').source).toBe('$a // $b');
    expect(preprocess('$a +\n$b').source).toBe('$a + $b');
  });

  it('selectors and strings are untouched', () => {
    expect(preprocess('box 10 10 10 | faces -Z\nsphere 2').source).toBe('box 10 10 10 | faces -Z\nsphere 2');
    expect(preprocess('text "a -"\nsphere 2').source).toBe('text "a -"\nsphere 2');
  });

  it('a shape operator split over lines builds the same solid', () => {
    const one = info('$a = box 10 10 10\n$b = sphere 6\n$a * $b').volume;
    expect(info('$a = box 10 10 10\n$b = sphere 6\n$c = $a\n  * $b\n$c').volume).toBeCloseTo(one);
    expect(info('$a = box 10 10 10\n$b = sphere 6\n$c = $a *\n  $b\n$c').volume).toBeCloseTo(one);
    const diff = info('$a = box 10 10 10\n$a - (cylinder 1 20)').volume;
    expect(info('$a = (box 10 10 10)\n  - (cylinder 1 20)\n$a').volume).toBeCloseTo(diff);
  });
});

describe('arg.function-value', () => {
  const codes = (src: string) => validate(parse(src)).map((e) => e.code);

  it('a def used as a command argument is reported at check time', () => {
    const errs = validate(parse('def r($k) = $k * 2\ncylinder r (3) 10'));
    expect(errs.map((e) => e.code)).toEqual(['arg.function-value']);
    expect(errs[0]).toMatchObject({ line: 2, column: 10 });
  });

  it('and under an operator', () => {
    expect(codes('def r($k) = $k * 2\nx = r + 1\nbox x x x')).toEqual(['arg.function-value']);
  });

  it('not when the call is written', () => {
    expect(codes('def r($k) = $k * 2\ncylinder r(3) 10')).toEqual([]);
  });

  it('not when the name is also a variable, a parameter or a loop variable', () => {
    expect(codes('def r($k) = $k * 2\nr = 4\ncylinder r (3) 10')).toEqual([]);
    expect(codes('def r($k) = $k * 2\ndef g($r) = cylinder r 10\ng(3)')).toEqual([]);
    expect(codes('def r($k) = $k * 2\nxs = [r * 2 for r in [1, 2]]')).toEqual([]);
  });

  it('not as an argument of a user function, which may call it', () => {
    expect(codes('def apply($f, $x) = f($x)\ndef dbl($k) = $k * 2\ncylinder apply(dbl, 3) 10')).toEqual([]);
  });
});
