/**
 * PolyScript AST evaluator — walks the AST and produces shapes via OCP kernel.
 *
 * Evaluates expressions directly (no codegen step).
 * All shape operations return WpState through the ocp-kernel functions.
 */

import type {
  Program, Statement, Expression, PipeOp, Pipeline,
  Assignment, FuncDef, Import, Assert, Print, NamedArg,
  BinOp, IfExpr, FuncCall, PropAccess,
  BoxExpr, CylinderExpr, SphereExpr, ConeExpr, TorusExpr, WedgeExpr, ThreadExpr,
  RectExpr, CircleExpr, EllipseExpr, PolylineExpr, PolygonExpr, TextExpr,
  LinePathExpr, ArcPathExpr, CenterArcPathExpr, BezierPathExpr, HelixPathExpr, SplinePathExpr, SketchExpr, WireLiteralExpr,
  Union, Diff, Inter,
  GridPipe, PolarPipe,
  Workplane,
  ListComp, IndexAccess,
  Primitive2DExpr, Primitive3DExpr,
  FacesSelect, EdgesSelect, VertsSelect, PointsSelect,
  AsTag, Fillet, Chamfer, Shell, Offset,
  Extrude, Revolve, Sweep, Loft, Cut,
  ColorOp, Translate, Rotate, Scale, Move, MoveTo, Mirror,
  SourceLocation,
} from '../ast.js';
import type { WpState, OC, Pln, Shape } from '../ocp-kernel.js';
import {
  wpWorkplane, wpTag, createWorkplane, makeHelixWire,
  makeLineWire, makeArcWire, makeCenterArcWire, computeCenterArcMidpoint,
  makeBezierWire, makeWireFromPoints, makeFaceFromWire, wpPushPoints,
  computeCenterFromRadius, to3d, makePlane,
} from '../ocp-kernel.js';
import { ensureSolid } from '../ocp-kernel/geometry.js';
import { colorParts } from '../ocp-kernel/color-parts.js';
import type { ColorPart } from '../ocp-kernel/color-parts.js';

// Re-export types and helpers
export {
  type Value,
  type UserFunc,
  Environment,
  EvalError,
  MATH_FUNCS,
  resolveNamedArgs, getNamedNum, getNamedStr,
  asNumber, asString, asWpState, isWpState, isUserFunc, asTupleList,
} from './types.js';

import {
  type Value, type UserFunc,
  Environment, EvalError, MATH_FUNCS,
  asNumber, asString, asWpState, isWpState, isUserFunc, describeValue,
  resolveNamedArgs, getNamedNum,
} from './types.js';

// Sub-module imports
import { evalBox, evalCylinder, evalSphere, evalCone, evalTorus, evalWedge, evalThread, eval3DPrimitive } from './primitives-3d.js';
import { eval2DPrimitive, evalRect, evalCircle, evalEllipse, evalPolyline, evalPolygon, evalText } from './primitives-2d.js';
import { evalFacesSelect, evalEdgesSelect, evalVertsSelect, evalPointsSelect } from './pipe-selection.js';
import { evalFilletOp, evalChamferOp, evalShellOp, evalOffsetOp } from './pipe-modifiers.js';
import { evalDiffOp, evalUnionOp, evalInterOp, applyBoolean, toolStatesOf, isShapeOperand, type BooleanKind } from './pipe-boolean.js';
import { evalTranslateOp, evalRotateOp, evalScaleOp, evalMoveOp, evalMoveToOp, evalMirrorOp, evalFloorOp } from './pipe-transform.js';
import { evalExtrudeOp, evalRevolveOp, evalSweepOp, evalLoftOp, evalCutOp, evalHoleOp, evalFaceHoleOp } from './pipe-extrusion.js';
import { applyAtPlacement, placementToPoints, evalGridPipe, evalPolarPipe, gridPoints, polarPoints } from './placement.js';
import { evalColorOp } from './pipe-color.js';

import { type PipelineContext, nextContext, static2DType, shapeOperatorKind, OP_KEYWORD } from '../context.js';
import { replaneTo } from '../ocp-kernel/faces.js';
import type { CodedError } from '../diagnostics.js';
import { asDiagnosticCode, pushDiagnostic } from '../diagnostics.js';
import { propertyOf, shapesClear, approxEqual, formatValue, DEFAULT_TOL } from './measure.js';

// ---------------------------------------------------------------------------
// Evaluator
// ---------------------------------------------------------------------------

export interface EvaluatorOptions {
  /** Pre-initialized OpenCascade instance */
  oc: OC;
  /** Import resolver — returns source code for a given path */
  importResolver?: (path: string) => string | null;
  /** Parser function — resolves circular dependency with parser module */
  parseFn?: (source: string) => Program;
  /** Override values for top-level variables (used by @param GUI) */
  overrides?: Record<string, any>;
  /** Per-step metrics collector for --trace, or undefined for no recording.
   *  Mirrors the Python evaluator's trace hook; see src/trace.ts. */
  trace?: {
    readonly timing?: boolean;
    record(op: string, context: string, state: unknown, depth?: number, ms?: number, line?: number): void;
  };
}

export class Evaluator {
  private oc: OC;
  private env: Environment;
  private importResolver: ((path: string) => string | null) | undefined;
  private parseFn: ((source: string) => Program) | undefined;
  private importedPaths: Set<string> = new Set();
  private overrides: Record<string, any> | undefined;
  private trace?: EvaluatorOptions['trace'];
  private pipelineDepth = 0;
  /** Tolerance for `~` while an `assert ... tol:` is being evaluated. */
  private assertTol: { value: number; relative: boolean } | undefined;

  /**
   * Expression evaluation dispatch table.
   * Maps Expression.type to a handler function for fast dispatch.
   * Built in the constructor so methods can reference `this`.
   */
  private readonly exprDispatch: Record<string, (e: Expression) => Value>;

  /**
   * Pipe operation dispatch table.
   * Maps PipeOp.type to a handler for context-free operations.
   * Context-dependent ops (Hole, Move, etc.) are handled in evalPipeOp directly.
   */
  private readonly pipeDispatch: Record<string, (state: WpState, op: PipeOp, evalFn: (e: Expression) => Value) => WpState>;

