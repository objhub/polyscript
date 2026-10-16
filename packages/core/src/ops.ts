/**
 * What every operation takes -- the one table behind `poly ops` and the
 * validator's `arg.unknown-option`.
 *
 * Hand-written next to the evaluators it describes (devel/ai-friendly202609.md
 * D-1): the evaluators read named arguments ad hoc (`kwargs.get('draft')`),
 * so a misspelt key used to be ignored without a word. The validator now
 * refuses any key that is not listed here, which means a new named argument
 * is added in two places: the evaluator that reads it, and this table. The
 * corpus sweep (tests/examples, regressions, ex2, ex3, functionalprint)
 * catches a key that exists in code but not here.
 *
 * Contexts are not repeated here: `CONTEXT_OPS` (validator) and
 * `nextContext` (context) stay the source of truth, and `describeOps()` joins
 * the three.
 */

import type { Expression, PipeOp } from './ast.js';
import { hasNamedArgs } from './ast.js';

export interface ArgSpec {
  name: string;
  /** number | string | selector | point | points | shape | shapes | plane | axis | list */
  type: string;
  optional?: boolean;
  desc: string;
}

export interface NamedArgSpec {
  key: string;
  type: string;
  desc: string;
}

export interface OpSpec {
  keyword: string;
  /** `source` starts a pipeline, `pipe` follows a `|`, `both` can do either. */
  kind: 'source' | 'pipe' | 'both';
  /** AST node types this spec governs (named-argument check). */
  nodeTypes: string[];
  desc: string;
  args: ArgSpec[];
  named: NamedArgSpec[];
  example: string;
}

// Named arguments shared by whole families ------------------------------------

const AT: NamedArgSpec = { key: 'at', type: 'point | points', desc: 'place the shape at a point, or one copy per point' };
const ANGLE: NamedArgSpec = { key: 'angle', type: 'number | (rx, ry, rz)', desc: 'rotate about Z (one angle) or Euler angles, in degrees' };
const ANGLE2D: NamedArgSpec = { key: 'angle', type: 'number', desc: 'rotate in the plane, in degrees' };
const CENTER3: NamedArgSpec = { key: 'center', type: 'bool | (bx, by, bz)', desc: 'centre on the origin per axis (default true)' };
const CENTER2: NamedArgSpec = { key: 'center', type: 'bool | (bx, by)', desc: 'centre on the origin per axis (default true)' };
const ORIGIN2D: NamedArgSpec = { key: 'origin', type: '"world" | "local" | point', desc: 'what `at:` is measured from on a workplane' };
const DIR: NamedArgSpec = { key: 'dir', type: '(x, y, z)', desc: 'axis direction (default +Z)' };
const PNT: NamedArgSpec = { key: 'pnt', type: '(x, y, z)', desc: 'base point of the axis' };
const PRIM3D = [CENTER3, AT, ANGLE];
const PRIM2D = [CENTER2, AT, ANGLE2D, ORIGIN2D];
const TRANSFORM_ORIGIN: NamedArgSpec = { key: 'origin', type: '"world" | "local" | point', desc: 'the point the operation is about (default world origin)' };

