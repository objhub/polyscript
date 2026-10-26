/**
 * Error messages a modeller can act on (review of 2026-09-06).
 *
 * Three classes of failure used to be either silent or misleading:
 *  - a boolean mixing a solid with a 2D shape: `(rect) + (box)` returned the
 *    box and dropped the rect; `(box) + (rect)` blamed an empty workplane;
 *    the source form `union [rect, box]` skipped the box;
 *  - an area op on a state with nothing to consume (`box | extrude 5`,
 *    `rect | hole 3`, `rect | place (box)`) returned its input unchanged, so
 *    only the validator -- which cannot see through a variable -- caught it;
 *  - the validator named AST node types (`Implicit2DPrimitive`) instead of
 *    the keyword the user typed.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { parse } from '../src/parser.js';
import { Evaluator } from '../src/evaluator.js';
import { validate, dollarAliases } from '../src/validator.js';
import { initOC } from '../src/ocp-kernel/init.js';
import type { OC, WpState } from '../src/ocp-kernel/types.js';

let oc: OC;
beforeAll(async () => {
  oc = await initOC();
});

function run(source: string): WpState {
  const ev = new Evaluator({ oc, parseFn: parse });
  const v = ev.evaluate(parse(source));
  return (Array.isArray(v) ? v[0] : v) as WpState;
}

function volume(source: string): number {
  return oc.getVolume(run(source).shape!);
}

const MIXED = /cannot combine .* with .*\. Both operands must be solids, or both faces/;

describe('boolean type mismatch: solid x 2D', () => {
  it('face + solid is an error in every spelling, not a silent adoption of the solid', () => {
    expect(() => run('(rect 10 10) + (box 5 5 5)')).toThrow(/union: cannot combine a face with a solid/);
    expect(() => run('rect 10 10 | union (box 5 5 5)')).toThrow(MIXED);
    expect(() => run('union [rect 10 10, box 5 5 5]')).toThrow(MIXED);
  });

  it('face - solid and face * solid name the pair, not an empty workplane', () => {
    expect(() => run('(rect 10 10) - (box 5 5 5)')).toThrow(/diff: cannot combine a face with a solid/);
    expect(() => run('(rect 10 10) * (box 5 5 5)')).toThrow(/inter: cannot combine a face with a solid/);
    expect(() => run('(rect 10 10) - [box 5 5 5, circle 3]')).toThrow(MIXED);
  });

  it('solid x face is the mirror message, with the faces-first hint', () => {
    expect(() => run('(box 10 10 10) + (rect 3 3)')).toThrow(/union: cannot combine a solid with a face.*faces >Z/);
    expect(() => run('box 10 10 10 | diff (rect 3 3)')).toThrow(/diff: cannot combine a solid with a face/);
    expect(() => run('(box 10 10 10) + (wire [(0, 0), (5, 0)])')).toThrow(/cannot combine a solid with a wire/);
  });

  it('source form union/diff with a mismatched element no longer skips it silently', () => {
    expect(() => run('diff [box 10 10 10, rect 5 5]')).toThrow(MIXED);
    expect(() => run('union [box 10 10 10, rect 5 5]')).toThrow(MIXED);
  });

  it('an empty workplane still adopts a solid on union (the documented workplane idiom)', () => {
    expect(volume('workplane XZ | union (box 5 5 5)')).toBeCloseTo(125, 6);
  });

  it('a drawing on a selected face with a solid tool is a 3D boolean and keeps the drawing', () => {
    const v = volume('box 10 10 10 | faces >Z | rect 4 4 | union (cylinder 2 30) | cut 2');
    // box + cylinder through it (overhang 10 above and below), minus 4x4x2 pocket
    expect(v).toBeCloseTo(1000 + 4 * Math.PI * 20 - 32, 3);
  });

  it('the three spellings share one implementation: source form fuses solids exactly like the pipe op', () => {
    const src = volume('union [box 10 10 10, cylinder 3 20]');
    const pipe = volume('box 10 10 10 | union (cylinder 3 20)');
    const op = volume('(box 10 10 10) + (cylinder 3 20)');
    expect(src).toBeCloseTo(pipe, 6);
    expect(op).toBeCloseTo(pipe, 6);
  });

  it('a non-shape operand names the op and the type', () => {
    expect(() => run('box 10 10 10 | diff 5')).toThrow('diff: expected a shape or a list of shapes, got number');
    expect(() => run('box 10 10 10 | union "x"')).toThrow('union: expected a shape or a list of shapes, got string');
    expect(() => run('union [5, box 10 10 10]')).toThrow('union: expected a shape, got number');
  });

  it('a wire operand says what the context holds', () => {
    expect(() => run('wire [(0, 0), (5, 0)] | diff (circle 1)')).toThrow(/diff: a wire has no area -- the context holds 1 wire and no face/);
  });
});

describe('area ops with nothing to consume fail instead of returning their input', () => {
  it('extrude / revolve / loft on a bare solid', () => {
    expect(() => run('box 10 10 10 | extrude 5')).toThrow(/extrude: nothing to extrude -- the context holds a solid, not a face/);
    expect(() => run('box 10 10 10 | revolve Z')).toThrow(/revolve: nothing to revolve -- the context holds a solid/);
    expect(() => run('box 10 10 10 | loft [circle 3] 5')).toThrow(/loft: nothing to loft from/);
  });

  it('extrude on an empty workplane', () => {
    expect(() => run('workplane XY | extrude 5')).toThrow(/extrude: nothing to extrude -- the context holds an empty workplane/);
  });

  it('sweep with no path names the subject/argument roles', () => {
    expect(() => run('box 10 10 10 | sweep (circle 3)')).toThrow(/sweep: nothing to sweep along.*subject is the path/);
  });

  it('cut with nothing drawn, and cut/hole with no solid', () => {
    expect(() => run('box 10 10 10 | faces >Z | cut 2')).toThrow(/cut: nothing is drawn on the selected face/);
    expect(() => run('rect 10 10 | cut')).toThrow(/cut: nothing to cut from -- the context holds a face but no solid/);
    expect(() => run('rect 10 10 | hole 3')).toThrow(/hole: nothing to drill into -- the context holds a face but no solid/);
  });

  it('the same errors reach a variable source the validator cannot type', () => {
    expect(() => run('a = box 10 10 10\na | extrude 5')).toThrow(/nothing to extrude/);
    expect(() => run('a = rect 10 10\na | hole 3')).toThrow(/nothing to drill into/);
  });

  it('place refuses a solid', () => {
    expect(() => run('rect 10 10 | place (box 5 5 5)')).toThrow(/place: expected a 2D shape \(a face or a wire\), got a solid/);
    expect(() => run('rect 10 10 | place 5')).toThrow('place: expected a shape, got number');
  });

  it('revolve across the axis explains the one-sided profile rule', () => {
    expect(() => run('circle 5 | revolve X')).toThrow(/revolve.*one side of the X axis/);
  });

  it('the legitimate forms still work', () => {
    expect(volume('rect 10 10 | extrude 5')).toBeCloseTo(500, 6);
    expect(volume('box 10 10 10 | faces >Z | circle 2 | cut 3')).toBeCloseTo(1000 - 4 * Math.PI * 3, 3);
    expect(volume('box 10 10 10 | faces >Z | hole 2')).toBeCloseTo(1000 - 4 * Math.PI * 10, 3);
    expect(volume('circle 2 at:(10, 0) | revolve Y')).toBeCloseTo(2 * Math.PI * 10 * Math.PI * 4, 2);
  });
});

describe('validator messages name the keyword and the allowed contexts', () => {
  function messages(source: string): string[] {
    return validate(parse(source)).map(e => e.message);
  }

  // The fix lives in `hint`, apart from the message, so a caller can render
  // or drop it independently; `code` is what tooling keys off.
  function first(source: string) {
    return validate(parse(source))[0];
  }

  it('an implicit 2D primitive in 3D context is reported as its keyword with a faces hint', () => {
    const e = first('box 10 10 10 | rect 5 5');
    expect(e.message).toMatch(/^'rect' is not valid in 3D context \(allowed in: .*Workplane.*Face/);
    expect(e.hint).toMatch(/select a face to draw on first/);
    expect(e.message).not.toMatch(/Implicit2DPrimitive/);
    expect(e.code).toBe('context.invalid-op');
    expect(e.line).toBe(1);
  });

  it('a 3D op on an outline suggests extruding first', () => {
    const e = first('rect 10 10 | floor');
    expect(e.message).toMatch(/^'floor' is not valid in Face context \(allowed in: .*3D/);
    expect(e.hint).toMatch(/extrude the outline first/);
  });

  it('translate on an outline says it cannot leave its workplane, not "extrude first"', () => {
    const e = first('rect 10 10 | translate 1 0 0');
    expect(e.message).toMatch(/^'translate' is not valid in Face context \(allowed in: .*3D/);
    expect(e.hint).toMatch(/stays on its workplane.*at:\(5, 5\)/);
  });

  it('an area op on a wire says a wire has no area', () => {
    const e = first('wire [(0, 0), (5, 0)] | extrude 3');
    expect(e.message).toMatch(/^'extrude' is not valid in Wire context/);
    expect(e.hint).toMatch(/a wire has no area/);
  });

  it('a missing required argument is arg.missing, with the position', () => {
    const e = first('box 10 10 10 | edges ">Z" | fillet');
    expect(e.code).toBe('arg.missing');
    expect(e.message).toBe('fillet requires a radius argument');
    expect(e.line).toBe(1);
  });

  it('other ops use their keyword too', () => {
    expect(messages('box 10 10 10 | edges | extrude 3')[0]).toMatch(/^'extrude' is not valid in EdgeSelection context/);
    expect(messages('box 10 10 10 | edges | grid 2 2 5')[0]).toMatch(/^'grid' is not valid/);
    expect(messages('box 10 10 10 | sketch [(0, 0), (1, 0), (1, 1)]')[0]).toMatch(/^'sketch' is not valid/);
    expect(messages('box 10 10 10 | wire [(0, 0), (1, 0)]')[0]).toMatch(/^'wire' is not valid/);
  });
});

describe('built-in names cannot be taken by a def (issue 2026-09-25)', () => {
  function codes(source: string): string[] {
    return validate(parse(source)).map(e => e.code);
  }

  it('a def named like a built-in is def.shadows-builtin', () => {
    const errs = validate(parse('def rad($x) = $x * 2\nbox 1 1 1'));
    expect(errs.map(e => e.code)).toEqual(['def.shadows-builtin']);
    expect(errs[0].message).toMatch(/^'rad' is a built-in function \(degrees → radians\)/);
    expect(errs[0].line).toBe(1);
    expect(codes('def len($a) = 3')).toEqual(['def.shadows-builtin']);
  });

  it('a built-in called with the wrong count is call.arity, wherever the call sits', () => {
    expect(codes('$x = rad(1, 2)')).toEqual(['call.arity']);
    expect(codes('box (sin(1, 2)) 1 1')).toEqual(['call.arity']);
    expect(codes('box 1 1 1 | faces ">Z" | hole (sqrt())')).toEqual(['call.arity']);
    expect(codes('def f($a) = [atan2($a) for $i in range(1, 2, 3, 4)]')).toEqual(['call.arity', 'call.arity']);
    expect(validate(parse('$x = rad(1, 2)'))[0].message).toBe("built-in 'rad' (degrees → radians) takes 1 argument, got 2");
  });

  it('the legal counts pass', () => {
    expect(codes('$x = min(1, 2, 3) + max(4) + atan2(1, 1) + len([1]) + range(1, 5, 2)[0] + range(3)[0]')).toEqual([]);
    expect(codes('def radius_at($R, $k) = $R * cos($k)')).toEqual([]);
  });

  it('the issue\'s pot profile stops at check instead of building a 1mm part', () => {
    const src = 'def rad($R, $k, $t) = $R * (1 + 0.08 * cos(8 * 360 * $k / 48)) - $t\n'
      + 'def px($R, $k, $rot, $t) = rad($R, $k, $t) * cos(360 * $k / 48 + $rot)';
    expect(codes(src)).toEqual(['def.shadows-builtin', 'call.arity']);
  });
});

describe('one variable assigned as name and $name (var.dollar-alias)', () => {
  it('reports the assignment that switches spelling, with the first line', () => {
    const hits = dollarAliases(parse('bore = 5\nbox 1 1 1\n$bore = cylinder 3 10\n$bore = cylinder 2 10'));
    expect(hits).toEqual([{ name: 'bore', dollar: true, first: 1, line: 3, column: 1 }]);
    expect(dollarAliases(parse('$w = 80\nw = 90'))).toMatchObject([{ name: 'w', dollar: false, first: 1, line: 2 }]);
  });

  it('one spelling throughout, or $ only in references, is fine', () => {
    expect(dollarAliases(parse('w = 80\nw = w + 1\nbox $w w 10'))).toEqual([]);
    expect(dollarAliases(parse('$a = box 1 1 1\n$a = $a | fillet 0.1'))).toEqual([]);
  });
});