  constructor(options: EvaluatorOptions) {
    this.oc = options.oc;
    this.importResolver = options.importResolver;
    this.parseFn = options.parseFn;
    this.overrides = options.overrides;
    this.trace = options.trace;
    this.env = new Environment();
    this.env.set('pi', Math.PI);
    this.env.set('true', true);
    this.env.set('false', false);

    // Build expression dispatch table
    this.exprDispatch = {
      // Literals
      'NumberLit': (e) => (e as { value: number }).value,
      'StringLit': (e) => (e as { value: string }).value,
      // A selector's value is its source form (`=Z`, `=XY`): the selector
      // engine reads the language's own spelling, there is no kernel spelling
      // to translate to.
      'SelectorLit': (e) => (e as { value: string }).value,
      'BoolConst': (e) => (e as { value: boolean }).value,
      // References
      'VarRef': (e) => this.env.get((e as { name: string }).name),
      'TagRef': (e) => `$${(e as { name: string }).name}`,
      // Compound literals
      'TupleLit': (e) => (e as { elements: Expression[] }).elements.map(el => this.evalExpr(el)),
      'ListLit': (e) => (e as { elements: Expression[] }).elements.map(el => this.evalExpr(el)),
      'ListComp': (e) => this.evalListComp(e as ListComp),
      // Index access
      'IndexAccess': (e) => this.evalIndexAccess(e as IndexAccess),
      'PropAccess': (e) => propertyOf(this.oc, this.evalExpr((e as PropAccess).object), (e as PropAccess).name),
      // Operators
      'BinOp': (e) => this.evalBinOp(e as BinOp),
      'UnaryNeg': (e) => -asNumber(this.evalExpr((e as { operand: Expression }).operand)),
      'IfExpr': (e) => this.evalIfExpr(e as IfExpr),
      // Function call
      'FuncCall': (e) => this.evalFuncCall(e as FuncCall),
      // 3D Primitives
      'BoxExpr': (e) => this.evalBox(e as BoxExpr),
      'CylinderExpr': (e) => this.evalCylinder(e as CylinderExpr),
      'SphereExpr': (e) => this.evalSphere(e as SphereExpr),
      'ConeExpr': (e) => this.evalCone(e as ConeExpr),
      'TorusExpr': (e) => this.evalTorus(e as TorusExpr),
      'WedgeExpr': (e) => this.evalWedge(e as WedgeExpr),
      'ThreadExpr': (e) => this.evalThread(e as ThreadExpr),
      // 2D Primitives
      'RectExpr': (e) => this.evalRect(e as RectExpr),
      'CircleExpr': (e) => this.evalCircle(e as CircleExpr),
      'EllipseExpr': (e) => this.evalEllipse(e as EllipseExpr),
      'PolylineExpr': (e) => this.evalPolyline(e as PolylineExpr),
      'PolygonExpr': (e) => this.evalPolygon(e as PolygonExpr),
      'TextExpr': (e) => this.evalText(e as TextExpr),
      'SketchExpr': (e) => this.evalSketch(e as SketchExpr),
      'WireLiteralExpr': (e) => this.evalWireLiteral(e as WireLiteralExpr),
      // Path Primitives
      'LinePathExpr': (e) => this.evalLinePath(e as LinePathExpr),
      'ArcPathExpr': (e) => this.evalArcPath(e as ArcPathExpr),
      'CenterArcPathExpr': (e) => this.evalCenterArcPath(e as CenterArcPathExpr),
      'BezierPathExpr': (e) => this.evalBezierPath(e as BezierPathExpr),
      'HelixPathExpr': (e) => this.evalHelixPath(e as HelixPathExpr),
      'SplinePathExpr': (e) => this.evalSplinePath(e as SplinePathExpr),
      // Grid / Polar as standalone expressions
      'GridPipe': (e) => {
        const g = e as GridPipe;
        const gArgs = g.args.map(a => asNumber(this.evalExpr(a)));
        const gPts = gridPoints(gArgs, g.namedArgs, a => this.evalExpr(a));
        return gPts.map(([x, y]) => [x, y] as [number, number]);
      },
      'PolarPipe': (e) => {
        const p = e as PolarPipe;
        const pArgs = p.args.map(a => asNumber(this.evalExpr(a)));
        const pPts = polarPoints(pArgs, p.namedArgs, a => this.evalExpr(a));
        return pPts.map(([x, y]) => [x, y] as [number, number]);
      },
      // Boolean source commands
      'Union': (e) => this.evalUnionSource(e as Union),
      'Diff': (e) => this.evalDiffSource(e as Diff),
      'Inter': (e) => this.evalInterSource(e as Inter),
      // Workplane source
      'Workplane': (e) => this.evalWorkplaneSource(e as Workplane),
      // Pipeline
      'Pipeline': (e) => this.evalPipeline(e as Pipeline),
    };

    // Build pipe operation dispatch table (context-free ops only)
    this.pipeDispatch = {
      // Selection
      'FacesSelect': (s, op, fn) => evalFacesSelect(s, op as FacesSelect, fn),
      'EdgesSelect': (s, op, fn) => evalEdgesSelect(s, op as EdgesSelect, fn),
      'VertsSelect': (s, op, fn) => evalVertsSelect(s, op as VertsSelect, fn),
      'PointsSelect': (s, op, fn) => evalPointsSelect(s, op as PointsSelect, fn, v => placementToPoints(v).map(([x, y]) => [x, y] as [number, number])),
      // Workplane
      'Workplane': (s, op) => this.evalWorkplaneOp(s, op as Workplane),
      // Tags
      'AsTag': (s, op) => wpTag(s, (op as AsTag).name),
      // Modifiers
      'Fillet': (s, op, fn) => evalFilletOp(s, op as Fillet, fn),
      'Chamfer': (s, op, fn) => evalChamferOp(s, op as Chamfer, fn),
      'Shell': (s, op, fn) => evalShellOp(s, op as Shell, fn),
      'Offset': (s, op, fn) => evalOffsetOp(s, op as Offset, fn),
      // Booleans
      'Diff': (s, op, fn) => evalDiffOp(s, op as Diff, fn),
      'Union': (s, op, fn) => evalUnionOp(s, op as Union, fn),
      'Inter': (s, op, fn) => evalInterOp(s, op as Inter, fn),
      // 2D -> 3D
      'Extrude': (s, op, fn) => evalExtrudeOp(s, op as Extrude, fn),
      'Revolve': (s, op, fn) => evalRevolveOp(s, op as Revolve, fn),
      'Sweep': (s, op, fn) => evalSweepOp(s, op as Sweep, fn),
      'Loft': (s, op, fn) => evalLoftOp(s, op as Loft, fn),
      // Cut
      'Cut': (s, op, fn) => evalCutOp(s, op as Cut, fn),
      // Color
      'Color': (s, op, fn) => evalColorOp(s, op as ColorOp, fn),
      // Transform
      'Translate': (s, op, fn) => evalTranslateOp(s, op as Translate, fn),
      'Rotate': (s, op, fn) => evalRotateOp(s, op as Rotate, fn),
      'Scale': (s, op, fn) => evalScaleOp(s, op as Scale, fn),
      'Mirror': (s, op, fn) => evalMirrorOp(s, op as Mirror, fn),
      'Floor': (s) => evalFloorOp(s),
    };
  }

  /**
   * Evaluate a complete program.
   * If multiple top-level expression statements produce shapes (WpState),
   * they are collected and returned as an array so the caller can union them.
   * Assignments and function definitions are excluded from shape collection.
   */
  evaluate(program: Program): Value {
    const shapes: WpState[] = [];
    let lastValue: Value = null;

    for (const stmt of program.statements) {
      lastValue = this.evalStatement(stmt);
      // Only collect shapes from expression statements (bare shapes),
      // not from assignments or function definitions
      if (stmt.type !== 'Assignment' && stmt.type !== 'FuncDef' && stmt.type !== 'Import'
          && stmt.type !== 'Assert' && stmt.type !== 'Print'
          && isWpState(lastValue)) {
        shapes.push(lastValue as WpState);
      }
    }

    // Multiple top-level shapes → return array for implicit union
    if (shapes.length > 1) return shapes;
    if (shapes.length === 1) return shapes[0];
    // No top-level shapes: return lastValue only if it's not a shape
    // (prevents assignments like `a = box 1 1 1` from rendering)
    if (isWpState(lastValue)) return null;
    if (Array.isArray(lastValue) && lastValue.some(v => isWpState(v))) return null;
    return lastValue;
  }

  /** Get the final shape from a program result. */
  getShape(value: Value): Shape | null {
    return resultShape(this.oc, value);
  }

  /** Parse source code — uses injected parseFn or dynamic import. */
  private parseSource(source: string): Program {
    if (this.parseFn) return this.parseFn(source);
    throw new EvalError('Import requires a parse function (pass parseFn to EvaluatorOptions)');
  }

  // -----------------------------------------------------------------------
  // Statements
  // -----------------------------------------------------------------------

  private evalStatement(stmt: Statement): Value {
    switch (stmt.type) {
      case 'FuncDef':
        return this.evalFuncDef(stmt);
      case 'Assignment':
        return this.evalAssignment(stmt);
      case 'Import':
        return this.evalImport(stmt);
      case 'Assert':
        return this.evalAssert(stmt);
      case 'Print':
        return this.evalPrint(stmt);
      default:
        return this.evalExpr(stmt);
    }
  }

  /**
   * `assert <condition> [tol:...]`. A failure is recorded as an error
   * diagnostic and evaluation goes on, so one run reports every assertion
   * and still produces the shape and the trace (the CLI fails the build
   * afterwards). A condition that is not a boolean is a mistake in the
   * assertion itself and throws.
   */
  private evalAssert(node: Assert): Value {
    const prevTol = this.assertTol;
    this.assertTol = node.tol;
    let ok: boolean;
    let detail = '';
    try {
      const cond = node.condition;
      const cmp = cond.type === 'BinOp' ? this.comparison(cond.op) : undefined;
      if (cond.type === 'BinOp' && cmp) {
        // Evaluate the two sides here so the message can quote them.
        const left = this.evalExpr(cond.left);
        const right = this.evalExpr(cond.right);
        ok = cmp(left, right, cond.loc);
        if (!ok) {
          detail = `left: ${formatValue(this.oc, left)}, right: ${formatValue(this.oc, right)}`;
          if (cond.op === '~') {
            const t = node.tol ?? DEFAULT_TOL;
            detail += `, tol: ${t.value}${t.relative ? '%' : ''}`;
          }
        }
      } else {
        const v = this.evalExpr(cond);
        if (typeof v !== 'boolean') {
          throw new EvalError(`assert expects a condition, got ${describeValue(v)}`, node.loc, {
            hint: 'compare the value to something: assert $g.solids == 1',
          });
        }
        ok = v;
      }
    } finally {
      this.assertTol = prevTol;
    }
    if (!ok) {
      pushDiagnostic({
        code: 'assert.failed',
        severity: 'error',
        message: `assert ${node.text} failed${detail ? ` (${detail})` : ''}`,
        hint: 'the geometry contradicts the intent written here: fix the pipeline, or the assertion',
        line: node.loc?.line,
        column: node.loc?.column,
      });
    }
    this.trace?.record(`assert ${node.text}`, ok ? 'pass' : 'FAIL', null, this.pipelineDepth, undefined, node.loc?.line);
    return ok;
  }