export const OP_SPECS: OpSpec[] = [
  // --- 3D primitives --------------------------------------------------------
  { keyword: 'box', kind: 'both', nodeTypes: ['BoxExpr'], desc: 'rectangular solid',
    args: [{ name: 'w', type: 'number', desc: 'size along X' }, { name: 'h', type: 'number', desc: 'size along Y' }, { name: 'd', type: 'number', desc: 'size along Z' }],
    named: PRIM3D, example: 'box 80 60 10' },
  { keyword: 'cylinder', kind: 'both', nodeTypes: ['CylinderExpr'], desc: 'cylinder along Z',
    args: [{ name: 'r', type: 'number', desc: 'radius' }, { name: 'h', type: 'number', desc: 'height' }],
    named: [...PRIM3D, DIR, PNT], example: 'cylinder 5 10' },
  { keyword: 'sphere', kind: 'both', nodeTypes: ['SphereExpr'], desc: 'sphere',
    args: [{ name: 'r', type: 'number', desc: 'radius' }], named: PRIM3D, example: 'sphere 10' },
  { keyword: 'cone', kind: 'both', nodeTypes: ['ConeExpr'], desc: 'cone or frustum along Z',
    args: [{ name: 'r1', type: 'number', desc: 'bottom radius' }, { name: 'r2', type: 'number', desc: 'top radius (0 for a point)' }, { name: 'h', type: 'number', desc: 'height' }],
    named: [...PRIM3D, DIR, PNT], example: 'cone 10 0 20' },
  { keyword: 'torus', kind: 'both', nodeTypes: ['TorusExpr'], desc: 'torus about Z',
    args: [{ name: 'r1', type: 'number', desc: 'ring radius' }, { name: 'r2', type: 'number', desc: 'tube radius' }],
    named: PRIM3D, example: 'torus 20 5' },
  { keyword: 'wedge', kind: 'both', nodeTypes: ['WedgeExpr'], desc: 'wedge (box tapered along X at the top)',
    args: [{ name: 'dx', type: 'number', desc: 'size along X' }, { name: 'dy', type: 'number', desc: 'size along Y' }, { name: 'dz', type: 'number', desc: 'size along Z' }, { name: 'ltx', type: 'number', optional: true, desc: 'X size at the top (default 0)' }],
    named: PRIM3D, example: 'wedge 10 5 8 3' },
  { keyword: 'thread', kind: 'both', nodeTypes: ['ThreadExpr'], desc: 'external thread (helical groove on a cylinder)',
    args: [{ name: 'r', type: 'number', desc: 'major radius' }, { name: 'pitch', type: 'number', desc: 'pitch' }, { name: 'h', type: 'number', desc: 'height' }],
    named: [...PRIM3D,
      { key: 'land', type: 'number', desc: 'crest flat (default pitch / 8)' },
      { key: 'depth', type: 'number', desc: 'thread depth (default 60-degree flanks to a sharp root)' },
      { key: 'chamfer', type: 'number | bool | (bottom, top)', desc: '45-degree chamfer of the ends; true = down to the root' }],
    example: 'thread 8 1.25 20 chamfer:true' },

  // --- 2D primitives --------------------------------------------------------
  { keyword: 'rect', kind: 'both', nodeTypes: ['RectExpr'], desc: 'rectangle (Face)',
    args: [{ name: 'w', type: 'number', desc: 'width' }, { name: 'h', type: 'number', desc: 'height' }], named: PRIM2D, example: 'rect 50 30' },
  { keyword: 'circle', kind: 'both', nodeTypes: ['CircleExpr'], desc: 'circle (Face)',
    args: [{ name: 'r', type: 'number', desc: 'radius' }], named: PRIM2D, example: 'circle 10' },
  { keyword: 'ellipse', kind: 'both', nodeTypes: ['EllipseExpr'], desc: 'ellipse (Face)',
    args: [{ name: 'rx', type: 'number', desc: 'X radius' }, { name: 'ry', type: 'number', desc: 'Y radius' }], named: PRIM2D, example: 'ellipse 10 5' },
  { keyword: 'polyline', kind: 'both', nodeTypes: ['PolylineExpr'], desc: 'polygon from a point list (Face, closed)',
    args: [{ name: 'points', type: 'points', desc: 'list of (x, y)' }], named: PRIM2D, example: 'polyline [(0,0), (10,0), (5,10)]' },
  { keyword: 'polygon', kind: 'both', nodeTypes: ['PolygonExpr'], desc: 'regular polygon (Face)',
    args: [{ name: 'n', type: 'number', desc: 'number of sides' }, { name: 'r', type: 'number', desc: 'circumradius' }], named: PRIM2D, example: 'polygon 6 8' },
  { keyword: 'text', kind: 'both', nodeTypes: ['TextExpr'], desc: 'text outline (Face)',
    args: [{ name: 'string', type: 'string', desc: 'the text' }, { name: 'size', type: 'number', optional: true, desc: 'font size (default 10)' }],
    named: [{ key: 'size', type: 'number', desc: 'font size' }, ...PRIM2D], example: 'text "ABC" 10' },
  { keyword: 'sketch', kind: 'both', nodeTypes: ['SketchExpr'], desc: 'closed outline from segments: points, arc, bezier, spline (Face)',
    args: [{ name: 'segments', type: 'list', desc: 'start point, then points and arc / bezier / spline segments' }],
    named: [], example: 'sketch [(5,0), arc (5,0) (0,-5) (-5,0), (0,7), (5,0)]' },
  { keyword: 'wire', kind: 'both', nodeTypes: ['WireLiteralExpr'], desc: 'open or closed curve from segments (Wire)',
    args: [{ name: 'segments', type: 'list', desc: 'points and arc / bezier / spline segments; 2D or 3D' }],
    named: [], example: 'wire [(0,0), (10,0), arc (10,0) (15,5) radius:5]' },

  // --- paths ----------------------------------------------------------------
  { keyword: 'line', kind: 'source', nodeTypes: ['LinePathExpr'], desc: 'straight segment (Wire)',
    args: [{ name: 'start', type: 'point', desc: '(x, y) or (x, y, z)' }, { name: 'end', type: 'point', desc: '(x, y) or (x, y, z)' }],
    named: [], example: 'line (0,0,0) (0,0,30)' },
  { keyword: 'arc', kind: 'source', nodeTypes: ['ArcPathExpr', 'CenterArcPathExpr'], desc: 'circular arc (Wire); three points, or two points with radius: or center:',
    args: [{ name: 'start', type: 'point', desc: 'start point' }, { name: 'through', type: 'point', optional: true, desc: 'a point on the arc (three-point form)' }, { name: 'end', type: 'point', desc: 'end point' }],
    named: [{ key: 'radius', type: 'number', desc: 'radius; the minor arc is taken' }, { key: 'center', type: 'point', desc: 'centre of the circle' }],
    example: 'arc (0,0) (10,0) radius:7' },
  { keyword: 'bezier', kind: 'source', nodeTypes: ['BezierPathExpr'], desc: 'Bezier curve (Wire)',
    args: [{ name: 'points', type: 'points', desc: 'control points, the first is the start' }], named: [], example: 'bezier [(0,0), (5,10), (10,0)]' },
  { keyword: 'spline', kind: 'source', nodeTypes: ['SplinePathExpr'], desc: 'B-spline through points (Wire)',
    args: [{ name: 'points', type: 'points', desc: 'points to pass through, the first is the start' }], named: [], example: 'spline [(0,0), (5,10), (10,0)]' },
  { keyword: 'helix', kind: 'source', nodeTypes: ['HelixPathExpr'], desc: 'helix about Z (Wire)',
    args: [{ name: 'pitch', type: 'number', desc: 'rise per turn' }, { name: 'height', type: 'number', desc: 'total height' }, { name: 'radius', type: 'number', desc: 'radius' }],
    named: [{ key: 'pitch', type: 'number', desc: 'rise per turn' }, { key: 'height', type: 'number', desc: 'total height' }, { key: 'radius', type: 'number', desc: 'radius' }],
    example: 'helix 5 30 10' },

  // --- arrays and placement -------------------------------------------------
  { keyword: 'grid', kind: 'both', nodeTypes: ['GridPipe'], desc: 'grid of copies (3D) or of points (after faces / points)',
    args: [{ name: 'nx', type: 'number', desc: 'count along X' }, { name: 'ny', type: 'number', desc: 'count along Y' }, { name: 'pitch', type: 'number', optional: true, desc: 'centre-to-centre distance (default 10)' }],
    named: [{ key: 'pitch', type: 'number', desc: 'centre-to-centre distance' }], example: 'grid 4 3 20' },
  { keyword: 'polar', kind: 'both', nodeTypes: ['PolarPipe'], desc: 'circular array of copies (3D) or of points (after faces / points)',
    args: [{ name: 'count', type: 'number', desc: 'number of copies' }, { name: 'radius', type: 'number', desc: 'radius of the circle' }],
    named: [{ key: 'count', type: 'number', desc: 'number of copies' }, { key: 'radius', type: 'number', desc: 'radius' }, { key: 'orient', type: 'bool', desc: 'rotate each copy to face outward' }],
    example: 'polar 6 15' },
  { keyword: 'place', kind: 'pipe', nodeTypes: ['Place'], desc: 'draw an existing 2D shape on the current workplane',
    args: [{ name: 'shape', type: 'shape', desc: 'a Face or Wire value' }], named: [], example: 'faces >Z | place $profile' },
  { keyword: 'workplane', kind: 'both', nodeTypes: ['Workplane'], desc: 'start drawing on a named plane, or on the selected face',
    args: [{ name: 'plane', type: 'plane', optional: true, desc: 'XY XZ YZ or -XY -XZ -YZ (omit after faces)' }],
    named: [{ key: 'origin', type: 'point', desc: 'origin of the drawing frame' }], example: 'workplane XZ | circle 10 | extrude 10' },

  // --- booleans -------------------------------------------------------------
  { keyword: 'union', kind: 'both', nodeTypes: ['Union'], desc: 'boolean union',
    args: [{ name: 'tool', type: 'shape | shapes', desc: 'a shape, a command, or [shapes]' }], named: [], example: 'union sphere 5' },
  { keyword: 'diff', kind: 'both', nodeTypes: ['Diff'], desc: 'boolean difference',
    args: [{ name: 'tool', type: 'shape | shapes', desc: 'a shape, a command, or [shapes]' }], named: [], example: 'diff cylinder 5 10' },
  { keyword: 'inter', kind: 'both', nodeTypes: ['Inter'], desc: 'boolean intersection',
    args: [{ name: 'tool', type: 'shape | shapes', desc: 'a shape, a command, or [shapes]' }], named: [], example: 'inter sphere 30' },

  // --- selection ------------------------------------------------------------
  { keyword: 'faces', kind: 'pipe', nodeTypes: ['FacesSelect'], desc: 'select faces',
    args: [{ name: 'selector', type: 'selector', optional: true, desc: '>Z <X =Y +Z, a name alias, or [a, b] for OR; several for AND' }], named: [], example: 'faces >Z' },
  { keyword: 'edges', kind: 'pipe', nodeTypes: ['EdgesSelect'], desc: 'select edges',
    args: [{ name: 'selector', type: 'selector', optional: true, desc: 'as faces' }], named: [], example: 'edges =Z' },
  { keyword: 'verts', kind: 'pipe', nodeTypes: ['VertsSelect'], desc: 'select vertices (2D or 3D)', args: [], named: [], example: 'verts' },
  { keyword: 'points', kind: 'pipe', nodeTypes: ['PointsSelect'], desc: 'select points on the current plane',
    args: [{ name: 'points', type: 'points', desc: '[(x, y), ...] or (grid ...) / (polar ...)' }], named: [], example: 'points [(20,10), (-20,10)]' },
  { keyword: 'as', kind: 'pipe', nodeTypes: ['AsTag'], desc: 'name the current selection or shape',
    args: [{ name: '$tag', type: 'tag', desc: 'the name' }], named: [], example: 'faces <X as $left' },

  // --- modifiers ------------------------------------------------------------
  { keyword: 'fillet', kind: 'pipe', nodeTypes: ['Fillet'], desc: 'round the selected edges (3D) or the corners (2D)',
    args: [{ name: 'r', type: 'number', desc: 'radius' }], named: [], example: 'fillet 2' },
  { keyword: 'chamfer', kind: 'pipe', nodeTypes: ['Chamfer'], desc: 'chamfer the selected edges',
    args: [{ name: 'd', type: 'number', desc: 'distance' }], named: [], example: 'chamfer 1' },
  { keyword: 'shell', kind: 'pipe', nodeTypes: ['Shell'], desc: 'hollow the solid, opening the selected faces',
    args: [{ name: 't', type: 'number', desc: 'wall thickness' }], named: [], example: 'faces >Z | shell 2' },
  { keyword: 'offset', kind: 'pipe', nodeTypes: ['Offset'], desc: 'grow or shrink a Face; give a Wire a width (becomes a Face)',
    args: [{ name: 'd', type: 'number', desc: 'distance (negative shrinks)' }],
    named: [{ key: 'join', type: '"round" | "miter" | "tangent"', desc: 'corner style' }, { key: 'cap', type: '"round" | "square"', desc: 'end style of a thickened wire' }],
    example: 'offset 2 cap:"square"' },
  { keyword: 'color', kind: 'pipe', nodeTypes: ['Color'], desc: 'colour the part (glTF / STEP)',
    args: [{ name: 'color', type: 'string | r g b', desc: 'a name, "#RRGGBB", or three numbers 0..1' }],
    named: [{ key: 'alpha', type: 'number', desc: 'opacity 0..1' }], example: 'color "red"' },

  // --- cut / hole / 2D to 3D ---------------------------------------------------
  { keyword: 'hole', kind: 'pipe', nodeTypes: ['Hole'], desc: 'drill at the face centre or at the selected points',
    args: [{ name: 'r', type: 'number', desc: 'radius' }],
    named: [{ key: 'depth', type: 'number', desc: 'depth (default through)' }, AT, ORIGIN2D], example: 'hole 3' },
  { keyword: 'cut', kind: 'pipe', nodeTypes: ['Cut'], desc: 'cut the drawn 2D shape into the solid',
    args: [{ name: 'depth', type: 'number', optional: true, desc: 'depth (default through)' }], named: [], example: 'cut 3' },
  { keyword: 'extrude', kind: 'pipe', nodeTypes: ['Extrude'], desc: 'extrude a Face along the plane normal',
    args: [{ name: 'h', type: 'number', desc: 'height' }],
    named: [{ key: 'draft', type: 'number', desc: 'draft angle in degrees (positive widens)' }], example: 'extrude 10' },
  { keyword: 'revolve', kind: 'pipe', nodeTypes: ['Revolve'], desc: 'revolve a Face about an axis',
    args: [{ name: 'axis', type: 'axis', desc: 'X Y or Z' }, { name: 'angle', type: 'number', optional: true, desc: 'degrees (default 360)' }],
    named: [], example: 'revolve Y 180' },
  { keyword: 'sweep', kind: 'pipe', nodeTypes: ['Sweep'], desc: 'sweep a profile along the Wire held upstream',
    args: [{ name: 'profile', type: 'shape', desc: 'the cross-section (a command or a 2D value)' }], named: [], example: 'helix 5 30 10 | sweep (circle 2)' },
  { keyword: 'loft', kind: 'pipe', nodeTypes: ['Loft'], desc: 'loft through sections',
    args: [{ name: 'sections', type: 'shapes', desc: '[2D shapes] stacked above the current one' }, { name: 'heights', type: 'number | list', optional: true, desc: 'spacing, one value or a list' }],
    named: [{ key: 'ruled', type: 'bool', desc: 'straight between sections' }], example: 'loft [rect 8 8] 10' },

  // --- transforms -------------------------------------------------------------
  { keyword: 'translate', kind: 'pipe', nodeTypes: ['Translate'], desc: 'move',
    args: [{ name: 'dx', type: 'number', desc: '' }, { name: 'dy', type: 'number', desc: '' }, { name: 'dz', type: 'number', optional: true, desc: '' }],
    named: [], example: 'translate 0 0 5' },
  { keyword: 'rotate', kind: 'pipe', nodeTypes: ['Rotate'], desc: 'rotate: three angles on a solid, one angle on a 2D shape',
    args: [{ name: 'rx', type: 'number', desc: 'about X (or the one in-plane angle)' }, { name: 'ry', type: 'number', optional: true, desc: 'about Y' }, { name: 'rz', type: 'number', optional: true, desc: 'about Z' }],
    named: [TRANSFORM_ORIGIN], example: 'rotate 0 0 45' },
  { keyword: 'scale', kind: 'pipe', nodeTypes: ['Scale'], desc: 'scale uniformly or per axis',
    args: [{ name: 'f', type: 'number', desc: 'factor (or sx)' }, { name: 'sy', type: 'number', optional: true, desc: '' }, { name: 'sz', type: 'number', optional: true, desc: '' }],
    named: [], example: 'scale 2 1 0.5' },
  { keyword: 'move', kind: 'pipe', nodeTypes: ['Move'], desc: 'move the 2D cursor relatively',
    args: [{ name: 'dx', type: 'number', desc: '' }, { name: 'dy', type: 'number', desc: '' }], named: [TRANSFORM_ORIGIN], example: 'move 20 0' },
  { keyword: 'moveto', kind: 'pipe', nodeTypes: ['MoveTo'], desc: 'move the 2D cursor to a position',
    args: [{ name: 'x', type: 'number', desc: '' }, { name: 'y', type: 'number', desc: '' }], named: [TRANSFORM_ORIGIN], example: 'moveto 30 20' },
  { keyword: 'mirror', kind: 'pipe', nodeTypes: ['Mirror'], desc: 'mirror across a plane',
    args: [{ name: 'axis', type: 'string', desc: '"X" "Y" "Z" (the axis normal to the mirror plane)' }],
    named: [{ key: 'keep', type: 'bool', desc: 'keep the original too (union)' }, TRANSFORM_ORIGIN], example: 'mirror "X"' },
  { keyword: 'floor', kind: 'pipe', nodeTypes: ['Floor'], desc: 'shift so the bottom sits on z = 0', args: [], named: [], example: 'box 10 10 10 | floor' },
];

