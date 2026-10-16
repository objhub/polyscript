/**
 * PolyScript AST node definitions.
 * Aligned with Python implementation's ast_nodes.py.
 */

// --- Source location ---

export interface SourceLocation {
  line: number;
  column: number;
}

// --- Named argument ---

export interface NamedArg {
  key: string;
  value: Expression;
  loc?: SourceLocation;
}

// --- Top-level ---

export interface Program { type: 'Program'; statements: Statement[]; loc?: SourceLocation; }
export interface ParamAnnotation { type: 'ParamAnnotation'; options: Record<string, any>; loc?: SourceLocation; }
export interface Assignment { type: 'Assignment'; name: string; value: Expression; annotation?: ParamAnnotation; loc?: SourceLocation; }
export interface FuncDef { type: 'FuncDef'; name: string; params: string[]; body: Expression; loc?: SourceLocation; }
export interface Import { type: 'Import'; path: string; loc?: SourceLocation; }
/** `assert <condition> [tol:<n>[%]]`. `text` is the condition as written, for
 *  the failure message and the trace row. `tol` only affects `~` inside the
 *  condition; `relative` is the `%` form. */
export interface Assert {
  type: 'Assert';
  condition: Expression;
  text: string;
  tol?: { value: number; relative: boolean };
  loc?: SourceLocation;
}
/** `print <value> ...`: the values, formatted and joined by a space, reach the
 *  report as an `info` diagnostic. Geometry is untouched. */
export interface Print { type: 'Print'; args: Expression[]; loc?: SourceLocation; }

// --- Pipeline ---

export interface Pipeline { type: 'Pipeline'; source: Expression; ops: PipeOp[]; loc?: SourceLocation; }

// --- Literals & References ---

export interface NumberLit { type: 'NumberLit'; value: number; loc?: SourceLocation; }
export interface StringLit { type: 'StringLit'; value: string; loc?: SourceLocation; }
export interface BoolConst { type: 'BoolConst'; value: boolean; loc?: SourceLocation; }
export interface VarRef { type: 'VarRef'; name: string; loc?: SourceLocation; }
export interface TagRef { type: 'TagRef'; name: string; loc?: SourceLocation; }
export interface TupleLit { type: 'TupleLit'; elements: Expression[]; loc?: SourceLocation; }
export interface ListLit { type: 'ListLit'; elements: Expression[]; loc?: SourceLocation; }
export interface ListComp { type: 'ListComp'; expr: Expression; variable: string; iterable: Expression; loc?: SourceLocation; }
export interface SelectorLit { type: 'SelectorLit'; value: string; loc?: SourceLocation; }
export interface IndexAccess { type: 'IndexAccess'; object: Expression; index: Expression; loc?: SourceLocation; }
/** `$g.volume`, `$g.bbox.x`: a measured property of a shape (or of a bbox). */
export interface PropAccess { type: 'PropAccess'; object: Expression; name: string; loc?: SourceLocation; }

// --- Expressions ---

export interface BinOp { type: 'BinOp'; op: string; left: Expression; right: Expression; loc?: SourceLocation; }
export interface UnaryNeg { type: 'UnaryNeg'; operand: Expression; loc?: SourceLocation; }
export interface IfExpr { type: 'IfExpr'; condition: Expression; thenExpr: Expression; elseExpr: Expression; loc?: SourceLocation; }
export interface FuncCall { type: 'FuncCall'; name: string; args: Expression[]; namedArgs: NamedArg[]; loc?: SourceLocation; }

// --- 3D Primitives ---