  /** `print a b c`: one info diagnostic with the values space-joined. */
  private evalPrint(node: Print): Value {
    const text = node.args.map((a) => formatValue(this.oc, this.evalExpr(a))).join(' ');
    pushDiagnostic({
      code: 'print',
      severity: 'info',
      message: text,
      line: node.loc?.line,
      column: node.loc?.column,
    });
    return null;
  }

  /** The comparison a BinOp spells, as a function, or undefined for any other
   *  operator. Shared by evalBinOp and evalAssert. */
  private comparison(op: string): ((l: Value, r: Value, loc?: SourceLocation) => boolean) | undefined {
    switch (op) {
      case '==': return (l, r) => l === r;
      case '!=': return (l, r) => l !== r;
      case '~': return (l, r, loc) => {
        if (typeof l !== 'number' || typeof r !== 'number') {
          throw new EvalError(`Type error: ~ compares numbers, got ${describeValue(l)} and ${describeValue(r)}`, loc);
        }
        return approxEqual(l, r, this.assertTol ?? DEFAULT_TOL);
      };
      case '<': case '>': case '<=': case '>=':
        return (l, r, loc) => {
          if ((typeof l === 'number' && typeof r === 'number') || (typeof l === 'string' && typeof r === 'string')) {
            switch (op) {
              case '<': return l < r;
              case '>': return l > r;
              case '<=': return l <= r;
              default: return l >= r;
            }
          }
          throw new EvalError(`Type error: cannot compare ${describeValue(l)} with ${describeValue(r)} using ${op}`, loc);
        };
      default: return undefined;
    }
  }

  private evalFuncDef(node: FuncDef): Value {
    const func: UserFunc = {
      __kind: 'func',
      name: node.name,
      params: node.params,
      body: node.body,
      closure: this.env,
    };
    this.env.set(node.name, func);
    return null;
  }

  private evalAssignment(node: Assignment): Value {
    // If overrides has a value for this top-level variable, use it
    if (this.overrides && node.name in this.overrides) {
      const value = this.overrides[node.name];
      this.env.set(node.name, value);
      return value;
    }
    const value = this.evalExpr(node.value);
    this.env.set(node.name, value);
    return value;
  }

  private evalImport(node: Import): Value {
    if (this.importedPaths.has(node.path)) return null;
    this.importedPaths.add(node.path);

    if (!this.importResolver) {
      throw new EvalError(`Cannot resolve import "${node.path}": no import resolver configured`);
    }

    const source = this.importResolver(node.path);
    if (source === null) {
      throw new EvalError(`Cannot find import "${node.path}"`);
    }

    // Dynamic import to avoid circular dependency at module level
    // Uses the parse function passed through a late-binding pattern
    const imported = this.parseSource(source);

    // Only import FuncDefs and Assignments
    for (const stmt of imported.statements) {
      if (stmt.type === 'FuncDef' || stmt.type === 'Assignment') {
        this.evalStatement(stmt);
      }
    }

    return null;
  }

  // -----------------------------------------------------------------------
  // Expression evaluation
  // -----------------------------------------------------------------------

  evalExpr(expr: Expression): Value {
    try {
      const handler = this.exprDispatch[expr.type];
      if (handler) return handler(expr);
      throw new EvalError(`Unknown expression type: ${(expr as {type: string}).type}`);
    } catch (e) {
      if (e instanceof EvalError && !e.loc && 'loc' in expr && expr.loc) {
        // Keep the code and the fix: `attr.unknown` thrown without a
        // position would otherwise reach the CLI as a bare eval.error.
        throw new EvalError(e.rawMessage, expr.loc, { code: e.code, hint: e.hint });
      }
      throw e;
    }
  }

  // -----------------------------------------------------------------------
  // Operators
  // -----------------------------------------------------------------------

  private evalBinOp(node: BinOp): Value {
    if (node.op === 'and') {
      const left = this.evalExpr(node.left);
      return left ? this.evalExpr(node.right) : left;
    }
    if (node.op === 'or') {
      const left = this.evalExpr(node.left);
      return left ? left : this.evalExpr(node.right);
    }

    const left = this.evalExpr(node.left);
    const right = this.evalExpr(node.right);

    // Shape operators: `a + b` union, `a - b` diff, `a * b` inter. Same
    // semantics as the pipe ops (a list operand folds, an empty tool is a
    // no-op). The parser's greedy argument rule means these only work between
    // atoms -- variables and parenthesised expressions -- never right after a
    // command's arguments (`box 10 10 10 - x` is `box 10 10 (10 - x)`).
    if (isShapeOperand(left) || isShapeOperand(right)) {
      return this.evalShapeBinOp(node, left, right);
    }

    // String concatenation
    if (node.op === '+' && (typeof left === 'string' || typeof right === 'string')) {
      return String(left) + String(right);
    }

    // Comparisons: same-type, no coercion; ordering is type-checked per SPEC.
    const cmp = this.comparison(node.op);
    if (cmp) return cmp(left, right, node.loc);

    const l = asNumber(left);
    const r = asNumber(right);

    switch (node.op) {
      case '+': return l + r;
      case '-': return l - r;
      case '*': return l * r;
      case '/': return r === 0 ? 0 : l / r;
      case '//': return r === 0 ? 0 : Math.floor(l / r);
      case '%': return r === 0 ? 0 : l % r;
      case '**': return l ** r;
      default:
        throw new EvalError(`Unknown operator: ${node.op}`);
    }
  }

  private evalShapeBinOp(node: BinOp, left: Value, right: Value): Value {
    const kind = shapeOperatorKind(node.op);
    if (!kind) {
      throw new EvalError(
        `'${node.op}' is not defined for shapes. Shapes support '+' (union), '-' (diff) and '*' (inter)`,
        node.loc,
      );
    }
    if (!isWpState(left)) {
      throw new EvalError(
        `Type error: left operand of '${node.op}' must be a shape, got ${describeValue(left)}`,
        node.loc,
      );
    }
    if (!isShapeOperand(right)) {
      throw new EvalError(
        `Type error: right operand of '${node.op}' must be a shape or a list of shapes, got ${describeValue(right)}`,
        node.loc,
      );
    }
    try {
      return applyBoolean(left, toolStatesOf(right, kind), kind);
    } catch (e) {
      if (e instanceof Error && !(e instanceof EvalError)) throw new EvalError(e.message, node.loc);
      throw e;
    }
  }

  private evalIfExpr(node: IfExpr): Value {
    const cond = this.evalExpr(node.condition);
    return cond ? this.evalExpr(node.thenExpr) : this.evalExpr(node.elseExpr);
  }

  private evalListComp(node: ListComp): Value {
    const iterVal = this.evalExpr(node.iterable);
    if (!Array.isArray(iterVal)) {
      throw new EvalError(`List comprehension iterable must be a list`);
    }
    const items = iterVal.map(v => asNumber(v));

    const result: Value[] = [];
    const childEnv = this.env.child();
    const prevEnv = this.env;
    this.env = childEnv;

    for (const item of items) {
      this.env.set(node.variable, item);
      result.push(this.evalExpr(node.expr));
    }

    this.env = prevEnv;
    return result;
  }

  private evalIndexAccess(node: IndexAccess): Value {
    const obj = this.evalExpr(node.object);
    const idx = this.evalExpr(node.index);
    if (!Array.isArray(obj)) throw new EvalError('Index access requires a list');
    if (typeof idx !== 'number') throw new EvalError('Index must be a number');
    const i = Math.trunc(idx);
    if (i < 0 || i >= obj.length) throw new EvalError(`Index ${i} out of range for list of length ${obj.length}`);
    return obj[i];
  }

  // -----------------------------------------------------------------------
  // Function calls
  // -----------------------------------------------------------------------