/** AST node type -> the keys its evaluator reads. Built once. */
const NAMED_BY_TYPE: Map<string, { keyword: string; keys: string[] }> = new Map();
for (const spec of OP_SPECS) {
  for (const t of spec.nodeTypes) {
    NAMED_BY_TYPE.set(t, { keyword: spec.keyword, keys: spec.named.map((n) => n.key) });
  }
}

export interface UnknownNamedArg {
  keyword: string;
  key: string;
  allowed: string[];
  /** The listed key the writer most likely meant, if one is close. */
  nearest?: string;
  loc?: { line: number; column: number };
}

/**
 * The named arguments on `node` that no evaluator reads. A user function call
 * is not checked: its keys are the function's parameters.
 */
export function unknownNamedArgs(node: Expression | PipeOp): UnknownNamedArg[] {
  if (!hasNamedArgs(node) || node.type === 'FuncCall') return [];
  const spec = NAMED_BY_TYPE.get(node.type);
  if (!spec) return [];
  const out: UnknownNamedArg[] = [];
  for (const na of node.namedArgs) {
    if (spec.keys.includes(na.key)) continue;
    const nearest = spec.keys.find((k) => editDistance(k, na.key) <= 2);
    out.push({ keyword: spec.keyword, key: na.key, allowed: spec.keys, nearest, loc: na.loc });
  }
  return out;
}

function editDistance(a: string, b: string): number {
  const dp: number[] = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
}

export function opSpec(keyword: string): OpSpec | undefined {
  return OP_SPECS.find((s) => s.keyword === keyword);
}
