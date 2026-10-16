/**
 * Tests for selection operations: faces, edges, verts, selectors, compound selectors, as tag, workplane, points.
 * Covers parser, validator, and evaluator aspects.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '../src/parser.js';
import { validate } from '../src/validator.js';
import { evaluateExpressions } from '../src/evaluator.js';
import { selectItems } from '../src/ocp-kernel/selector.js';
import type { Expression, PipeOp, Statement } from '../src/ast.js';

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

// ---------------------------------------------------------------------------
// Parser — faces/edges/verts
// ---------------------------------------------------------------------------

describe('selection', () => {
  describe('parser', () => {
    it('parses faces select', () => {
      const { ops } = parsePipeline('box 10 10 10 | faces >Z');
      expect(ops[0].type).toBe('FacesSelect');
      if (ops[0].type === 'FacesSelect') {
        expect(ops[0].args[0]).toMatchObject({ type: 'SelectorLit', value: '>Z' });
      }
    });

    it('parses faces with as tag', () => {
      const { ops } = parsePipeline('box 10 10 10 | faces <X as $left');
      expect(ops[0].type).toBe('FacesSelect');
      if (ops[0].type === 'FacesSelect') {
        expect(ops[0].tag).toBe('left');
      }
    });

    it('parses edges select with parallel selector', () => {
      const { ops } = parsePipeline('box 10 10 10 | edges =Z');
      expect(ops[0].type).toBe('EdgesSelect');
      if (ops[0].type === 'EdgesSelect') {
        expect(ops[0].args[0]).toMatchObject({ type: 'SelectorLit', value: '=Z' });
      }
    });

    it('parses verts select with selector', () => {
      const { ops } = parsePipeline('box 10 10 10 | verts >Z');
      expect(ops[0].type).toBe('VertsSelect');
      if (ops[0].type === 'VertsSelect') {
        expect(ops[0].args[0]).toMatchObject({ type: 'SelectorLit', value: '>Z' });
      }
    });

    it('parses verts select without selector', () => {
      const { ops } = parsePipeline('box 10 10 10 | verts');
      expect(ops[0].type).toBe('VertsSelect');
      if (ops[0].type === 'VertsSelect') {
        expect(ops[0].args).toHaveLength(0);
      }
    });

    it('parses verts with as tag', () => {
      const { ops } = parsePipeline('box 10 10 10 | verts >Z as $top');
      expect(ops[0].type).toBe('VertsSelect');
      if (ops[0].type === 'VertsSelect') {
        expect(ops[0].tag).toBe('top');
      }
    });

    it('rejects old "vertices" keyword', () => {
      expect(() => parse('box 10 10 10 | vertices >Z')).toThrow();
    });

    it('parses verts in 2D context (after rect)', () => {
      const { source, ops } = parsePipeline('rect 70 50 | verts | circle 1');
      expect(source.type).toBe('RectExpr');
      expect(ops[0].type).toBe('VertsSelect');
      expect(ops[1].type).toBe('Implicit2DPrimitive');
    });

    it('parses full combined example', () => {
      const { source, ops } = parsePipeline('box 80 60 10 | faces >Z | rect 70 50 | verts | circle 1 | cut');
      expect(source.type).toBe('BoxExpr');
      expect(ops[0].type).toBe('FacesSelect');
      expect(ops[1].type).toBe('Implicit2DPrimitive');
      expect(ops[2].type).toBe('VertsSelect');
      expect(ops[3].type).toBe('Implicit2DPrimitive');
      expect(ops[4].type).toBe('Cut');
    });

    it('parses workplane', () => {
      const { ops } = parsePipeline('box 10 10 10 | faces >Z | workplane');
      expect(ops[1].type).toBe('Workplane');
    });

    it('parses workplane with origin', () => {
      const { ops } = parsePipeline('box 10 10 10 | faces >Z | workplane origin: 0 0 0');
      expect(ops[1].type).toBe('Workplane');
      if (ops[1].type === 'Workplane') {
        expect(ops[1].namedArgs).toHaveLength(1);
        expect(ops[1].namedArgs[0].key).toBe('origin');
      }
    });

    it('parses points with list of tuples', () => {
      const { ops } = parsePipeline('box 10 10 10 | faces >Z | points [(5, 0), (0, 5), (-5, 0), (0, -5)]');
      expect(ops[1].type).toBe('PointsSelect');
      if (ops[1].type === 'PointsSelect') {
        expect(ops[1].args).toHaveLength(1);
      }
    });

    it('parses standalone as $tag', () => {
      const { ops } = parsePipeline('box 10 10 10 | as $myBox');
      expect(ops[0].type).toBe('AsTag');
      if (ops[0].type === 'AsTag') {
        expect(ops[0].name).toBe('myBox');
      }
    });

    it('parses edges with as tag', () => {
      const { ops } = parsePipeline('box 10 10 10 | edges >Z as $topEdges');
      expect(ops[0].type).toBe('EdgesSelect');
      if (ops[0].type === 'EdgesSelect') {
        expect(ops[0].tag).toBe('topEdges');
      }
    });

    // Selector notation
    it('parses all selector types in greedy args', () => {
      const { ops } = parsePipeline('box 10 10 10 | faces >Z');
      if (ops[0].type === 'FacesSelect') {
        expect(ops[0].args[0]).toMatchObject({ type: 'SelectorLit', value: '>Z' });
      }
    });

    it('resolves a name alias only as a selection argument', () => {
      const { ops } = parsePipeline('box 10 10 10 | faces top');
      expect(ops[0]).toMatchObject({ type: 'FacesSelect', args: [{ type: 'SelectorLit', value: '>Z' }] });
      const list = parsePipeline('box 10 10 10 | edges [top, bottom]').ops[0] as { args: unknown[] };
      expect(list.args[0]).toMatchObject({ type: 'ListLit', elements: [{ value: '>Z' }, { value: '<Z' }] });
      // Elsewhere `top` is an identifier: a variable can be called top
      // (devel/TODO.md 2026-10-07: `top = 20` then `rect 28 top` broke).
      const stmt = parseFirst('$x = top');
      if (stmt.type === 'Assignment') {
        expect(stmt.value).toMatchObject({ type: 'VarRef', name: 'top' });
      }
      const rect = parsePipeline('rect 28 top').source as { args: unknown[] };
      expect(rect.args[1]).toMatchObject({ type: 'VarRef', name: 'top' });
    });

    it('parses all axis variants: X, Y, Z', () => {
      for (const axis of ['X', 'Y', 'Z']) {
        for (const sym of ['>', '<', '=', '+']) {
          const sel = sym + axis;
          const { ops } = parsePipeline(`box 10 10 10 | faces ${sel}`);
          expect(ops[0].type).toBe('FacesSelect');
          if (ops[0].type === 'FacesSelect') {
            expect(ops[0].args[0]).toMatchObject({ type: 'SelectorLit', value: sel });
          }
        }
      }
    });

    // Name aliases
    it('parses top alias as selector', () => {
      const { ops } = parsePipeline('box 10 10 10 | faces top');
      if (ops[0].type === 'FacesSelect') {
        expect(ops[0].args[0]).toMatchObject({ type: 'SelectorLit', value: '>Z' });
      }
    });

    it('parses bottom alias as selector', () => {
      const { ops } = parsePipeline('box 10 10 10 | faces bottom');
      if (ops[0].type === 'FacesSelect') {
        expect(ops[0].args[0]).toMatchObject({ type: 'SelectorLit', value: '<Z' });
      }
    });

    it('parses right alias as selector', () => {
      const { ops } = parsePipeline('box 10 10 10 | faces right');
      if (ops[0].type === 'FacesSelect') {
        expect(ops[0].args[0]).toMatchObject({ type: 'SelectorLit', value: '>X' });
      }
    });

    it('parses left alias as selector', () => {
      const { ops } = parsePipeline('box 10 10 10 | faces left');
      if (ops[0].type === 'FacesSelect') {
        expect(ops[0].args[0]).toMatchObject({ type: 'SelectorLit', value: '<X' });
      }
    });

    it('parses front alias as selector', () => {
      const { ops } = parsePipeline('box 10 10 10 | faces front');
      if (ops[0].type === 'FacesSelect') {
        expect(ops[0].args[0]).toMatchObject({ type: 'SelectorLit', value: '<Y' });
      }
    });

    it('parses back alias as selector', () => {
      const { ops } = parsePipeline('box 10 10 10 | faces back');
      if (ops[0].type === 'FacesSelect') {
        expect(ops[0].args[0]).toMatchObject({ type: 'SelectorLit', value: '>Y' });
      }
    });

    it('parses name alias in edges', () => {
      const { ops } = parsePipeline('box 10 10 10 | edges top');
      if (ops[0].type === 'EdgesSelect') {
        expect(ops[0].args[0]).toMatchObject({ type: 'SelectorLit', value: '>Z' });
      }
    });

    it('parses name alias in verts', () => {
      const { ops } = parsePipeline('box 10 10 10 | verts top');
      if (ops[0].type === 'VertsSelect') {
        expect(ops[0].args[0]).toMatchObject({ type: 'SelectorLit', value: '>Z' });
      }
    });

    it('parses selector followed by as tag', () => {
      const { ops } = parsePipeline('box 10 10 10 | faces <X as $left_face');
      if (ops[0].type === 'FacesSelect') {
        expect(ops[0].args[0]).toMatchObject({ type: 'SelectorLit', value: '<X' });
        expect(ops[0].tag).toBe('left_face');
      }
    });

    it('parses name alias followed by as tag', () => {
      const { ops } = parsePipeline('box 10 10 10 | edges top as $top_edges');
      if (ops[0].type === 'EdgesSelect') {
        expect(ops[0].args[0]).toMatchObject({ type: 'SelectorLit', value: '>Z' });
        expect(ops[0].tag).toBe('top_edges');
      }
    });

    // Compound selectors
    it('parses space-separated selectors as multiple args', () => {
      const stmt = parseFirst('box 10 10 10 | edges >Z >X | chamfer 1');
      expect(stmt.type).toBe('Pipeline');
      if (stmt.type === 'Pipeline') {
        const edges = stmt.ops[0];
        expect(edges.type).toBe('EdgesSelect');
        if (edges.type === 'EdgesSelect') {
          expect(edges.args.length).toBeGreaterThanOrEqual(2);
        }
      }
    });

    it('parses list-separated selectors', () => {
      const stmt = parseFirst('box 10 10 10 | faces [>Z, <Z] | shell 2');
      expect(stmt.type).toBe('Pipeline');
      if (stmt.type === 'Pipeline') {
        const faces = stmt.ops[0];
        expect(faces.type).toBe('FacesSelect');
        if (faces.type === 'FacesSelect') {
          expect(faces.args[0].type).toBe('ListLit');
        }
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Validator
  // ---------------------------------------------------------------------------

  describe('validator', () => {
    it('accepts valid 3D -> fillet pipeline', () => {
      const errors = getErrors('box 80 60 10 | fillet 2');
      expect(errors).toHaveLength(0);
    });

    it('accepts valid 3D -> faces -> workplane -> 2D -> cut', () => {
      const errors = getErrors('box 10 10 10 | faces >Z | workplane | circle 5 | cut 3');
      expect(errors).toHaveLength(0);
    });

    it('accepts workplane with origin kwarg', () => {
      const errors = getErrors('box 10 10 10 | faces >Z | workplane origin: 0 0 0 | circle 5 | cut 3');
      expect(errors).toHaveLength(0);
    });

    it('accepts valid 3D -> faces -> shell', () => {
      const errors = getErrors('box 10 10 10 | faces >Z | shell 2');
      expect(errors).toHaveLength(0);
    });

    it('accepts 3D -> edges -> fillet', () => {
      const errors = getErrors('box 10 10 10 | edges >Z | fillet 2');
      expect(errors).toHaveLength(0);
    });

    it('accepts 3D -> faces -> points -> hole', () => {
      const errors = getErrors('box 10 10 10 | faces >Z | points [(5, 0), (0, 5), (-5, 0), (0, -5)] | hole 3');
      expect(errors).toHaveLength(0);
    });

    it('rejects shell on edge selection', () => {
      const errors = getErrors('box 10 10 10 | edges >Z | shell 2');
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].message).toContain('not valid in EdgeSelection');
    });

    it('rejects translate on FaceSelection', () => {
      const errors = getErrors('box 10 10 10 | faces >Z | translate 0 0 5');
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].message).toContain('not valid in FaceSelection');
    });

    it('rejects extrude on EdgeSelection', () => {
      const errors = getErrors('box 10 10 10 | edges >Z | extrude 5');
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].message).toContain('not valid in EdgeSelection');
    });

    it('accepts chamfer on EdgeSelection', () => {
      const errors = getErrors('box 10 10 10 | edges >Z | chamfer 2');
      expect(errors).toHaveLength(0);
    });

    it('rejects shell on VertexSelection', () => {
      const errors = getErrors('box 10 10 10 | verts >Z | shell 2');
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].message).toContain('not valid in VertexSelection');
    });

    it('accepts implicit 2D in VertexSelection', () => {
      const errors = getErrors('box 10 10 10 | verts >Z | circle 1');
      expect(errors).toHaveLength(0);
    });

    it('accepts as tag in FaceSelection', () => {
      const errors = getErrors('box 10 10 10 | faces >Z | as $top');
      expect(errors).toHaveLength(0);
    });

    it('accepts as tag in EdgeSelection', () => {
      const errors = getErrors('box 10 10 10 | edges >Z | as $topEdges');
      expect(errors).toHaveLength(0);
    });

    it('accepts as tag in 3D context', () => {
      const errors = getErrors('box 10 10 10 | as $myBox');
      expect(errors).toHaveLength(0);
    });

    it('accepts fillet in FaceSelection', () => {
      const errors = getErrors('box 10 10 10 | faces >Z | fillet 2');
      expect(errors).toHaveLength(0);
    });

    it('accepts chamfer in FaceSelection', () => {
      const errors = getErrors('box 10 10 10 | faces >Z | chamfer 2');
      expect(errors).toHaveLength(0);
    });

    it('accepts translate in VertexSelection', () => {
      const errors = getErrors('rect 80 60 | verts | translate 10 10 10 | cone 6 2 0');
      expect(errors).toHaveLength(0);
    });

    it('accepts translate in PointSelection', () => {
      const errors = getErrors('box 10 10 10 | faces >Z | points | translate 5 5 0 | circle 2');
      expect(errors).toHaveLength(0);
    });

    it('preserves VertexSelection context after translate', () => {
      const errors = getErrors('rect 80 60 | verts | translate 10 10 10 | box 1 1 1');
      expect(errors).toHaveLength(0);
    });

    it('accepts verts after 2D shape (rect)', () => {
      const errors = getErrors('rect 70 50 | verts | circle 1');
      expect(errors).toHaveLength(0);
    });

    it('accepts verts after circle', () => {
      const errors = getErrors('circle 10 | verts | circle 1');
      expect(errors).toHaveLength(0);
    });

    it('accepts verts with selector in 3D context', () => {
      const errors = getErrors('box 10 10 10 | verts >Z');
      expect(errors).toHaveLength(0);
    });

    it('accepts sphere after verts in 2D context', () => {
      const errors = getErrors('rect 100 100 | verts | sphere 5');
      expect(errors).toHaveLength(0);
    });

    it('accepts box after verts in 2D context', () => {
      const errors = getErrors('circle 50 | verts | box 5 5 5');
      expect(errors).toHaveLength(0);
    });

    it('accepts cylinder after verts in 2D context', () => {
      const errors = getErrors('rect 100 100 | verts | cylinder 3 10');
      expect(errors).toHaveLength(0);
    });

    it('transitions to 3D context after 3D primitive in verts', () => {
      const errors = getErrors('rect 100 100 | verts | sphere 5 | color red');
      expect(errors).toHaveLength(0);
    });

    // Workplane context
    it('rejects extrude in workplane context', () => {
      const errors = getErrors('box 10 10 10 | faces >Z | workplane | extrude 5');
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].message).toContain('not valid in Workplane');
    });

    it('accepts rect in workplane context', () => {
      const errors = getErrors('box 10 10 10 | faces >Z | workplane | rect 10 10');
      expect(errors).toHaveLength(0);
    });

    it('accepts circle in workplane context', () => {
      const errors = getErrors('box 10 10 10 | faces >Z | workplane | circle 5');
      expect(errors).toHaveLength(0);
    });

    it('accepts points in workplane context', () => {
      const errors = getErrors('box 10 10 10 | faces >Z | workplane | points [(5, 0), (0, 5), (-5, 0), (0, -5)]');
      expect(errors).toHaveLength(0);
    });

    // PointSelection context
    it('accepts hole in PointSelection', () => {
      const errors = getErrors('box 10 10 10 | faces >Z | points [(5, 0), (0, 5), (-5, 0), (0, -5)] | hole 3');
      expect(errors).toHaveLength(0);
    });

    it('rejects fillet in PointSelection', () => {
      const errors = getErrors('box 10 10 10 | faces >Z | points [(5, 0), (0, 5), (-5, 0), (0, -5)] | fillet 2');
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].message).toContain('not valid in PointSelection');
    });

    it('accepts implicit 2D in PointSelection', () => {
      const errors = getErrors('box 10 10 10 | faces >Z | points [(5, 0), (0, 5), (-5, 0), (0, -5)] | circle 3');
      expect(errors).toHaveLength(0);
    });

    // Compound selectors
    it('accepts space-separated selectors (AND) on edges', () => {
      const errors = getErrors('box 10 10 10 | edges >Z >X | fillet 1');
      expect(errors).toHaveLength(0);
    });

    it('accepts list-separated selectors (OR) on faces', () => {
      const errors = getErrors('box 10 10 10 | faces [>Z, <Z] | shell 2');
      expect(errors).toHaveLength(0);
    });

    // FuncCall/VarRef source
    it('skips validation for VarRef source', () => {
      const errors = getErrors('$myShape | fillet 2');
      expect(errors).toHaveLength(0);
    });

    it('skips validation for FuncCall source', () => {
      const errors = getErrors('make_box(10) | fillet 2');
      expect(errors).toHaveLength(0);
    });

    // Pipeline result context
    it('correctly tracks context through pipeline', () => {
      const errors = getErrors('box 10 10 10 | faces >Z | workplane | circle 5 | cut | fillet 2');
      expect(errors).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Evaluator — selector literals
  // ---------------------------------------------------------------------------

  describe('evaluator', () => {
    it('evaluates >Z selector to ">Z" string', () => {
      expect(evaluateExpressions(parse('$x = >Z'))).toBe('>Z');
    });

    it('evaluates <X selector to "<X" string', () => {
      expect(evaluateExpressions(parse('$x = <X'))).toBe('<X');
    });

    it('evaluates =Z selector to its source form (the kernel spelling is applied at the boundary)', () => {
      expect(evaluateExpressions(parse('$x = =Z'))).toBe('=Z');
    });

    it('evaluates +Z selector to its source form', () => {
      expect(evaluateExpressions(parse('$x = +Z'))).toBe('+Z');
    });

    it('a name alias is a variable outside a selection argument', () => {
      expect(evaluateExpressions(parse('top = 20\n$x = top + 1'))).toBe(21);
      expect(() => evaluateExpressions(parse('$x = top'))).toThrow(/Undefined variable: top/);
    });

    it('a selector value is its source form for every symbol', () => {
      expect(evaluateExpressions(parse('$x = >X'))).toBe('>X');
      expect(evaluateExpressions(parse('$x = <Y'))).toBe('<Y');
      expect(evaluateExpressions(parse('$x = =Z'))).toBe('=Z');
      expect(evaluateExpressions(parse('$x = +X'))).toBe('+X');
      expect(evaluateExpressions(parse('$x = =Y'))).toBe('=Y');
      expect(evaluateExpressions(parse('$x = +Y'))).toBe('+Y');
    });

    it('maps all selector name aliases as selection arguments', () => {
      const expected: Record<string, string> = {
        top: '>Z', bottom: '<Z', right: '>X', left: '<X', front: '<Y', back: '>Y',
      };
      for (const [alias, sym] of Object.entries(expected)) {
        for (const op of ['faces', 'edges', 'verts']) {
          const { ops } = parsePipeline(`box 10 10 10 | ${op} ${alias}`);
          expect((ops[0] as { args: unknown[] }).args[0], `${op} ${alias}`).toMatchObject({ type: 'SelectorLit', value: sym });
        }
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Selector engine
  // ---------------------------------------------------------------------------

  describe('selector engine', () => {
    it('selects Z-parallel edges with |Z selector', () => {
      const edges = [{ id: 'e1' }, { id: 'e2' }, { id: 'e3' }, { id: 'e4' }];
      const centerFn = () => ({ x: 0, y: 0, z: 0 });
      const dirFn = (item: any) => {
        switch (item.id) {
          case 'e1': return { x: 0, y: 0, z: 1 };
          case 'e2': return { x: 1, y: 0, z: 0 };
          case 'e3': return { x: 0, y: 1, z: 0 };
          case 'e4': return { x: 0, y: 0, z: -1 };
          default: return null;
        }
      };
      const result = selectItems(null as any, edges, '=Z', centerFn, dirFn);
      expect(result.map((e: any) => e.id)).toEqual(['e1', 'e4']);
    });

    it('selects X-parallel edges with |X selector', () => {
      const edges = [{ id: 'e1' }, { id: 'e2' }, { id: 'e3' }, { id: 'e4' }];
      const centerFn = () => ({ x: 0, y: 0, z: 0 });
      const dirFn = (item: any) => {
        switch (item.id) {
          case 'e1': return { x: 0, y: 0, z: 1 };
          case 'e2': return { x: 1, y: 0, z: 0 };
          case 'e3': return { x: 0, y: 1, z: 0 };
          case 'e4': return { x: 0, y: 0, z: -1 };
          default: return null;
        }
      };
      const result = selectItems(null as any, edges, '=X', centerFn, dirFn);
      expect(result.map((e: any) => e.id)).toEqual(['e2']);
    });

    it('selects max-Z faces with >Z selector', () => {
      const faces = [{ id: 'f1' }, { id: 'f2' }, { id: 'f3' }];
      const centerFn = (item: any) => {
        switch (item.id) {
          case 'f1': return { x: 50, y: 30, z: 0 };
          case 'f2': return { x: 50, y: 30, z: 40 };
          case 'f3': return { x: 50, y: 30, z: 20 };
          default: return { x: 0, y: 0, z: 0 };
        }
      };
      const result = selectItems(null as any, faces, '>Z', centerFn);
      expect(result.map((f: any) => f.id)).toEqual(['f2']);
    });

    it('selects max-X faces with >X selector (right)', () => {
      const faces = [{ id: 'f1' }, { id: 'f2' }, { id: 'f3' }];
      const centerFn = (item: any) => {
        switch (item.id) {
          case 'f1': return { x: 0, y: 30, z: 20 };
          case 'f2': return { x: 50, y: 30, z: 20 };
          case 'f3': return { x: 100, y: 30, z: 20 };
          default: return { x: 0, y: 0, z: 0 };
        }
      };
      const result = selectItems(null as any, faces, '>X', centerFn);
      expect(result.map((f: any) => f.id)).toEqual(['f3']);
    });

    // `=` is parallel in the geometric sense, so it reads the other way round
    // for faces (which are known by their normal) than for edges: a face is
    // parallel to an axis when its normal is perpendicular to it, and
    // parallel to a plane when its normal is parallel to the plane's normal.
    const faceDir = (item: any) => {
      switch (item.id) {
        case 'top': return { x: 0, y: 0, z: 1 };
        case 'bottom': return { x: 0, y: 0, z: -1 };
        case 'right': return { x: 1, y: 0, z: 0 };
        case 'left': return { x: -1, y: 0, z: 0 };
        case 'side': return { x: 1, y: 0, z: 0 };
        default: return null;
      }
    };
    const origin = () => ({ x: 0, y: 0, z: 0 });
    const ids = (r: any[]) => r.map((f: any) => f.id);

    it('=Z on faces keeps the faces that contain the Z direction (the sides)', () => {
      const faces = [{ id: 'top' }, { id: 'side' }, { id: 'bottom' }];
      expect(ids(selectItems(null as any, faces, '=Z', origin, faceDir, 'face'))).toEqual(['side']);
    });

    it('=XY on faces keeps the faces parallel to the XY plane (top and bottom)', () => {
      const faces = [{ id: 'top' }, { id: 'side' }, { id: 'bottom' }];
      expect(ids(selectItems(null as any, faces, '=XY', origin, faceDir, 'face'))).toEqual(['top', 'bottom']);
    });

    it('=X on faces keeps the faces that contain the X direction', () => {
      const faces = [{ id: 'top' }, { id: 'right' }, { id: 'left' }];
      expect(ids(selectItems(null as any, faces, '=X', origin, faceDir, 'face'))).toEqual(['top']);
    });

    it('+Z / -Z on faces select by the normal', () => {
      const faces = [{ id: 'top' }, { id: 'side' }, { id: 'bottom' }];
      expect(ids(selectItems(null as any, faces, '+Z', origin, faceDir, 'face'))).toEqual(['top']);
      expect(ids(selectItems(null as any, faces, '-Z', origin, faceDir, 'face'))).toEqual(['bottom']);
    });

    it('+Z on edges is an error: an edge has no front', () => {
      const edges = [{ id: 'e' }];
      expect(() => selectItems(null as any, edges, '+Z', origin, () => ({ x: 0, y: 0, z: 1 }), 'edge'))
        .toThrow(/an edge has no front/);
    });
  });
});