  private evalFuncCall(node: FuncCall): Value {
    const { name, args: argExprs, namedArgs } = node;

    // clear(a, b): the two solids share no volume (see measure.ts)
    if (name === 'clear') {
      if (argExprs.length !== 2) throw new EvalError(`clear() takes 2 arguments, got ${argExprs.length}`);
      return shapesClear(this.oc, this.evalExpr(argExprs[0]), this.evalExpr(argExprs[1]));
    }

    // Check math builtins
    if (name in MATH_FUNCS) {
      const args = argExprs.map(e => asNumber(this.evalExpr(e)));
      return MATH_FUNCS[name](...args);
    }

    // range() builtin
    if (name === 'range') {
      const args = argExprs.map(e => asNumber(this.evalExpr(e)));
      if (args.length < 1 || args.length > 3) {
        throw new EvalError(`range() takes 1 to 3 arguments, got ${args.length}`);
      }
      const [start, end, step] =
        args.length === 1 ? [0, args[0], 1] : [args[0], args[1], args[2] ?? 1];
      if (step === 0) throw new EvalError('range() step must not be zero');
      const result: number[] = [];
      if (step > 0) for (let i = start; i < end; i += step) result.push(i);
      else for (let i = start; i > end; i += step) result.push(i);
      return result;
    }

    // User-defined functions
    if (this.env.has(name)) {
      const func = this.env.get(name);
      if (isUserFunc(func)) {
        // Separate `at:` from other named args — `at:` is placement, not a function parameter
        const funcNamedArgs = namedArgs.filter(na => na.key !== 'at' && na.key !== 'angle' && na.key !== 'center');
        const atArg = namedArgs.find(na => na.key === 'at');
        const angleArg = namedArgs.find(na => na.key === 'angle');
        let result = this.callUserFunc(func, argExprs, funcNamedArgs);
        if (angleArg && isWpState(result)) {
          const ws = result as WpState;
          if (ws.shape) {
            const angleVal = this.evalExpr(angleArg.value);
            // Rotate 3D shape
            if (typeof angleVal === 'number' && angleVal !== 0) {
              const shape = this.oc.rotate(
                ws.shape,
                { point: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: 0, z: 1 } },
                angleVal * Math.PI / 180,
              );
              result = { ...ws, shape } as WpState;
            }
          }
        }
        if (atArg && isWpState(result)) {
          const atVal = this.evalExpr(atArg.value);
          result = applyAtPlacement(this.oc, result as WpState, atVal);
        }
        return result;
      }
      // Variable holding a WpState — treat as identity
      if (isWpState(func)) return func;
      return func;
    }

