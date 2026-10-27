/**
 * Tests for boolean operations: diff, union, inter.
 * Covers parser, validator, and evaluator aspects (pipe ops and source commands).
 */
import { describe, it, expect } from 'vitest';
import { parse } from '../src/parser.js';
import { validate } from '../src/validator.js';
import { Evaluator } from '../src/evaluator.js';
import type { Expression, PipeOp, Statement } from '../src/ast.js';
import type { WpState } from '../src/ocp-kernel.js';

function parseFirst(source: string): Statement {
  const program = parse(source);
  expect(program.statements.length).toBeGreaterThan(0);
  return program.statements[0];
}

function parsePipeline(source: string): { source: Expression; ops: PipeOp[] } {
  const stmt = parseFirst(source);
  if (stmt.type === 'Pipeline') return { source: stmt.source, ops: stmt.ops };
  return { source: stmt as Expression, ops: [] };
}

function getErrors(source: string) {
  const ast = parse(source);
  return validate(ast);
}

function isWpState(v: any): v is WpState {
  return v !== null && typeof v === 'object' && 'oc' in v && 'plane' in v;
}

function createMockOC() {
  let handleCounter = 100;
  const nextHandle = () => ++handleCounter as any;
  const calls: { method: string; args: any[] }[] = [];
  const mock = {
    _calls: calls,
    makeLineEdge(start: any, end: any) { calls.push({ method: 'makeLineEdge', args: [start, end] }); return nextHandle(); },
    makeWire(edges: any[]) { calls.push({ method: 'makeWire', args: [edges] }); return nextHandle(); },
    makeFace(wire: any) { calls.push({ method: 'makeFace', args: [wire] }); return nextHandle(); },
    makeCircleEdge(center: any, normal: any, r: number) { calls.push({ method: 'makeCircleEdge', args: [center, normal, r] }); return nextHandle(); },
    makeEllipseEdge(center: any, normal: any, major: number, minor: number) { calls.push({ method: 'makeEllipseEdge', args: [center, normal, major, minor] }); return nextHandle(); },
    extrude(shape: any, dx: number, dy: number, dz: number) { calls.push({ method: 'extrude', args: [shape, dx, dy, dz] }); return nextHandle(); },
    fillet(shape: any, edges: any[], r: number) { calls.push({ method: 'fillet', args: [shape, edges, r] }); return nextHandle(); },
    chamfer(shape: any, edges: any[], d: number) { calls.push({ method: 'chamfer', args: [shape, edges, d] }); return nextHandle(); },
    shell(shape: any, faces: any[], t: number) { calls.push({ method: 'shell', args: [shape, faces, t] }); return nextHandle(); },
    fuse(a: any, b: any) { calls.push({ method: 'fuse', args: [a, b] }); return nextHandle(); },
    cut(a: any, b: any) { calls.push({ method: 'cut', args: [a, b] }); return nextHandle(); },
    common(a: any, b: any) { calls.push({ method: 'common', args: [a, b] }); return nextHandle(); },
    fuseAll(shapes: any[]) { calls.push({ method: 'fuseAll', args: [shapes] }); return nextHandle(); },
    unifySameDomain(shape: any) { calls.push({ method: 'unifySameDomain', args: [shape] }); return nextHandle(); },
    translate(shape: any, dx: number, dy: number, dz: number) { calls.push({ method: 'translate', args: [shape, dx, dy, dz] }); return nextHandle(); },
    rotate(shape: any, axis: any, angle: number) { calls.push({ method: 'rotate', args: [shape, axis, angle] }); return nextHandle(); },
    scale(shape: any, center: any, factor: number) { calls.push({ method: 'scale', args: [shape, center, factor] }); return nextHandle(); },
    generalTransform(shape: any, matrix: number[]) { calls.push({ method: 'generalTransform', args: [shape, matrix] }); return nextHandle(); },
    makeBox(dx: number, dy: number, dz: number) { calls.push({ method: 'makeBox', args: [dx, dy, dz] }); return nextHandle(); },
    makeCylinder(r: number, h: number) { calls.push({ method: 'makeCylinder', args: [r, h] }); return nextHandle(); },
    makeSphere(r: number) { calls.push({ method: 'makeSphere', args: [r] }); return nextHandle(); },
    pipe(face: any, spine: any) { calls.push({ method: 'pipe', args: [face, spine] }); return nextHandle(); },
    buildCurves3d(wire: any) { calls.push({ method: 'buildCurves3d', args: [wire] }); },
    interpolatePoints(pts: any[]) { calls.push({ method: 'interpolatePoints', args: [pts] }); return nextHandle(); },
    getBoundingBox(_shape: any) { return { xmin: -5, ymin: -5, zmin: -5, xmax: 5, ymax: 5, zmax: 5 }; },
    getBoundingBoxFast(_shape: any) { return { xmin: -5, ymin: -5, zmin: -5, xmax: 5, ymax: 5, zmax: 5 }; },
    getSubShapes(_shape: any, type: string) {
      if (type === 'edge') return [nextHandle(), nextHandle(), nextHandle()];
      if (type === 'face') return [nextHandle()];
      return [];
    },
    getCenterOfMass(_face: any) { return { x: 0, y: 0, z: 5 }; },
    uvBounds(_face: any) { return { uMin: 0, uMax: 1, vMin: 0, vMax: 1 }; },
    surfaceNormal(_face: any, _u: number, _v: number) { return { x: 0, y: 0, z: 1 }; },
    makeHelixWire(origin: any, axis: any, pitch: number, height: number, radius: number) {
      calls.push({ method: 'makeHelixWire', args: [origin, axis, pitch, height, radius] });
      return nextHandle();
    },
  } as any;
  return mock;
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

describe('boolean operations', () => {
  describe('parser', () => {
    it('parses diff with nested shape', () => {
      const { ops } = parsePipeline('box 80 60 10 | diff (cylinder 10 10)');
      expect(ops[0].type).toBe('Diff');
      if (ops[0].type === 'Diff') {
        expect(ops[0].args[0].type).toBe('CylinderExpr');
      }
    });

    it('parses diff with inline cylinder', () => {
      const { ops } = parsePipeline('box 10 10 10 | diff cylinder 10 5');
      expect(ops[0].type).toBe('Diff');
      if (ops[0].type === 'Diff') {
        expect(ops[0].args).toHaveLength(1);
        expect(ops[0].args[0].type).toBe('CylinderExpr');
      }
    });

    it('parses union with inline sphere', () => {
      const { ops } = parsePipeline('box 10 10 10 | union sphere 5');
      expect(ops[0].type).toBe('Union');
      if (ops[0].type === 'Union') {
        expect(ops[0].args).toHaveLength(1);
        expect(ops[0].args[0].type).toBe('SphereExpr');
      }
    });

    it('parses inter with inline box', () => {
      const { ops } = parsePipeline('box 10 10 10 | inter box 5 5 5');
      expect(ops[0].type).toBe('Inter');
      if (ops[0].type === 'Inter') {
        expect(ops[0].args).toHaveLength(1);
        expect(ops[0].args[0].type).toBe('BoxExpr');
      }
    });

    it('parses a user-defined shape function as an inline union operand', () => {
      // Same greedy delegation a built-in gets: the operand is one call,
      // not a variable reference followed by three stray positional args.
      // Python has always parsed it this way; TS used to fail at evaluation
      // with "Expected shape/workplane state" (found 2026-09-02 while
      // building the README examples).
      const { ops } = parsePipeline('box 80 60 3 | union standoff 4 10 1.5');
      expect(ops[0].type).toBe('Union');
      if (ops[0].type === 'Union') {
        expect(ops[0].args).toHaveLength(1);
        const call = ops[0].args[0];
        expect(call.type).toBe('FuncCall');
        if (call.type === 'FuncCall') {
          expect(call.name).toBe('standoff');
          expect(call.args).toHaveLength(3);
        }
      }
    });

    it('still treats a bare identifier operand as a variable reference', () => {
      const { ops } = parsePipeline('box 80 60 10 | diff holes');
      expect(ops[0].type).toBe('Diff');
      if (ops[0].type === 'Diff') {
        expect(ops[0].args).toHaveLength(1);
        expect(ops[0].args[0].type).toBe('VarRef');
      }
    });

    it('parses variable reference in diff', () => {
      const stmt = parseFirst('box 80 60 10 | diff $holes');
      if (stmt.type === 'Pipeline') {
        const diff = stmt.ops[0];
        if (diff.type === 'Diff') {
          expect(diff.args[0].type).toBe('VarRef');
        }
      }
    });

    it('union [...] produces Union with ListLit arg', () => {
      const stmt = parseFirst('union [box 10 10 10, sphere 5]');
      expect(stmt.type).toBe('Union');
      if (stmt.type === 'Union') {
        expect(stmt.args[0].type).toBe('ListLit');
      }
    });

    it('diff [...] produces Diff with ListLit arg', () => {
      const stmt = parseFirst('diff [box 10 10 10, sphere 5]');
      expect(stmt.type).toBe('Diff');
      if (stmt.type === 'Diff') {
        expect(stmt.args[0].type).toBe('ListLit');
      }
    });

    it('parses union with comma-separated list', () => {
      const stmt = parseFirst(`union [
  box 10 10 10,
  sphere 5,
  cylinder 10 5
]`);
      expect(stmt.type).toBe('Union');
      if (stmt.type === 'Union') {
        expect(stmt.args).toHaveLength(1);
        const list = stmt.args[0];
        expect(list.type).toBe('ListLit');
        if (list.type === 'ListLit') {
          expect(list.elements).toHaveLength(3);
        }
      }
    });

    it('parses union with at named arg', () => {
      const stmt = parseFirst('union [box 10 10 10, sphere 5] at:(20, 20)');
      expect(stmt.type).toBe('Union');
      if (stmt.type === 'Union') {
        expect(stmt.namedArgs).toHaveLength(1);
        expect(stmt.namedArgs[0].key).toBe('at');
        expect(stmt.namedArgs[0].value.type).toBe('TupleLit');
      }
    });

    it('parses union source with list of shapes including at:', () => {
      const stmt = parseFirst(`union [
  cylinder 10 20,
  cylinder 2.5 20 at:(20, 10)
]`);
      expect(stmt.type).toBe('Union');
      if (stmt.type === 'Union') {
        expect(stmt.args).toHaveLength(1);
        expect(stmt.args[0].type).toBe('ListLit');
        if (stmt.args[0].type === 'ListLit') {
          expect(stmt.args[0].elements).toHaveLength(2);
          expect(stmt.args[0].elements[0].type).toBe('CylinderExpr');
          const el1 = stmt.args[0].elements[1];
          expect(el1.type).toBe('CylinderExpr');
          if (el1.type === 'CylinderExpr') {
            expect(el1.namedArgs).toHaveLength(1);
            expect(el1.namedArgs[0].key).toBe('at');
            expect(el1.namedArgs[0].value.type).toBe('TupleLit');
          }
        }
      }
    });

    it('parses inline union with list', () => {
      const stmt = parseFirst('union [(cylinder 10 20), (cylinder 2.5 20)]');
      expect(stmt.type).toBe('Union');
      if (stmt.type === 'Union') {
        expect(stmt.args).toHaveLength(1);
        expect(stmt.args[0].type).toBe('ListLit');
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Validator
  // ---------------------------------------------------------------------------

  describe('validator', () => {
    it('reports missing diff shape', () => {
      const errors = getErrors('box 10 10 10 | diff');
      const diffErrors = errors.filter(e => e.nodeType === 'Diff');
      expect(diffErrors.length).toBeGreaterThan(0);
    });

    it('reports missing union shape', () => {
      const errors = getErrors('box 10 10 10 | union');
      const unionErrors = errors.filter(e => e.nodeType === 'Union');
      expect(unionErrors.length).toBeGreaterThan(0);
      expect(unionErrors[0].message).toContain('union requires a shape');
    });

    it('reports missing inter shape', () => {
      const errors = getErrors('box 10 10 10 | inter');
      const interErrors = errors.filter(e => e.nodeType === 'Inter');
      expect(interErrors.length).toBeGreaterThan(0);
      expect(interErrors[0].message).toContain('inter requires a shape');
    });

    it('union transitions to 3D', () => {
      const errors = getErrors('box 10 10 10 | union (sphere 5) | fillet 2');
      expect(errors).toHaveLength(0);
    });

    it('inter transitions to 3D', () => {
      const errors = getErrors('box 10 10 10 | inter (sphere 5) | fillet 2');
      expect(errors).toHaveLength(0);
    });

    // A boolean operand that cannot be resolved statically (a variable, or a
    // pipeline headed by one) must not be assumed to be 3D -- that rejected
    // these legal 2D pipelines.
    it('accepts a source-form boolean over a variable profile', () => {
      const errors = getErrors('$p = circle 5\nunion [$p, rect 20 4] | extrude 3');
      expect(errors).toHaveLength(0);
    });

    it('accepts a source-form boolean over a pipeline headed by a variable', () => {
      const errors = getErrors('$p = circle 5\nunion [$p | polar 6 10, rect 20 4] | extrude 3');
      expect(errors).toHaveLength(0);
    });

    it('accepts a pipe-form boolean on a pipeline headed by a variable', () => {
      // The gear pattern: one tooth in a variable, replicated and merged with
      // a root disc before extruding. The unknown source context must not be
      // recovered as 3D by the ops that precede the extrude.
      const errors = getErrors('$t = circle 5\n$t | polar 6 0 orient:true | union (circle 9) | extrude 3');
      expect(errors).toHaveLength(0);
    });

    it('still reports a genuine 3D-context error after a context-fixing op', () => {
      const errors = getErrors('$t = circle 5\n$t | extrude 3 | extrude 2');
      expect(errors.length).toBeGreaterThan(0);
    });

    it('diff transitions to 3D', () => {
      const errors = getErrors('box 10 10 10 | diff (sphere 5) | fillet 2');
      expect(errors).toHaveLength(0);
    });

    it('accepts union/diff/inter in 2D context', () => {
      // 2D booleans operate face-level on wires (annulus, merged outline, etc.)
      expect(getErrors('circle 10 | diff (circle 3) | extrude 5')).toHaveLength(0);
      expect(getErrors('circle 10 | union (rect 5 5) | extrude 5')).toHaveLength(0);
      expect(getErrors('circle 10 | inter (rect 5 5) | extrude 5')).toHaveLength(0);
    });

    it('treats union as 3D source context', () => {
      const errors = getErrors('union [box 10 10 10, sphere 5] | fillet 2');
      expect(errors).toHaveLength(0);
    });

    it('treats diff as 3D source context', () => {
      const errors = getErrors('diff [box 10 10 10, sphere 5] | fillet 2');
      expect(errors).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Evaluator
  // ---------------------------------------------------------------------------

  describe('evaluator', () => {
    // A list operand on a boolean *pipe op* folds left, one kernel call per
    // element -- the order Python uses. This path was completely broken until
    // 2026-09-02 (even SPEC's own `diff [sphere 10, box 5 5 5]` failed with
    // "Expected shape/workplane state"); the 26 regression examples only ever
    // used `union [...]` in source position, which is a different code path.
    it('diff [a, b] cuts each element in turn', () => {
      const oc = createMockOC();
      const evaluator = new Evaluator({ oc });
      const ast = parse('box 20 20 20 | diff [cylinder 3 30, sphere 4]');
      const result = evaluator.evaluate(ast);

      expect(isWpState(result)).toBe(true);
      const cuts = oc._calls.filter((c: any) => c.method === 'cut');
      expect(cuts.length).toBe(2);
      // the fold threads the result: the second cut's base is not the
      // original box but whatever the first cut returned
      expect(cuts[1].args[0]).not.toBe(cuts[0].args[0]);
    });

    it('union [a, b] with variables fuses all three in one n-ary fuse', () => {
      const oc = createMockOC();
      const evaluator = new Evaluator({ oc });
      const ast = parse('b = cylinder 3 30\nc = sphere 4\nbox 20 20 20 | union [b, c]');
      const result = evaluator.evaluate(ast);

      expect(isWpState(result)).toBe(true);
      expect(oc._calls.filter((c: any) => c.method === 'fuse').length).toBe(0);
      const all = oc._calls.filter((c: any) => c.method === 'fuseAll');
      expect(all.length).toBe(1);
      expect(all[0].args[0].length).toBe(3);
    });

    it('a parenthesised pipeline is a value inside if/then/else', () => {
      // `(body | union divider)` used to be read as an arithmetic group and
      // fail at the `|` (ex2/23_parametric_box).
      const oc = createMockOC();
      const evaluator = new Evaluator({ oc });
      const ast = parse('body = box 20 20 20\ndiv = box 2 20 20\nr = if true then (body | union div) else body\nr');
      const result = evaluator.evaluate(ast);

      expect(isWpState(result)).toBe(true);
      expect(oc._calls.filter((c: any) => c.method === 'fuse').length).toBe(1);
    });

    // union + chamfer/fillet
    it('union followed by chamfer calls fuse then chamfer', () => {
      const oc = createMockOC();
      const evaluator = new Evaluator({ oc });
      const ast = parse('box 10 10 10 | union (cylinder 30 4) | chamfer 1');
      const result = evaluator.evaluate(ast);

      expect(isWpState(result)).toBe(true);
      const fuseCalls = oc._calls.filter((c: any) => c.method === 'fuse');
      const chamferCalls = oc._calls.filter((c: any) => c.method === 'chamfer');
      expect(fuseCalls.length).toBeGreaterThanOrEqual(1);
      expect(chamferCalls.length).toBe(1);
      expect(chamferCalls[0].args[2]).toBe(1);
    });

    it('union followed by fillet calls fuse then fillet', () => {
      const oc = createMockOC();
      const evaluator = new Evaluator({ oc });
      const ast = parse('box 10 10 10 | union (cylinder 30 4) | fillet 2');
      const result = evaluator.evaluate(ast);

      expect(isWpState(result)).toBe(true);
      const fuseCalls = oc._calls.filter((c: any) => c.method === 'fuse');
      const filletCalls = oc._calls.filter((c: any) => c.method === 'fillet');
      expect(fuseCalls.length).toBeGreaterThanOrEqual(1);
      expect(filletCalls.length).toBe(1);
      expect(filletCalls[0].args[2]).toBe(2);
    });

    it('union + face selection + chamfer', () => {
      const oc = createMockOC();
      const evaluator = new Evaluator({ oc });
      const ast = parse('box 10 10 10 | union (cylinder 30 4) | faces >Z | chamfer 1');
      const result = evaluator.evaluate(ast);

      expect(isWpState(result)).toBe(true);
      const fuseCalls = oc._calls.filter((c: any) => c.method === 'fuse');
      const chamferCalls = oc._calls.filter((c: any) => c.method === 'chamfer');
      expect(fuseCalls.length).toBeGreaterThanOrEqual(1);
      expect(chamferCalls.length).toBe(1);
    });

    it('union + face selection + fillet', () => {
      const oc = createMockOC();
      const evaluator = new Evaluator({ oc });
      const ast = parse('box 10 10 10 | union (cylinder 30 4) | faces >Z | fillet 2');
      const result = evaluator.evaluate(ast);

      expect(isWpState(result)).toBe(true);
      const fuseCalls = oc._calls.filter((c: any) => c.method === 'fuse');
      const filletCalls = oc._calls.filter((c: any) => c.method === 'fillet');
      expect(fuseCalls.length).toBeGreaterThanOrEqual(1);
      expect(filletCalls.length).toBe(1);
      expect(filletCalls[0].args[2]).toBe(2);
    });

    it('diff followed by fillet calls cut then fillet', () => {
      const oc = createMockOC();
      const evaluator = new Evaluator({ oc });
      const ast = parse('box 10 10 10 | diff (cylinder 20 3) | fillet 1');
      const result = evaluator.evaluate(ast);

      expect(isWpState(result)).toBe(true);
      const cutCalls = oc._calls.filter((c: any) => c.method === 'cut');
      const filletCalls = oc._calls.filter((c: any) => c.method === 'fillet');
      expect(cutCalls.length).toBeGreaterThanOrEqual(1);
      expect(filletCalls.length).toBe(1);
    });

    // 2D union source (face-level boolean): wires are converted to faces and
    // merged via OCC fuse, then a single extrude produces one solid.
    it('union [rect, rect] | extrude produces face-level fuse and one extrude', () => {
      const oc = createMockOC();
      const evaluator = new Evaluator({ oc });
      const ast = parse('union [rect 50 10, rect 10 40] | extrude 5');
      const result = evaluator.evaluate(ast);

      expect(isWpState(result)).toBe(true);
      const makeWireCalls = oc._calls.filter((c: any) => c.method === 'makeWire');
      const extrudeCalls = oc._calls.filter((c: any) => c.method === 'extrude');
      // Two rects → two wires built, faces formed, fused, single extrude.
      expect(makeWireCalls.length).toBe(2);
      expect(extrudeCalls.length).toBe(1);
      // At least one fuse (face-level) before extrude.
      const fuseLike = oc._calls.filter((c: any) => c.method === 'fuse' || c.method === 'fuseAll');
      expect(fuseLike.length).toBeGreaterThanOrEqual(1);
    });

    it('union [circle, circle] | extrude produces single extrude', () => {
      const oc = createMockOC();
      const evaluator = new Evaluator({ oc });
      const ast = parse('union [circle 10, circle 5] | extrude 3');
      const result = evaluator.evaluate(ast);

      expect(isWpState(result)).toBe(true);
      const extrudeCalls = oc._calls.filter((c: any) => c.method === 'extrude');
      expect(extrudeCalls.length).toBe(1);
    });

    it('union [rect, circle, rect] | extrude produces single extrude', () => {
      const oc = createMockOC();
      const evaluator = new Evaluator({ oc });
      const ast = parse('union [rect 20 5, circle 3, rect 5 20] | extrude 10');
      const result = evaluator.evaluate(ast);

      expect(isWpState(result)).toBe(true);
      const extrudeCalls = oc._calls.filter((c: any) => c.method === 'extrude');
      expect(extrudeCalls.length).toBe(1);
    });

    it('circle | diff (circle) | extrude produces annulus via face cut', () => {
      const oc = createMockOC();
      const evaluator = new Evaluator({ oc });
      const ast = parse('circle 10 | diff (circle 3) | extrude 5');
      const result = evaluator.evaluate(ast);

      expect(isWpState(result)).toBe(true);
      const cutCalls = oc._calls.filter((c: any) => c.method === 'cut');
      const extrudeCalls = oc._calls.filter((c: any) => c.method === 'extrude');
      // 2D cut on the assembled face, then a single prism on the result.
      expect(cutCalls.length).toBe(1);
      expect(extrudeCalls.length).toBe(1);
    });

    it('circle | inter (rect) | extrude produces face common', () => {
      const oc = createMockOC();
      const evaluator = new Evaluator({ oc });
      const ast = parse('circle 10 | inter (rect 5 5) | extrude 3');
      const result = evaluator.evaluate(ast);

      expect(isWpState(result)).toBe(true);
      const commonCalls = oc._calls.filter((c: any) => c.method === 'common');
      const extrudeCalls = oc._calls.filter((c: any) => c.method === 'extrude');
      expect(commonCalls.length).toBe(1);
      expect(extrudeCalls.length).toBe(1);
    });

    it('circle | union (rect) | extrude produces face fuse', () => {
      const oc = createMockOC();
      const evaluator = new Evaluator({ oc });
      const ast = parse('circle 10 | union (rect 5 5) | extrude 3');
      const result = evaluator.evaluate(ast);

      expect(isWpState(result)).toBe(true);
      const fuseCalls = oc._calls.filter((c: any) => c.method === 'fuse');
      const extrudeCalls = oc._calls.filter((c: any) => c.method === 'extrude');
      expect(fuseCalls.length).toBeGreaterThanOrEqual(1);
      expect(extrudeCalls.length).toBe(1);
    });

    it('union [rect] single element has one wire, no fuse', () => {
      const oc = createMockOC();
      const evaluator = new Evaluator({ oc });
      const ast = parse('union [rect 50 10] | extrude 5');
      const result = evaluator.evaluate(ast);

      expect(isWpState(result)).toBe(true);
      const extrudeCalls = oc._calls.filter((c: any) => c.method === 'extrude');
      const fuseCalls = oc._calls.filter((c: any) => c.method === 'fuse');
      expect(extrudeCalls.length).toBe(1);
      expect(fuseCalls.length).toBe(0);
    });

    // implicit union of multiple top-level shapes
    it('returns array of WpStates when multiple top-level shapes exist', () => {
      const oc = createMockOC();
      const evaluator = new Evaluator({ oc });
      const ast = parse('box 10 10 10\ncylinder 20 5');
      const result = evaluator.evaluate(ast);

      expect(Array.isArray(result)).toBe(true);
      const arr = result as WpState[];
      expect(arr).toHaveLength(2);
      expect(isWpState(arr[0])).toBe(true);
      expect(isWpState(arr[1])).toBe(true);
    });

    it('getShape() fuses multiple top-level shapes', () => {
      const oc = createMockOC();
      const evaluator = new Evaluator({ oc });
      const ast = parse('box 10 10 10\ncylinder 20 5\nsphere 3');
      const result = evaluator.evaluate(ast);

      expect(Array.isArray(result)).toBe(true);
      const shape = evaluator.getShape(result);
      expect(shape).not.toBeNull();
      const fuseCalls = oc._calls.filter((c: any) => c.method === 'fuse');
      expect(fuseCalls).toHaveLength(2);
    });

    it('single top-level shape returns WpState directly (not array)', () => {
      const oc = createMockOC();
      const evaluator = new Evaluator({ oc });
      const ast = parse('box 10 10 10');
      const result = evaluator.evaluate(ast);

      expect(Array.isArray(result)).toBe(false);
      expect(isWpState(result)).toBe(true);
    });

    it('assignment followed by shape returns only the shape (not array)', () => {
      const oc = createMockOC();
      const evaluator = new Evaluator({ oc });
      const ast = parse('$w = 10\nbox $w $w $w');
      const result = evaluator.evaluate(ast);

      expect(Array.isArray(result)).toBe(false);
      expect(isWpState(result)).toBe(true);
    });

    it('multiple shapes with intermediate assignment returns array of shapes only', () => {
      const oc = createMockOC();
      const evaluator = new Evaluator({ oc });
      const ast = parse('box 10 10 10\n$w = 5\ncylinder 20 $w');
      const result = evaluator.evaluate(ast);

      expect(Array.isArray(result)).toBe(true);
      const arr = result as WpState[];
      expect(arr).toHaveLength(2);
    });
  });
});
