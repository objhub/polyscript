export { preprocess } from './preprocessor.js';
export { bundleImports, BundleError } from './bundle.js';
export type { BundleResult } from './bundle.js';
export type { PreprocessResult } from  './preprocessor.js';
export { Lexer, TokenType } from './lexer.js';
export type { Token } from './lexer.js';
export { Parser, ParseError, parse } from './parser.js';
export { validate } from './validator.js';
export type { Context, ValidationError } from './validator.js';
export { Evaluator, Environment, EvalError, evaluate, evaluateExpressions, resultShape, resultColorParts } from './evaluator.js';
export type { Value, UserFunc, EvaluatorOptions } from './evaluator.js';
export { Trace, selectionText } from './trace.js';
export type { TraceStep, TraceOptions, TraceSelection } from './trace.js';
export {
  DIAGNOSTIC_CODES, asDiagnosticCode, makeDiagnostic, formatDiagnostic, pushDiagnostic, pushWarning,
  drainDiagnostics, codedError, explain,
} from './diagnostics.js';
export type { Diagnostic, DiagnosticCode, Severity, CodedError } from './diagnostics.js';
export { fingerprint, FINGERPRINT_PRECISION } from './fingerprint.js';
export { runChecks } from './checks.js';
export type { ShapeFacts } from './fingerprint.js';
export { extractParams, PARAM_OPTIONS, unknownParamOptions } from './params.js';
export type { ParamInfo, ParamSet } from './params.js';
export { ProfileError, parseProfileBlock, extractProfile, stripProfileBlock } from './profile.js';
export type { ProfileEntry, Profile } from './profile.js';
export type {
  SourceLocation,
  Node, Expression, PipeOp, Statement, NamedArg,
  Program, Assignment, FuncDef, Import, Pipeline, ParamAnnotation,
  NumberLit, StringLit, BoolConst, VarRef, TagRef,
  TupleLit, ListLit, ListComp, SelectorLit,
  BinOp, UnaryNeg, IfExpr, FuncCall,
  BoxExpr, CylinderExpr, SphereExpr,
  RectExpr, CircleExpr, EllipseExpr, PolygonExpr, TextExpr,
  LinePathExpr, ArcPathExpr, BezierPathExpr, HelixPathExpr,
  GridPipe, PolarPipe,
  FacesSelect, EdgesSelect, VertsSelect, PointsSelect,
  Fillet, Chamfer, Shell, AsTag,
  Diff, Union, Inter,
  Hole, Cut, Extrude, Revolve, Sweep,
  Translate, Rotate, Move, MoveTo,
  ColorOp,
  Workplane, Implicit2DPrimitive,
} from './ast.js';
export { KEYWORDS, SOURCE_COMMANDS, PIPE_OP_KEYWORDS, SELECTOR_ALIASES } from './ast.js';
export type { MeshData, MeshPart } from './mesh.js';