    throw new EvalError(`Unknown function: ${name}`);
  }

  private callUserFunc(func: UserFunc, argExprs: Expression[], namedArgs: NamedArg[]): Value {
    const callEnv = func.closure.child();
    const prevEnv = this.env;
    this.env = callEnv;

    // Bind positional args
    for (let i = 0; i < func.params.length; i++) {
      if (i < argExprs.length) {
        // Evaluate in the caller's environment
        this.env = prevEnv;
        const val = this.evalExpr(argExprs[i]);
        this.env = callEnv;
        callEnv.set(func.params[i], val);
      }
    }

    // Bind named args
    for (const na of namedArgs) {
      this.env = prevEnv;
      const val = this.evalExpr(na.value);
      this.env = callEnv;
      callEnv.set(na.key, val);
    }

    const result = this.evalExpr(func.body);
    this.env = prevEnv;
    return result;
  }

  // -----------------------------------------------------------------------
  // 3D Primitives (delegate to submodule)
  // -----------------------------------------------------------------------

  private evalBox(node: BoxExpr): Value {
    return evalBox(this.oc, node, e => this.evalExpr(e));
  }

  private evalCylinder(node: CylinderExpr): Value {
    return evalCylinder(this.oc, node, e => this.evalExpr(e));
  }

  private evalSphere(node: SphereExpr): Value {
    return evalSphere(this.oc, node, e => this.evalExpr(e));
  }

  private evalCone(node: ConeExpr): Value {
    return evalCone(this.oc, node, e => this.evalExpr(e));
  }

  private evalTorus(node: TorusExpr): Value {
    return evalTorus(this.oc, node, e => this.evalExpr(e));
  }

  private evalWedge(node: WedgeExpr): Value {
    return evalWedge(this.oc, node, e => this.evalExpr(e));
  }

  private evalThread(node: ThreadExpr): Value {
    return evalThread(this.oc, node, e => this.evalExpr(e));
  }

  // -----------------------------------------------------------------------
  // 2D Primitives (delegate to submodule)
  // -----------------------------------------------------------------------

  private evalRect(node: RectExpr): Value {
    return evalRect(this.oc, node, e => this.evalExpr(e));
  }

  private evalCircle(node: CircleExpr): Value {
    return evalCircle(this.oc, node, e => this.evalExpr(e));
  }

  private evalEllipse(node: EllipseExpr): Value {
    return evalEllipse(this.oc, node, e => this.evalExpr(e));
  }

  private evalPolyline(node: PolylineExpr): Value {
    return evalPolyline(this.oc, node, e => this.evalExpr(e));
  }

  private evalPolygon(node: PolygonExpr): Value {
    return evalPolygon(this.oc, node, e => this.evalExpr(e));
  }

  private evalText(node: TextExpr): Value {
    return evalText(this.oc, node, e => this.evalExpr(e));
  }

  // -----------------------------------------------------------------------
  // Sketch (compound 2D wire from line/arc/bezier segments)
  // -----------------------------------------------------------------------

  private evalSketch(node: SketchExpr, wpPlane?: Pln): Value {
    // Workplane plane (default XY)
    const plane: Pln = wpPlane ?? makePlane(this.oc, 'XY');
    const normal = plane.normal;

    const startVal = this.evalExpr(node.start);
    const startPt = this.tupleToWorld(startVal, plane, 'sketch start');
    let currentPt = startPt;
    const edges: any[] = [];

    for (const seg of node.segments) {
      if (seg.type === 'ArcPathExpr') {
        // arc start through end — 3 tuple args
        const arcArgs = (seg as ArcPathExpr).args.map(e => this.evalExpr(e));
        if (arcArgs.length < 3) throw new EvalError('arc requires start, through, and end points');
        const start = this.tupleToWorld(arcArgs[0], plane, 'arc start');
        const through = this.tupleToWorld(arcArgs[1], plane, 'arc through');
        const end = this.tupleToWorld(arcArgs[2], plane, 'arc end');
        // Auto-connect: insert implicit line if start doesn't match previous endpoint
        if (vecDist(start, currentPt) > 1e-6) {
          edges.push(this.oc.makeLineEdge(currentPt, start));
        }
        if (vecDist(start, end) < 1e-6) {
          // zero-length arc: nothing to draw
        } else if (collinear(start, through, end)) {
          edges.push(this.oc.makeLineEdge(start, end));
        } else {
          edges.push(this.oc.makeArcEdge(start, through, end));
        }
        currentPt = end;
      } else if (seg.type === 'CenterArcPathExpr') {
        // arc start end center:(cx,cy)  OR  arc start end radius:radius
        const arcSeg = seg as CenterArcPathExpr;
        const arcPosArgs = arcSeg.args.map(e => this.evalExpr(e));
        const rArg = arcSeg.namedArgs.find(a => a.key === 'radius');
        const centerArg = arcSeg.namedArgs.find(a => a.key === 'center');

        let start: { x: number; y: number; z: number };
        let end: { x: number; y: number; z: number };
        let center: { x: number; y: number; z: number };

        if (rArg) {
          // arc start end radius:radius — 2 positional args + radius: named arg
          if (arcPosArgs.length < 2) throw new EvalError('arc with radius: requires start and end points');
          start = this.tupleToWorld(arcPosArgs[0], plane, 'arc start');
          end = this.tupleToWorld(arcPosArgs[1], plane, 'arc end');
          const r = asNumber(this.evalExpr(rArg.value));
          center = computeCenterFromRadius(start, end, r, normal);
        } else if (centerArg) {
          // arc start end center:(cx,cy) — 2 positional args + center: named arg
          if (arcPosArgs.length < 2) throw new EvalError('arc with center: requires start and end points');
          start = this.tupleToWorld(arcPosArgs[0], plane, 'arc start');
          end = this.tupleToWorld(arcPosArgs[1], plane, 'arc end');
          center = this.tupleToWorld(this.evalExpr(centerArg.value), plane, 'arc center');
          // Validate: distance from center to start and end should match (tolerance 5%)
          const rStart = vecDist(center, start);
          const rEnd = vecDist(center, end);
          if (rStart > 1e-10 && Math.abs(rStart - rEnd) / rStart > 0.05) {
            throw new EvalError(
              `arc: center-to-start distance (${rStart.toFixed(4)}) differs from center-to-end distance (${rEnd.toFixed(4)}) by more than 5%`
            );
          }
        } else {
          // Legacy: arc start end center — 3 positional args (center as 3rd positional)
          if (arcPosArgs.length < 3) throw new EvalError('arc requires start, end, and center points (or start, end with center: or radius:)');
          start = this.tupleToWorld(arcPosArgs[0], plane, 'arc start');
          end = this.tupleToWorld(arcPosArgs[1], plane, 'arc end');
          center = this.tupleToWorld(arcPosArgs[2], plane, 'arc center');
          // Validate: distance from center to start and end should match (tolerance 5%)
          const rStart = vecDist(center, start);
          const rEnd = vecDist(center, end);
          if (rStart > 1e-10 && Math.abs(rStart - rEnd) / rStart > 0.05) {
            throw new EvalError(
              `arc: center-to-start distance (${rStart.toFixed(4)}) differs from center-to-end distance (${rEnd.toFixed(4)}) by more than 5%`
            );
          }
        }

        // Auto-connect: insert implicit line if start doesn't match previous endpoint
        if (vecDist(start, currentPt) > 1e-6) {
          edges.push(this.oc.makeLineEdge(currentPt, start));
        }

        const mid = computeCenterArcMidpoint(start, end, center, normal);
        edges.push(this.oc.makeArcEdge(start, mid, end));
        currentPt = end;
      } else if (seg.type === 'BezierPathExpr') {
        // bezier [control_points]
        const bezArgs = (seg as BezierPathExpr).args.map(e => this.evalExpr(e));
        if (bezArgs.length < 1) throw new EvalError('bezier in sketch requires control points');
        const pointsVal = bezArgs[0];
        if (!Array.isArray(pointsVal)) throw new EvalError('bezier in sketch requires a list of control points');
        const controlPts = pointsVal.map((p, i) => this.tupleToWorld(p, plane, `bezier point ${i}`));
        // Prepend current point as first control point
        edges.push(this.oc.makeBezierEdge([currentPt, ...controlPts]));
        currentPt = controlPts[controlPts.length - 1];
      } else if (seg.type === 'SplinePathExpr') {
        // spline [points]
        const splArgs = (seg as SplinePathExpr).args.map(e => this.evalExpr(e));
        if (splArgs.length < 1) throw new EvalError('spline in sketch requires a list of points');
        const pointsVal = splArgs[0];
        if (!Array.isArray(pointsVal) || pointsVal.length === 0) throw new EvalError('spline in sketch requires a list of points');
        const pts = pointsVal.map((p, i) => this.tupleToWorld(p, plane, `spline point ${i}`));
        edges.push(this.oc.interpolatePoints([currentPt, ...pts]));
        currentPt = pts[pts.length - 1];
      } else {
        // Tuple -> line segment to endpoint
        const endVal = this.evalExpr(seg);
        const endPt = this.tupleToWorld(endVal, plane, 'sketch line endpoint');
        // A parametric sketch can land two consecutive points on the same
        // spot for some parameter values (ex2/22_phone_stand at lip_d == t).
        // OCCT cannot make a zero-length edge, so skip it -- same as the
        // Python kernel's GEOMETRY_TOLERANCE check.
        if (vecDist(currentPt, endPt) < 1e-6) continue;
        edges.push(this.oc.makeLineEdge(currentPt, endPt));
        currentPt = endPt;
      }
    }

    // Auto-close: if last point != start point, add closing line edge
    const dist = Math.sqrt(
      (currentPt.x - startPt.x) ** 2 +
      (currentPt.y - startPt.y) ** 2 +
      (currentPt.z - startPt.z) ** 2
    );
    if (dist > 1e-6) {
      edges.push(this.oc.makeLineEdge(currentPt, startPt));
    }

    // A sketch is a Face literal: the closed outline becomes a region.
    const wire = this.oc.makeWire(edges);
    const wp = createWorkplane(this.oc);
    return { ...wp, faces: [makeFaceFromWire(this.oc, wire)] };
  }

  // -----------------------------------------------------------------------
  // Wire Literal (open multi-segment wire, no auto-close; a Wire even when it
  // happens to close -- only `offset` makes a face of it)
  // -----------------------------------------------------------------------

  private evalWireLiteral(node: WireLiteralExpr, wpPlane?: Pln): Value {
    const edges: any[] = [];
    // Workplane plane (default XY)
    const plane: Pln = wpPlane ?? makePlane(this.oc, 'XY');
    const normal = plane.normal;

    let currentPt: { x: number; y: number; z: number } | undefined;

    // If start point is given, set it as the initial currentPt (no edge yet)
    if (node.start) {
      const startVal = this.evalExpr(node.start);
      currentPt = this.tupleToWorld(startVal, plane, 'path start');
    }

    for (const seg of node.segments) {
      if (seg.type === 'LinePathExpr') {
        // line start end — explicit line segment with 2 points
        const lineArgs = (seg as LinePathExpr).args.map(e => this.evalExpr(e));
        if (lineArgs.length < 2) throw new EvalError('line in path requires start and end points');
        const start = this.tupleToWorld(lineArgs[0], plane, 'line start');
        const end = this.tupleToWorld(lineArgs[1], plane, 'line end');
        // Auto-connect: insert implicit line if start doesn't match previous endpoint
        if (currentPt && vecDist(start, currentPt) > 1e-6) {
          edges.push(this.oc.makeLineEdge(currentPt, start));
        }
        edges.push(this.oc.makeLineEdge(start, end));
        currentPt = end;
      } else if (seg.type === 'ArcPathExpr') {
        // arc start through end — 3 tuple args
        const arcArgs = (seg as ArcPathExpr).args.map(e => this.evalExpr(e));
        if (arcArgs.length < 3) throw new EvalError('arc requires start, through, and end points');
        const start = this.tupleToWorld(arcArgs[0], plane, 'arc start');
        const through = this.tupleToWorld(arcArgs[1], plane, 'arc through');
        const end = this.tupleToWorld(arcArgs[2], plane, 'arc end');
        // Auto-connect: insert implicit line if start doesn't match previous endpoint
        if (currentPt && vecDist(start, currentPt) > 1e-6) {
          edges.push(this.oc.makeLineEdge(currentPt, start));
        }
        if (vecDist(start, end) < 1e-6) {
          // zero-length arc: nothing to draw
        } else if (collinear(start, through, end)) {
          edges.push(this.oc.makeLineEdge(start, end));
        } else {
          edges.push(this.oc.makeArcEdge(start, through, end));
        }
        currentPt = end;
      } else if (seg.type === 'CenterArcPathExpr') {
        // arc start end center:(cx,cy)  OR  arc start end radius:radius
        const arcSeg = seg as CenterArcPathExpr;
        const arcPosArgs = arcSeg.args.map(e => this.evalExpr(e));
        const rArg = arcSeg.namedArgs.find(a => a.key === 'radius');
        const centerArg = arcSeg.namedArgs.find(a => a.key === 'center');

        let start: { x: number; y: number; z: number };
        let end: { x: number; y: number; z: number };
        let center: { x: number; y: number; z: number };

        if (rArg) {
          // arc start end radius:radius
          if (arcPosArgs.length < 2) throw new EvalError('arc with radius: requires start and end points');
          start = this.tupleToWorld(arcPosArgs[0], plane, 'arc start');
          end = this.tupleToWorld(arcPosArgs[1], plane, 'arc end');
          const r = asNumber(this.evalExpr(rArg.value));
          center = computeCenterFromRadius(start, end, r, normal);
        } else if (centerArg) {
          // arc start end center:(cx,cy)
          if (arcPosArgs.length < 2) throw new EvalError('arc with center: requires start and end points');
          start = this.tupleToWorld(arcPosArgs[0], plane, 'arc start');
          end = this.tupleToWorld(arcPosArgs[1], plane, 'arc end');
          center = this.tupleToWorld(this.evalExpr(centerArg.value), plane, 'arc center');
          // Validate radius consistency
          const rStart = vecDist(center, start);
          const rEnd = vecDist(center, end);
          if (rStart > 1e-10 && Math.abs(rStart - rEnd) / rStart > 0.05) {
            throw new EvalError(
              `arc: center-to-start distance (${rStart.toFixed(4)}) differs from center-to-end distance (${rEnd.toFixed(4)}) by more than 5%`
            );
          }
        } else {
          // Legacy: arc start end center — 3 positional args
          if (arcPosArgs.length < 3) throw new EvalError('arc requires start, end, and center points (or start, end with center: or radius:)');
          start = this.tupleToWorld(arcPosArgs[0], plane, 'arc start');
          end = this.tupleToWorld(arcPosArgs[1], plane, 'arc end');
          center = this.tupleToWorld(arcPosArgs[2], plane, 'arc center');
          // Validate radius consistency
          const rStart = vecDist(center, start);
          const rEnd = vecDist(center, end);
          if (rStart > 1e-10 && Math.abs(rStart - rEnd) / rStart > 0.05) {
            throw new EvalError(
              `arc: center-to-start distance (${rStart.toFixed(4)}) differs from center-to-end distance (${rEnd.toFixed(4)}) by more than 5%`
            );
          }
        }

        // Auto-connect: insert implicit line if start doesn't match previous endpoint
        if (currentPt && vecDist(start, currentPt) > 1e-6) {
          edges.push(this.oc.makeLineEdge(currentPt, start));
        }

        const mid = computeCenterArcMidpoint(start, end, center, normal);
        edges.push(this.oc.makeArcEdge(start, mid, end));
        currentPt = end;
      } else if (seg.type === 'BezierPathExpr') {
        // bezier [control_points]
        const bezArgs = (seg as BezierPathExpr).args.map(e => this.evalExpr(e));
        if (bezArgs.length < 1) throw new EvalError('bezier in path requires control points');
        const pointsVal = bezArgs[0];
        if (!Array.isArray(pointsVal)) throw new EvalError('bezier in path requires a list of control points');
        const controlPts = pointsVal.map((p, i) => this.tupleToWorld(p, plane, `bezier point ${i}`));
        if (currentPt) {
          // Prepend current point as first control point
          edges.push(this.oc.makeBezierEdge([currentPt, ...controlPts]));
        } else {
          edges.push(this.oc.makeBezierEdge(controlPts));
        }
        currentPt = controlPts[controlPts.length - 1];
      } else if (seg.type === 'SplinePathExpr') {
        // spline [points]
        const splArgs = (seg as SplinePathExpr).args.map(e => this.evalExpr(e));
        if (splArgs.length < 1) throw new EvalError('spline in path requires a list of points');
        const pointsVal = splArgs[0];
        if (!Array.isArray(pointsVal)) throw new EvalError('spline in path requires a list of points');
        const pts = pointsVal.map((p, i) => this.tupleToWorld(p, plane, `spline point ${i}`));
        if (currentPt) {
          // Prepend current point
          const allPts = [currentPt, ...pts];
          edges.push(this.oc.interpolatePoints(allPts));
        } else {
          edges.push(this.oc.interpolatePoints(pts));
        }
        currentPt = pts[pts.length - 1];
      } else {
        // Tuple -> line segment from currentPt to this point
        const endVal = this.evalExpr(seg);
        const endPt = this.tupleToWorld(endVal, plane, 'path line endpoint');
        if (!currentPt) {
          // First element is a bare tuple with no preceding start => treat as start point
          // (This shouldn't happen since parser sets start for leading tuples,
          //  but handle defensively for tuple after first tuple)
          throw new EvalError('path tuple segment requires a preceding start point or segment');
        }
        edges.push(this.oc.makeLineEdge(currentPt, endPt));
        currentPt = endPt;
      }
    }

    if (edges.length === 0) {
      throw new EvalError('path requires at least one segment');
    }

    // No auto-close — wire stays open
    const wire = this.oc.makeWire(edges);
    const wp = createWorkplane(this.oc);
    return { ...wp, wires: [wire] };
  }

  // -----------------------------------------------------------------------
  // Path Primitives (return WpState with wire for sweep)
  // -----------------------------------------------------------------------

  private evalLinePath(node: LinePathExpr): Value {
    // line p1 p2 ... — 2+ points, creates open polyline wire
    const args = node.args.map(e => this.evalExpr(e));
    if (args.length < 2) {
      throw new EvalError('line requires at least 2 points');
    }
    const points = args.map((a, i) => this.toVec3(a, `line point ${i}`));
    const wire = points.length === 2
      ? makeLineWire(this.oc, points[0], points[1])
      : makeWireFromPoints(this.oc, points, false);
    const wp = createWorkplane(this.oc);
    return { ...wp, wires: [wire] };
  }

  private evalArcPath(node: ArcPathExpr): Value {
    // arc start through end — 3 tuple args
    const args = node.args.map(e => this.evalExpr(e));
    if (args.length < 3) {
      throw new EvalError('arc requires start, through, and end points');
    }
    const start = this.toVec3(args[0], 'arc start');
    const through = this.toVec3(args[1], 'arc through');
    const end = this.toVec3(args[2], 'arc end');
    const wire = makeArcWire(this.oc, start, through, end);
    const wp = createWorkplane(this.oc);
    return { ...wp, wires: [wire] };
  }

  private evalCenterArcPath(node: CenterArcPathExpr): Value {
    // arc start end center:(cx,cy)  OR  arc start end radius:radius
    const args = node.args.map(e => this.evalExpr(e));
    const wpNormal = { x: 0, y: 0, z: 1 };
    const rArg = node.namedArgs.find(a => a.key === 'radius');
    const centerArg = node.namedArgs.find(a => a.key === 'center');

    let start: { x: number; y: number; z: number };
    let end: { x: number; y: number; z: number };
    let center: { x: number; y: number; z: number };

    if (rArg) {
      // arc start end radius:radius — 2 positional args + radius: named arg
      if (args.length < 2) throw new EvalError('arc with radius: requires start and end points');
      start = this.toVec3(args[0], 'arc start');
      end = this.toVec3(args[1], 'arc end');
      const r = asNumber(this.evalExpr(rArg.value));
      center = computeCenterFromRadius(start, end, r, wpNormal);
    } else if (centerArg) {
      // arc start end center:(cx,cy) — 2 positional args + center: named arg
      if (args.length < 2) throw new EvalError('arc with center: requires start and end points');
      start = this.toVec3(args[0], 'arc start');
      end = this.toVec3(args[1], 'arc end');
      center = this.toVec3(this.evalExpr(centerArg.value), 'arc center');
      const rStart = vecDist(center, start);
      const rEnd = vecDist(center, end);
      if (rStart > 1e-10 && Math.abs(rStart - rEnd) / rStart > 0.05) {
        throw new EvalError(
          `arc: center-to-start distance (${rStart.toFixed(4)}) differs from center-to-end distance (${rEnd.toFixed(4)}) by more than 5%`
        );
      }
    } else {
      // Legacy: arc start end center — 3 positional args
      if (args.length < 3) throw new EvalError('arc requires start, end, and center points (or start, end with center: or radius:)');
      start = this.toVec3(args[0], 'arc start');
      end = this.toVec3(args[1], 'arc end');
      center = this.toVec3(args[2], 'arc center');
      const rStart = vecDist(center, start);
      const rEnd = vecDist(center, end);
      if (rStart > 1e-10 && Math.abs(rStart - rEnd) / rStart > 0.05) {
        throw new EvalError(
          `arc: center-to-start distance (${rStart.toFixed(4)}) differs from center-to-end distance (${rEnd.toFixed(4)}) by more than 5%`
        );
      }
    }

    const wire = makeCenterArcWire(this.oc, start, end, center, wpNormal);
    const wp = createWorkplane(this.oc);
    return { ...wp, wires: [wire] };
  }

  private evalBezierPath(node: BezierPathExpr): Value {
    // bezier points — arg is a list of (x,y,z) or (x,y) tuples
    const args = node.args.map(e => this.evalExpr(e));
    if (args.length < 1) {
      throw new EvalError('bezier requires a list of control points');
    }
    const pointsVal = args[0];
    if (!Array.isArray(pointsVal)) {
      throw new EvalError('bezier requires a list of control points');
    }
    const controlPoints = pointsVal.map((p, i) => this.toVec3(p, `bezier point ${i}`));
    const wire = makeBezierWire(this.oc, controlPoints);
    const wp = createWorkplane(this.oc);
    return { ...wp, wires: [wire] };
  }

  /** Convert a Value (tuple/array) to a Vec3 point. */
  private toVec3(val: Value, label: string): { x: number; y: number; z: number } {
    if (Array.isArray(val)) {
      const nums = val.map(v => asNumber(v));
      if (nums.length === 2) return { x: nums[0], y: nums[1], z: 0 };
      if (nums.length >= 3) return { x: nums[0], y: nums[1], z: nums[2] };
    }
    throw new EvalError(`Expected (x,y) or (x,y,z) tuple for ${label}`);
  }

  /**
   * Convert a Value (tuple/array) to a Vec3 point using the given plane.
   * 2-element tuples are mapped via origin + x*xDir + y*yDir.
   * 3-element tuples are treated as world coordinates (existing behaviour).
   */
  private tupleToWorld(val: Value, plane: Pln, label: string): { x: number; y: number; z: number } {
    if (Array.isArray(val)) {
      const nums = val.map(v => asNumber(v));
      if (nums.length === 2) return to3d(this.oc, plane, nums[0], nums[1]);
      if (nums.length >= 3) return { x: nums[0], y: nums[1], z: nums[2] };
    }
    throw new EvalError(`Expected (x,y) or (x,y,z) tuple for ${label}`);
  }

  private evalHelixPath(node: HelixPathExpr): Value {
    const args = node.args.map(e => asNumber(this.evalExpr(e)));
    const kwargs = resolveNamedArgs(node.namedArgs, e => this.evalExpr(e));
    const pitch = args[0] ?? getNamedNum(kwargs, 'pitch');
    const height = args[1] ?? getNamedNum(kwargs, 'height');
    const radius = args[2] ?? getNamedNum(kwargs, 'radius');
    const wire = makeHelixWire(this.oc, pitch, height, radius);
    const wp = createWorkplane(this.oc);
    return { ...wp, wires: [wire] };
  }

  private evalSplinePath(node: SplinePathExpr): Value {
    const args = node.args.map(e => this.evalExpr(e));
    if (args.length < 1) {
      throw new EvalError('spline requires a list of points');
    }
    const pointsVal = args[0];
    if (!Array.isArray(pointsVal)) {
      throw new EvalError('spline requires a list of points');
    }
    const pts = pointsVal.map((p, i) => this.toVec3(p, `spline point ${i}`));
    // interpolatePoints yields an edge; every other path primitive stores a
    // wire, and sweep's spine must be one (objects/korocube/KL.poly failed
    // with `pipe: TopoDS::Wire`).
    const wire = this.oc.makeWire([this.oc.interpolatePoints(pts)]);
    const wp = createWorkplane(this.oc);
    return { ...wp, wires: [wire] };
  }

  // -----------------------------------------------------------------------
  // Placement & Group (delegate to submodule)
  // -----------------------------------------------------------------------

  /**
   * Evaluate `union [...]` as source expression.
   * If the single arg is a ListLit, evaluate all elements and fuse shapes.
   * If a single shape arg, return it as-is.
   */
  private evalUnionSource(node: Union): Value {
    return this.evalBooleanSource(node.args, node.namedArgs, 'union');
  }

  /**
   * Evaluate `diff [...]` as source expression.
   * First element is the base; remaining elements are subtracted.
   */
  private evalDiffSource(node: Diff): Value {
    return this.evalBooleanSource(node.args, node.namedArgs, 'diff');
  }

  /**
   * Evaluate `inter [...]` as source expression.
   * All elements are intersected.
   */
  private evalInterSource(node: Inter): Value {
    return this.evalBooleanSource(node.args, node.namedArgs, 'inter');
  }

  /**
   * Common logic for union/diff/inter source commands.
   * If the first arg is a list, expand its elements; otherwise use args directly.
   */
  private evalBooleanSource(
    args: Expression[],
    _namedArgs: NamedArg[],
    kind: BooleanKind,
  ): Value {
    // Collect shapes to combine
    const shapes: Value[] = [];
    for (const arg of args) {
      const val = this.evalExpr(arg);
      // If the arg evaluated to a JS array (from ListLit), expand it
      if (Array.isArray(val)) {
        for (const item of val) {
          shapes.push(item);
        }
      } else {
        shapes.push(val);
      }
    }

    if (shapes.length === 0) return createWorkplane(this.oc);
    if (shapes.length === 1) return shapes[0];

    // The call form is not a pipe op, so the pipeline loop never sees it;
    // record it here or a top-level `union [head, shaft]` -- often the most
    // expensive boolean in a model -- is missing from the trace. The operands
    // were evaluated above, so their own pipelines are already recorded.
    const t0 = this.trace?.timing ? performance.now() : 0;
    // Same fold as the pipe op and the shape operators: `union [a, b, c]` is
    // `a | union [b, c]`, so the three spellings share one type check.
    const result = applyBoolean(asWpState(shapes[0], kind), toolStatesOf(shapes.slice(1), kind), kind);
    if (this.trace) {
      const ms = this.trace.timing ? performance.now() - t0 : undefined;
      this.trace.record(`${kind} [${shapes.length}]`, contextOfState(result), result,
        Math.max(0, this.pipelineDepth - 1), ms);
    }
    return result;
  }

  // -----------------------------------------------------------------------
  // Pipeline evaluation
  // -----------------------------------------------------------------------



  private evalPipeline(node: Pipeline): Value {
    // Nested pipelines re-enter here; the depth counter lets the trace show
    // which pipeline a step belongs to (mirrors the Python evaluator).
    this.pipelineDepth++;
    try {
      let state = this.evalExpr(node.source);
      let ctx = this.sourceContext(node.source);
      // `(a) - (b) | fillet 1`: the operator's result type is only known once
      // the operands are, so read it off the value.
      if (ctx === 'unknown' && node.source.type === 'BinOp' && isWpState(state)) {
        ctx = contextOfState(state);
      }

      for (const op of node.ops) {
        const t0 = this.trace?.timing ? performance.now() : 0;
        try {
          state = this.evalPipeOp(asWpState(state), op, ctx);
        } catch (e) {
          // Kernel errors (`extrude: nothing to extrude ...`) carry no
          // position; the op that raised them does.
          // The code and the fix travel with the message: the kernel names
          // them, only the AST knows where.
          if (e instanceof EvalError && !e.loc && op.loc) {
            throw new EvalError(e.message, op.loc, { code: e.code, hint: e.hint });
          }
          if (e instanceof Error && !(e instanceof EvalError)) {
            const c = e as CodedError;
            // An OCCT failure arrives with a kernel code (CONSTRUCTION_FAILED);
            // keep it in the text, but do not pass it off as a diagnostic code.
            const code = asDiagnosticCode(c.code);
            const message = !code && c.code ? `${e.message} (kernel: ${c.code})` : e.message;
            throw new EvalError(message, op.loc, { code, hint: c.hint });
          }
          throw e;
        }
        ctx = nextContext(ctx, op.type, op);
        if (this.trace) {
          const ms = this.trace.timing ? performance.now() - t0 : undefined;
          this.trace.record(opDisplayName(op), ctx, state, this.pipelineDepth - 1, ms, op.loc?.line);
        }
      }

      return state;
    } finally {
      this.pipelineDepth--;
    }
  }

  /** Determine initial context from the source expression of a pipeline. */
  private sourceContext(expr: Expression): PipelineContext {
    switch (expr.type) {
      case 'BoxExpr':
      case 'CylinderExpr':
      case 'SphereExpr':
      case 'ConeExpr':
      case 'TorusExpr':
      case 'WedgeExpr':
      case 'ThreadExpr':
      case 'Union':
      case 'Diff':
      case 'Inter':
        return '3D';
      case 'Workplane':
        return 'Workplane';
      default:
        return static2DType(expr) ?? 'unknown';
    }
  }

  private evalPipeOp(state: WpState, op: PipeOp, ctx: PipelineContext): WpState {
    const evalFn = (e: Expression) => this.evalExpr(e);

    // Context-free operations: dispatch via table
    const handler = this.pipeDispatch[op.type];
    if (handler) return handler(state, op, evalFn);

    // Context-dependent operations: require ctx for branching
    switch (op.type) {
      case 'Hole':
        if (ctx === 'FaceSelection') {
          return evalFaceHoleOp(state, op, evalFn);
        }
        return evalHoleOp(state, op, evalFn);

      case 'Move':
        return evalMoveOp(ensureWorkplaneForFaceCtx(state, ctx), op as Move, evalFn);
      case 'MoveTo':
        return evalMoveToOp(ensureWorkplaneForFaceCtx(state, ctx), op as MoveTo, evalFn);

      case 'GridPipe': {
        if (ctx === 'FaceSelection' || ctx === 'PointSelection') {
          const g = op as GridPipe;
          const args = g.args.map(e => asNumber(evalFn(e)));
          const pts = gridPoints(args, g.namedArgs, evalFn);
          return wpPushPoints(ensureWorkplaneForFaceCtx(state, ctx), pts);
        }
        return evalGridPipe(this.oc, state, op as GridPipe, evalFn);
      }
      case 'PolarPipe': {
        if (ctx === 'FaceSelection' || ctx === 'PointSelection') {
          const p = op as PolarPipe;
          const args = p.args.map(e => asNumber(evalFn(e)));
          const pts = polarPoints(args, p.namedArgs, evalFn);
          return wpPushPoints(ensureWorkplaneForFaceCtx(state, ctx), pts);
        }
        return evalPolarPipe(this.oc, state, op as PolarPipe, evalFn);
      }

      case 'Place': {
        if (ctx === '3D' || ctx === 'EdgeSelection') {
          throw new EvalError(`'place' requires face selection context`);
        }
        const s = ensureWorkplaneForFaceCtx(state, ctx);
        const arg = asWpState(evalFn(op.args[0]), 'place');
        if (arg.shape) {
          throw new EvalError(
            `place: expected a 2D shape (a face or a wire), got a solid. ` +
            `To add a solid, use 'union (${literalText(op.args[0]) || '...'})'`,
          );
        }
        const placed = replaneTo(arg, s.plane);
        return { ...s, faces: [...s.faces, ...placed.faces], wires: [...s.wires, ...placed.wires] };
      }

      case 'Implicit2DPrimitive': {
        if (ctx === '3D' || ctx === 'EdgeSelection') {
          const primName = this.get2DPrimitiveName(op.primitive);
          throw new EvalError(
            `2D primitive '${primName}' requires face selection. ` +
            `Use '| faces top |' or similar before '| ${primName} ...'`
          );
        }
        const s = ensureWorkplaneForFaceCtx(state, ctx);
        if (op.primitive.type === 'SketchExpr') {
          const sketchResult = this.evalSketch(op.primitive as SketchExpr, s.plane) as WpState;
          return { ...s, faces: sketchResult.faces, wires: [] };
        }
        if (op.primitive.type === 'WireLiteralExpr') {
          const wireResult = this.evalWireLiteral(op.primitive as WireLiteralExpr, s.plane) as WpState;
          return { ...s, faces: [], wires: wireResult.wires };
        }
        return eval2DPrimitive(s, op.primitive as Primitive2DExpr, evalFn);
      }

      case 'Implicit3DPrimitive':
        return eval3DPrimitive(state, op.primitive as Primitive3DExpr, evalFn);

      default:
        throw new EvalError(`Unknown pipe operation: ${(op as {type: string}).type}`);
    }
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  /** Extract human-readable name from a 2D primitive expression. */
  private get2DPrimitiveName(expr: Expression): string {
    const map: Record<string, string> = {
      RectExpr: 'rect',
      CircleExpr: 'circle',
      EllipseExpr: 'ellipse',
      PolylineExpr: 'polyline',
      PolygonExpr: 'polygon',
      TextExpr: 'text',
      SketchExpr: 'sketch',
      WireLiteralExpr: 'wire',
    };
    return map[expr.type] ?? expr.type;
  }

  // -----------------------------------------------------------------------
  // Workplane pipe op
  // -----------------------------------------------------------------------

  /**
   * Evaluate `workplane "XZ"` as a source command (pipe head).
   * Creates an initial WpState on the specified plane (default XY).
   */
  private evalWorkplaneSource(node: Workplane): WpState {
    let planeName = 'XY';
    if (node.args.length > 0) {
      planeName = asString(this.evalExpr(node.args[0]));
    }
    return createWorkplane(this.oc, planeName);
  }

  private evalWorkplaneOp(state: WpState, op: Workplane): WpState {
    const kwargs = resolveNamedArgs(op.namedArgs, e => this.evalExpr(e));
    const originVal = kwargs.get('origin');
    let origin: number[] | undefined;
    if (originVal !== undefined) {
      origin = (Array.isArray(originVal) ? originVal : [originVal]).map(v => asNumber(v));
    }
    // workplane "XZ" — pass plane name if provided as first arg
    if (op.args.length > 0) {
      const planeName = asString(this.evalExpr(op.args[0]));
      return wpWorkplane(state, planeName, origin);
    }
    return wpWorkplane(state, undefined, origin);
  }
}