export interface BoxExpr { type: 'BoxExpr'; args: Expression[]; namedArgs: NamedArg[]; loc?: SourceLocation; }
export interface CylinderExpr { type: 'CylinderExpr'; args: Expression[]; namedArgs: NamedArg[]; loc?: SourceLocation; }
export interface SphereExpr { type: 'SphereExpr'; args: Expression[]; namedArgs: NamedArg[]; loc?: SourceLocation; }
export interface ConeExpr { type: 'ConeExpr'; args: Expression[]; namedArgs: NamedArg[]; loc?: SourceLocation; }
export interface TorusExpr { type: 'TorusExpr'; args: Expression[]; namedArgs: NamedArg[]; loc?: SourceLocation; }
export interface WedgeExpr { type: 'WedgeExpr'; args: Expression[]; namedArgs: NamedArg[]; loc?: SourceLocation; }
export interface ThreadExpr { type: 'ThreadExpr'; args: Expression[]; namedArgs: NamedArg[]; loc?: SourceLocation; }

// --- 2D Primitives ---

export interface RectExpr { type: 'RectExpr'; args: Expression[]; namedArgs: NamedArg[]; loc?: SourceLocation; }
export interface CircleExpr { type: 'CircleExpr'; args: Expression[]; namedArgs: NamedArg[]; loc?: SourceLocation; }
export interface EllipseExpr { type: 'EllipseExpr'; args: Expression[]; namedArgs: NamedArg[]; loc?: SourceLocation; }
export interface PolylineExpr { type: 'PolylineExpr'; args: Expression[]; namedArgs: NamedArg[]; loc?: SourceLocation; }
export interface PolygonExpr { type: 'PolygonExpr'; args: Expression[]; namedArgs: NamedArg[]; loc?: SourceLocation; }
export interface TextExpr { type: 'TextExpr'; args: Expression[]; namedArgs: NamedArg[]; loc?: SourceLocation; }
export interface SketchExpr { type: 'SketchExpr'; start: Expression; segments: Expression[]; namedArgs: NamedArg[]; loc?: SourceLocation; }

// --- Path Primitives ---

export interface LinePathExpr { type: 'LinePathExpr'; args: Expression[]; namedArgs: NamedArg[]; loc?: SourceLocation; }
export interface ArcPathExpr { type: 'ArcPathExpr'; args: Expression[]; namedArgs: NamedArg[]; loc?: SourceLocation; }
export interface CenterArcPathExpr { type: 'CenterArcPathExpr'; args: Expression[]; namedArgs: NamedArg[]; loc?: SourceLocation; }
export interface BezierPathExpr { type: 'BezierPathExpr'; args: Expression[]; namedArgs: NamedArg[]; loc?: SourceLocation; }
export interface HelixPathExpr { type: 'HelixPathExpr'; args: Expression[]; namedArgs: NamedArg[]; loc?: SourceLocation; }
export interface SplinePathExpr { type: 'SplinePathExpr'; args: Expression[]; namedArgs: NamedArg[]; loc?: SourceLocation; }

// --- Wire Literal (multi-segment wire, open or closed) ---

export interface WireLiteralExpr { type: 'WireLiteralExpr'; start?: Expression; segments: Expression[]; loc?: SourceLocation; }

// --- Pipe Operations ---