// ---------------------------------------------------------------------------
// Pipe operation helpers
// ---------------------------------------------------------------------------

/**
 * Ensure workplane is inserted when coming from face selection context.
 * Used by Move, MoveTo, Place, Grid, Polar, and Implicit2D pipe ops
 * that need an implicit workplane when faces are selected.
 */
/** Context label for a state produced outside a pipeline (list combination). */
function contextOfState(state: WpState): PipelineContext {
  if (state.shape) return '3D';
  if (state.wires.length && !state.faces.length) return 'Wire';
  return 'Face';
}

function ensureWorkplaneForFaceCtx(state: WpState, ctx: PipelineContext): WpState {
  if (ctx === 'FaceSelection' && state.selectedFaces.length > 0) {
    return wpWorkplane(state);
  }
  return state;
}

// ---------------------------------------------------------------------------
// Convenience API
// ---------------------------------------------------------------------------

/**
 * Evaluate a PolyScript program AST with the given OpenCascade instance.
 * Returns the last expression's value (typically a WpState with shape).
 */
/**
 * The single shape a program's result stands for.
 *
 * A file with several top-level shapes (`[head, shaft]`, or just several
 * pipelines) means their union -- the same implicit fuse Python applies.
 * Every consumer must go through here: the CLI used to build a compound
 * instead, so `poly info` reported 4 solids and a volume that double-counted
 * overlaps for 00_polyscript_logo while the regression harness (this
 * function) and the browser bundle both fused. Found 2026-09-02.
 */
/** Per-colour parts of an evaluation result, for exporters that carry colour.
 *
 * The companion to resultShape: that fuses everything into one Shape, which is
 * all STL and STEP can hold, while glTF keeps the parts apart so their colours
 * survive. Mirrors what @polyscript/browser assembles for the viewer.
 */
export function resultColorParts(oc: OC, value: Value): ColorPart[] {
  const states: WpState[] = Array.isArray(value)
    ? (value.filter(isWpState) as WpState[])
    : isWpState(value) ? [value as WpState] : [];
  const parts: ColorPart[] = [];
  for (const wp of states) {
    if (wp.shape) parts.push(...colorParts(oc, wp, wp.shape));
  }
  return parts;
}

export function resultShape(oc: OC, value: Value): Shape | null {
  if (isWpState(value)) return (value as WpState).shape;
  if (Array.isArray(value) && value.length > 0 && value.some(v => isWpState(v))) {
    let result: Shape | null = null;
    for (const v of value) {
      if (!isWpState(v)) continue;
      const shape = (v as WpState).shape;
      if (!shape) continue;
      result = result ? ensureSolid(oc, oc.fuse(result, shape)) : shape;
    }
    return result;
  }
  return null;
}

export function evaluate(
  program: Program,
  oc: OC,
  options?: {
    importResolver?: (path: string) => string | null;
    parseFn?: (source: string) => Program;
    trace?: EvaluatorOptions['trace'];
    overrides?: Record<string, any>;
  },
): Value {
  const evaluator = new Evaluator({
    oc,
    importResolver: options?.importResolver,
    parseFn: options?.parseFn,
    overrides: options?.overrides,
    trace: options?.trace,
  });
  return evaluator.evaluate(program);
}