export interface FacesSelect { type: 'FacesSelect'; args: Expression[]; namedArgs: NamedArg[]; tag?: string; loc?: SourceLocation; }
export interface EdgesSelect { type: 'EdgesSelect'; args: Expression[]; namedArgs: NamedArg[]; tag?: string; loc?: SourceLocation; }
export interface VertsSelect { type: 'VertsSelect'; args: Expression[]; namedArgs: NamedArg[]; tag?: string; loc?: SourceLocation; }
export interface PointsSelect { type: 'PointsSelect'; args: Expression[]; namedArgs: NamedArg[]; loc?: SourceLocation; }
export interface Fillet { type: 'Fillet'; args: Expression[]; namedArgs: NamedArg[]; loc?: SourceLocation; }
export interface Chamfer { type: 'Chamfer'; args: Expression[]; namedArgs: NamedArg[]; loc?: SourceLocation; }
export interface Shell { type: 'Shell'; args: Expression[]; namedArgs: NamedArg[]; loc?: SourceLocation; }
export interface Offset { type: 'Offset'; args: Expression[]; namedArgs: NamedArg[]; loc?: SourceLocation; }
export interface AsTag { type: 'AsTag'; name: string; loc?: SourceLocation; }
export interface Diff { type: 'Diff'; args: Expression[]; namedArgs: NamedArg[]; loc?: SourceLocation; }
export interface Union { type: 'Union'; args: Expression[]; namedArgs: NamedArg[]; loc?: SourceLocation; }
export interface Inter { type: 'Inter'; args: Expression[]; namedArgs: NamedArg[]; loc?: SourceLocation; }
export interface Place { type: 'Place'; args: Expression[]; namedArgs: NamedArg[]; loc?: SourceLocation; }
export interface Hole { type: 'Hole'; args: Expression[]; namedArgs: NamedArg[]; loc?: SourceLocation; }
export interface Cut { type: 'Cut'; args: Expression[]; namedArgs: NamedArg[]; loc?: SourceLocation; }
export interface Extrude { type: 'Extrude'; args: Expression[]; namedArgs: NamedArg[]; loc?: SourceLocation; }
export interface Revolve { type: 'Revolve'; args: Expression[]; namedArgs: NamedArg[]; loc?: SourceLocation; }
export interface Sweep { type: 'Sweep'; args: Expression[]; namedArgs: NamedArg[]; loc?: SourceLocation; }
export interface Loft { type: 'Loft'; args: Expression[]; namedArgs: NamedArg[]; loc?: SourceLocation; }
export interface Translate { type: 'Translate'; args: Expression[]; namedArgs: NamedArg[]; loc?: SourceLocation; }
export interface Rotate { type: 'Rotate'; args: Expression[]; namedArgs: NamedArg[]; loc?: SourceLocation; }
export interface Scale { type: 'Scale'; args: Expression[]; namedArgs: NamedArg[]; loc?: SourceLocation; }
export interface Move { type: 'Move'; args: Expression[]; namedArgs: NamedArg[]; loc?: SourceLocation; }
export interface MoveTo { type: 'MoveTo'; args: Expression[]; namedArgs: NamedArg[]; loc?: SourceLocation; }
export interface ColorOp { type: 'Color'; args: Expression[]; namedArgs: NamedArg[]; loc?: SourceLocation; }
export interface Workplane { type: 'Workplane'; args: Expression[]; namedArgs: NamedArg[]; loc?: SourceLocation; }
export interface GridPipe { type: 'GridPipe'; args: Expression[]; namedArgs: NamedArg[]; loc?: SourceLocation; }
export interface PolarPipe { type: 'PolarPipe'; args: Expression[]; namedArgs: NamedArg[]; loc?: SourceLocation; }
export interface Mirror { type: 'Mirror'; args: Expression[]; namedArgs: NamedArg[]; loc?: SourceLocation; }
export interface Floor { type: 'Floor'; args: Expression[]; namedArgs: NamedArg[]; loc?: SourceLocation; }
export interface Implicit2DPrimitive { type: 'Implicit2DPrimitive'; primitive: Expression; loc?: SourceLocation; }
export interface Implicit3DPrimitive { type: 'Implicit3DPrimitive'; primitive: Expression; loc?: SourceLocation; }

// --- Primitive union types ---

/** 3D primitive expression types (all have args + namedArgs) */
export type Primitive3DExpr = BoxExpr | CylinderExpr | SphereExpr | ConeExpr | TorusExpr | WedgeExpr | ThreadExpr;

/** 2D primitive expression types (all have args + namedArgs) */
export type Primitive2DExpr = RectExpr | CircleExpr | EllipseExpr | PolylineExpr | PolygonExpr | TextExpr;

/** Any AST node that carries a namedArgs field */
export type NodeWithNamedArgs =
  | FuncCall
  | Primitive3DExpr | Primitive2DExpr | SketchExpr
  | LinePathExpr | ArcPathExpr | CenterArcPathExpr | BezierPathExpr | HelixPathExpr | SplinePathExpr
  | FacesSelect | EdgesSelect | VertsSelect | PointsSelect
  | Fillet | Chamfer | Shell | Offset
  | Diff | Union | Inter | Place
  | Hole | Cut | Extrude | Sweep | Loft
  | Translate | Rotate | Scale | Move | MoveTo
  | ColorOp | Workplane | GridPipe | PolarPipe | Mirror | Floor;

/** Type guard: returns true (and narrows the type) if the node has a namedArgs field. */
export function hasNamedArgs(node: Expression | PipeOp): node is NodeWithNamedArgs {
  return 'namedArgs' in node;
}

// --- Union types ---

export type Expression =
  | NumberLit | StringLit | BoolConst | VarRef | TagRef
  | TupleLit | ListLit | ListComp | SelectorLit | IndexAccess | PropAccess
  | BinOp | UnaryNeg | IfExpr | FuncCall
  | BoxExpr | CylinderExpr | SphereExpr | ConeExpr | TorusExpr | WedgeExpr | ThreadExpr
  | RectExpr | CircleExpr | EllipseExpr | PolylineExpr | PolygonExpr | TextExpr | SketchExpr
  | LinePathExpr | ArcPathExpr | CenterArcPathExpr | BezierPathExpr | HelixPathExpr | SplinePathExpr
  | WireLiteralExpr
  | Diff | Union | Inter
  | GridPipe | PolarPipe
  | Workplane
  | Pipeline;

export type PipeOp =
  | FacesSelect | EdgesSelect | VertsSelect | PointsSelect
  | Fillet | Chamfer | Shell | Offset | AsTag
  | Diff | Union | Inter | Place
  | Hole | Cut | Extrude | Revolve | Sweep | Loft
  | Translate | Rotate | Scale | Move | MoveTo
  | Mirror | Floor
  | ColorOp
  | Workplane | GridPipe | PolarPipe | Implicit2DPrimitive | Implicit3DPrimitive;

export type Statement = Assignment | FuncDef | Import | Assert | Print | Expression;

export type Node = Program | Statement | PipeOp | NamedArg;

// --- Source command keywords ---

export const SOURCE_COMMANDS = new Set([
  'box', 'cylinder', 'sphere', 'cone', 'torus', 'wedge', 'thread',
  'rect', 'circle', 'ellipse', 'polyline', 'polygon', 'text', 'sketch',
  'line', 'arc', 'bezier', 'helix', 'spline',
  'wire',
  'grid', 'polar',
  'union', 'diff', 'inter',
  'workplane',
]);

// --- Pipe operation keywords ---

export const PIPE_OP_KEYWORDS = new Set([
  'faces', 'edges', 'verts', 'points',
  'workplane', 'as',
  'fillet', 'chamfer', 'shell', 'offset',
  'diff', 'union', 'inter', 'place',
  'hole', 'cut', 'extrude', 'revolve', 'sweep', 'loft',
  'translate', 'rotate', 'scale', 'move', 'moveto',
  'mirror',
  'floor',
  'color',
  'rect', 'circle', 'ellipse', 'polyline', 'polygon', 'sketch',
  'box', 'cylinder', 'sphere', 'cone', 'torus', 'wedge', 'thread',
]);

// --- All keywords (cannot be used as identifiers) ---

// --- Selector name aliases ---

export const SELECTOR_ALIASES: Record<string, string> = {
  top: '>Z', bottom: '<Z',
  right: '>X', left: '<X',
  front: '<Y', back: '>Y',
};

// --- All keywords (cannot be used as identifiers) ---

export const KEYWORDS = new Set([
  ...SOURCE_COMMANDS,
  ...PIPE_OP_KEYWORDS,
  'def', 'import', 'assert', 'print',
  'if', 'then', 'else', 'and', 'or',
  'for', 'in', 'range',
  'true', 'false', 'pi',
]);