/**
 * Pure expression evaluator — works without OC for testing expressions only.
 * Creates a mock evaluator that can handle arithmetic, variables, etc.
 * Throws if a shape operation is attempted.
 */
export function evaluateExpressions(program: Program, overrides?: Record<string, any>): Value {
  // Create a stub OC that throws on any usage
  const mockOC = new Proxy({}, {
    get: () => {
      throw new EvalError('OpenCascade not available — expression-only evaluation');
    },
  }) as OC;
  const evaluator = new Evaluator({ oc: mockOC, overrides });
  return evaluator.evaluate(program);
}

// ---------------------------------------------------------------------------
// Vector math utilities (used by sketch arc evaluation)
// ---------------------------------------------------------------------------

type V3 = { x: number; y: number; z: number };

function vecDist(a: V3, b: V3): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2);
}

/**
 * Three points that do not define a circle. A parametric profile can put an
 * arc's through-point on the chord for some parameter values
 * (ex2/24_chess_pawn: (r,2) (r-1,3) (r-2,4) lie on one line), and
 * GC_MakeArcOfCircle then fails. Python's kernel falls back to a straight
 * edge under GEOMETRY_TOLERANCE; so do we, via |(b-a) x (c-a)|.
 */
function collinear(a: V3, b: V3, c: V3): boolean {
  const ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z;
  const vx = c.x - a.x, vy = c.y - a.y, vz = c.z - a.z;
  const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
  return Math.sqrt(cx * cx + cy * cy + cz * cz) < 1e-6;
}

// ---------------------------------------------------------------------------
// Trace labels
// ---------------------------------------------------------------------------

/** op.type -> source keyword, for trace-table labels. */
/** Render a literal AST node compactly, or '' when it is not a literal.
 *  Mirrors _literal_text in the Python evaluator. */
function literalText(node: unknown): string {
  if (!node || typeof node !== 'object') return '';
  const n = node as { type?: string; value?: unknown; name?: string };
  switch (n.type) {
    case 'SelectorLit': return String(n.value);
    case 'StringLit': return String(n.value);
    case 'NumberLit': {
      const v = Number(n.value);
      return Number.isInteger(v) ? String(v) : String(v);
    }
    case 'TagRef': return `$${n.name}`;
    case 'VarRef': return String(n.name);
    case 'ListLit': {
      // `edges [>Z, <Z]`: the OR form of a selector, shown as written.
      const items = ((node as { elements?: unknown[] }).elements ?? []).map(literalText);
      return items.every(Boolean) ? `[${items.join(', ')}]` : '';
    }
    default: return '';
  }
}

/** Label a pipe op for the trace table, e.g. `faces >Z` or `fillet 3`.
 *  Mirrors _op_display_name in the Python evaluator. */
function opDisplayName(op: PipeOp): string {
  const name = OP_KEYWORD[op.type] ?? op.type.toLowerCase();
  const args = (op as { args?: unknown[] }).args;
  if (args?.length) {
    const parts = args.map(literalText).filter(Boolean);
    if (parts.length) return `${name} ${parts.join(' ')}`;
  }
  const tag = (op as { name?: string }).name;
  if (op.type === 'AsTag' && tag) return `as $${tag}`;
  return name;
}

