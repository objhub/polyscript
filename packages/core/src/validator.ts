/**
 * PolyScript validator — context model type checking.
 *
 * Tracks the context (Workplane/Face/Wire/3D/FaceSelection/EdgeSelection/VertexSelection/PointSelection)
 * as it walks through pipeline operations, and reports errors when an operation
 * is used in an invalid context.
 */

import type {
  Program, Statement, Expression, PipeOp, Pipeline,
  FuncDef, FuncCall,
} from './ast.js';
import { nextContext, static2DType, shapeOperatorKind, opKeyword } from './context.js';
import type { DiagnosticCode } from './diagnostics.js';
import { BUILTIN_ARITY, BUILTIN_GLOSS } from './eval/types.js';

// --- Context types ---

export type Context =
  | 'Workplane'
  | 'Face'
  | 'Wire'
  | '3D'
  | 'FaceSelection'
  | 'EdgeSelection'
  | 'VertexSelection'
  | 'PointSelection';

// --- Validation error ---

/** A validation failure. `code` is stable and safe to key off; `message` is
 *  prose and may be reworded. The fix goes in `hint`, apart from the message,
 *  so a caller can show or drop it independently. */
export interface ValidationError {
  code: DiagnosticCode;
  message: string;
  nodeType: string;
  hint?: string;
  line?: number;
  column?: number;
}

/** Ops whose one required positional argument has no default, and the name to
 *  report. Table rather than a switch: adding an op is one line, and every
 *  message comes out with the same wording. */
const REQUIRED_ARG: Partial<Record<PipeOp['type'], string>> = {
  Extrude: 'height',
  Loft: 'sections list',
  Hole: 'radius',
  Fillet: 'radius',
  Chamfer: 'radius',
  Shell: 'thickness',
  Offset: 'distance',
  Scale: 'factor',
  Mirror: 'axis',
  Diff: 'shape',
  Union: 'shape',
  Inter: 'shape',
};

// --- Allowed operations per context ---

export const CONTEXT_OPS: Readonly<Record<Context, ReadonlySet<string>>> = {
  Workplane: new Set([
    'RectExpr', 'CircleExpr', 'EllipseExpr', 'PolylineExpr', 'PolygonExpr', 'TextExpr',
    'Implicit2DPrimitive', 'Place',
    'PointsSelect',
    // A workplane is a drawing cursor: you can reposition it, drill at its
    // origin, or turn it into a point set. `faces >Z | workplane origin: 0 0
    // | hole r` is the documented way to drill at an explicit spot.
    'Hole', 'Move', 'MoveTo', 'GridPipe', 'PolarPipe', 'AsTag',
  ]),
  // A Face is a region: everything that needs an area is legal here.
  Face: new Set([
    'Extrude', 'Revolve', 'Sweep', 'Loft', 'Cut', 'Hole', 'Fillet', 'Offset',
    'Move', 'MoveTo', 'Implicit2DPrimitive', 'Place',
    // In-plane rotation (one angle) and in-plane mirror. A workplane with
    // nothing drawn on it gets neither: that would move the drawing frame
    // itself, which SPEC declines.
    'Rotate', 'Mirror',
    'Diff', 'Union', 'Inter',
    'VertsSelect',
    'GridPipe', 'PolarPipe',
  ]),
  // A Wire is a curve: it can be a sweep spine, be thickened into a Face by
  // `offset`, or have its corners rounded. Area operations (extrude, cut,
  // revolve, loft, booleans) are rejected here; use `sketch` for an outline.
  Wire: new Set([
    'Sweep', 'Offset', 'Fillet',
    'Move', 'MoveTo', 'Implicit2DPrimitive', 'Place',
    'Rotate', 'Mirror',
    'VertsSelect',
    'GridPipe', 'PolarPipe',
  ]),
  '3D': new Set([
    'FacesSelect', 'EdgesSelect', 'VertsSelect',
    'Fillet', 'Chamfer', 'Shell',
    'Diff', 'Union', 'Inter',
    'Translate', 'Rotate', 'Scale', 'Mirror', 'Floor',
    'Color',
    'AsTag',
    'GridPipe', 'PolarPipe',
  ]),
  FaceSelection: new Set([
    'Workplane', 'PointsSelect', 'Fillet', 'Chamfer', 'Shell', 'Offset', 'AsTag',
    'Implicit2DPrimitive', 'Place', 'Hole', 'Move', 'MoveTo',
    // SPEC L1035-1039: `grid`/`polar` after `faces` are shorthand for
    // `points (grid ...)` / `points (polar ...)` and transition to PointSelection.
    'GridPipe', 'PolarPipe',
  ]),
  EdgeSelection: new Set([
    'Fillet', 'Chamfer', 'AsTag',
  ]),
  VertexSelection: new Set([
    'Implicit2DPrimitive', 'Implicit3DPrimitive', 'AsTag', 'Translate', 'Place',
  ]),
  PointSelection: new Set([
    'Hole', 'Implicit2DPrimitive', 'Implicit3DPrimitive', 'Translate', 'Place',
    // devel/TODO.md: grid/polar chain in point context.
    'GridPipe', 'PolarPipe',
  ]),
};

// --- Source expression context ---

function sourceContext(expr: Expression): Context | null {
  switch (expr.type) {
    case 'BoxExpr':
    case 'CylinderExpr':
    case 'SphereExpr':
      return '3D';
    case 'Union':
    case 'Diff':
    case 'Inter': {
      // Determine context from the list elements (e.g. union [rect ...] → Face).
      // null (an operand that cannot be resolved statically, such as a
      // variable) must propagate: assuming 3D here rejects the legal
      // `union [$profile, circle 9.5] | extrude 8`.
      const listArg = expr.args[0];
      const probe =
        listArg && listArg.type === 'ListLit' && listArg.elements.length > 0
          ? listArg.elements[0]
          : listArg;
      if (probe) {
        const c = sourceContext(probe);
        // A boolean of 2D operands is a Face (a Wire operand is an eval error).
        return c === 'Wire' ? 'Face' : c;
      }
      return '3D';
    }
    case 'BinOp': {
      // `(a) - (b)`: a shape operator. Either side may be unresolvable
      // (a variable); take the first that is known. A Wire operand is an
      // eval error, so the static result of a 2D boolean is Face.
      if (!shapeOperatorKind(expr.op)) return null;
      const c = sourceContext(expr.left) ?? sourceContext(expr.right);
      return c === 'Wire' ? 'Face' : c;
    }
    case 'Workplane':
      return 'Workplane';
    case 'Pipeline':
      return pipelineResultContext(expr);
    case 'IfExpr': {
      // `if c then circle 10 else rect 20 15 | extrude 5`: the pipe applies
      // to whichever branch runs, so the context is known only when both agree.
      const a = sourceContext(expr.thenExpr);
      const b = sourceContext(expr.elseExpr);
      return a !== null && a === b ? a : null;
    }
    case 'FuncCall':
    case 'VarRef':
      // Can't statically determine — return null to skip validation
      return null;
    default:
      return static2DType(expr) ?? '3D';
  }
}

function pipelineResultContext(pipeline: Pipeline): Context | null {
  let ctx = sourceContext(pipeline.source);
  for (const op of pipeline.ops) {
    if (ctx === null) return null;
    ctx = nextContext(ctx, op.type) as Context;
  }
  return ctx;
}

// --- Validator ---

export function validate(program: Program): ValidationError[] {
  const errors: ValidationError[] = [];
  const funcDefs = new Map<string, FuncDef>();
  const variables = new Set<string>();

  for (const stmt of program.statements) {
    validateStatement(stmt, errors, funcDefs, variables);
  }
  validateBuiltinCalls(program, errors);
  validateFunctionValues(program, errors);

  return errors;
}

/**
 * `cylinder r (3) 10`: with the space, the def `r` lands in the argument list
 * as a value and `(3)` as the next argument. A function is never a number or a
 * shape, so in a command's arguments or under an operator it can only be a
 * call that lost its parentheses. Arguments of a user function are left alone:
 * a def may take another def and call it.
 */
function validateFunctionValues(program: Program, errors: ValidationError[]): void {
  const defs = new Set(
    program.statements.flatMap((s) => (s.type === 'FuncDef' ? [s.name] : [])),
  );
  if (defs.size === 0) return;
  // A name also bound as a value somewhere is ambiguous here; leave it.
  const bound = new Set<string>();
  walkNodes(program, (n) => {
    if (n.type === 'Assignment') bound.add((n as unknown as { name: string }).name);
    if (n.type === 'ListComp') bound.add((n as unknown as { variable: string }).variable);
  });

  const scan = (root: unknown, params: ReadonlySet<string>) => walkNodes(root, (n) => {
    const node = n as Record<string, unknown>;
    let operands: unknown[] = [];
    if (n.type === 'BinOp') operands = [node.left, node.right];
    else if (n.type === 'UnaryNeg') operands = [node.operand];
    else if (n.type !== 'FuncCall') {
      operands = [
        ...((node.args as unknown[] | undefined) ?? []),
        ...(((node.namedArgs as { value: unknown }[] | undefined) ?? []).map((a) => a.value)),
      ];
    }
    for (const o of operands) {
      const ref = o as { type?: string; name?: string; loc?: { line: number; column: number } };
      if (ref?.type !== 'VarRef' || !ref.name) continue;
      if (!defs.has(ref.name) || bound.has(ref.name) || params.has(ref.name)) continue;
      errors.push({
        code: 'arg.function-value',
        message: `'${ref.name}' is a function, used here as a value`,
        nodeType: 'VarRef',
        hint: `call it with the arguments right after the name, no space: ${ref.name}(...)`,
        ...(ref.loc ? { line: ref.loc.line, column: ref.loc.column } : {}),
      });
    }
  });

  for (const stmt of program.statements) {
    if (stmt.type === 'FuncDef') scan(stmt.body, new Set(stmt.params));
    else scan(stmt, new Set());
  }
}

/** `rad(a, b, c)`: calls to built-ins resolve before any def, so a count
 *  outside the built-in's range means the call was meant for something else. */
function validateBuiltinCalls(program: Program, errors: ValidationError[]): void {
  walkNodes(program, node => {
    if (node.type !== 'FuncCall') return;
    const call = node as FuncCall;
    const arity = BUILTIN_ARITY[call.name];
    if (!arity) return;
    const [min, max] = arity;
    const n = call.args.length;
    if (n >= min && n <= max) return;
    const want = min === max ? `${min}` : max === Infinity ? `at least ${min}` : `${min} to ${max}`;
    errors.push({
      code: 'call.arity',
      message: `built-in '${call.name}' (${BUILTIN_GLOSS[call.name]}) takes ${want} argument${want === '1' ? '' : 's'}, got ${n}`,
      nodeType: 'FuncCall',
      hint: `if you meant your own function, name it something other than '${call.name}'`,
      ...(call.loc ? { line: call.loc.line, column: call.loc.column } : {}),
    });
  });
}

/** Visit every AST node below `node`, whatever its type: anything with a
 *  string `type` counts, so new node kinds are covered without a case here. */
function walkNodes(node: unknown, visit: (n: { type: string }) => void): void {
  if (Array.isArray(node)) {
    for (const child of node) walkNodes(child, visit);
    return;
  }
  if (node === null || typeof node !== 'object') return;
  const obj = node as Record<string, unknown>;
  if (typeof obj.type === 'string') visit(obj as { type: string });
  for (const [key, child] of Object.entries(obj)) {
    if (key !== 'loc' && child !== null && typeof child === 'object') walkNodes(child, visit);
  }
}

function validateStatement(
  stmt: Statement,
  errors: ValidationError[],
  funcDefs: Map<string, FuncDef>,
  variables: Set<string>,
): void {
  switch (stmt.type) {
    case 'FuncDef':
      if (stmt.name in BUILTIN_ARITY) {
        errors.push({
          code: 'def.shadows-builtin',
          message: `'${stmt.name}' is a built-in function (${BUILTIN_GLOSS[stmt.name]}); calls would never reach this def`,
          nodeType: 'FuncDef',
          hint: `rename the def, e.g. 'my_${stmt.name}'`,
          ...(stmt.loc ? { line: stmt.loc.line, column: stmt.loc.column } : {}),
        });
      }
      funcDefs.set(stmt.name, stmt);
      // Validate function body
      validateExpression(stmt.body, errors, funcDefs, variables);
      break;
    case 'Assignment':
      variables.add(stmt.name);
      validateExpression(stmt.value, errors, funcDefs, variables);
      break;
    case 'Import':
      break;
    default:
      validateExpression(stmt, errors, funcDefs, variables);
  }
}

function validateExpression(
  expr: Expression,
  errors: ValidationError[],
  funcDefs: Map<string, FuncDef>,
  variables: Set<string>,
): void {
  if (expr.type === 'Pipeline') {
    validatePipeline(expr, errors);
  }

  // Check variable/function references
  if (expr.type === 'VarRef' && !variables.has(expr.name)) {
    // Not an error during parsing — could be a parameter or forward reference
    // Soft check only
  }

  if (expr.type === 'FuncCall' && !funcDefs.has(expr.name) && !variables.has(expr.name)) {
    // Could be an imported function — soft check only
  }

  // Recurse into operator operands: `(rect 10 10 | extrude 5) - hole`
  if (expr.type === 'BinOp') {
    validateExpression(expr.left, errors, funcDefs, variables);
    validateExpression(expr.right, errors, funcDefs, variables);
  }

  // Recurse into IndexAccess sub-expressions
  if (expr.type === 'IndexAccess') {
    validateExpression(expr.object, errors, funcDefs, variables);
    validateExpression(expr.index, errors, funcDefs, variables);
  }
}

/**
 * `'rect' is not valid in 3D context (allowed in: Workplane, Face, ...)`, plus
 * a hint for the two common slips: drawing on a solid without selecting a
 * face, and applying a 3D op to an outline that was never extruded.
 */
function invalidOpMessage(op: PipeOp, ctx: Context): { message: string; hint?: string } {
  const name = opKeyword(op);
  const allowedIn = (Object.keys(CONTEXT_OPS) as Context[]).filter(c => CONTEXT_OPS[c].has(op.type));
  let hint: string | undefined;
  if ((ctx === 'Face' || ctx === 'Wire') && (op.type === 'Translate' || op.type === 'Scale')) {
    // Not "extrude first": the usual intent is to place or stand up a 2D
    // shape, which it cannot do off its workplane.
    hint = `a 2D shape stays on its workplane: place it when drawing ('rect 10 10 at:(5, 5)'), `
      + `or draw it on the plane you want ('workplane XZ | wire [...]')`;
  } else if (ctx === '3D' && (allowedIn.includes('Face') || allowedIn.includes('Workplane'))) {
    hint = `select a face to draw on first ('| faces >Z | ${name} ...')`;
  } else if (ctx === 'Wire' && allowedIn.includes('Face')) {
    hint = `a wire has no area; draw a closed outline with 'sketch [...]', or give the wire a width with 'offset d'`;
  } else if ((ctx === 'Face' || ctx === 'Wire' || ctx === 'Workplane') && allowedIn.includes('3D')) {
    hint = `extrude the outline first ('| extrude h | ${name} ...')`;
  }
  return {
    message: `'${name}' is not valid in ${ctx} context (allowed in: ${allowedIn.join(', ')})`,
    hint,
  };
}

/**
 * `rotate` takes one angle on a 2D shape (in-plane) and three on a solid
 * (SPEC 変形). The evaluator enforces the same rule; checking it here, where
 * the context is known statically, stops `arc ... | rotate 90 0 0 | sweep`
 * at `poly check` -- the usual attempt to stand a path drawn in XY up.
 */
function rotateArityError(n: number, ctx: Context): { message: string; hint?: string } | null {
  if (ctx === 'Face' || ctx === 'Wire') {
    if (n === 1) return null;
    return {
      message: `rotate on a 2D shape (${ctx}) takes 1 angle, about the workplane normal; got ${n}`,
      hint: n === 3
        ? "a 2D shape stays on its workplane: draw it on the plane you want ('workplane XZ | wire [arc ...] | sweep ...'), "
          + "or give a path 3D points ('arc (0,0,-25) (25,0,0) center:(0,0,0)')"
        : "turn it in its plane with one angle: 'rotate 45'",
    };
  }
  if (ctx === '3D' && n !== 3) {
    return {
      message: `rotate on a solid takes 3 angles (rx ry rz); got ${n}`,
      hint: n === 1 ? "about Z only: 'rotate 0 0 45'" : 'give all three, zeros included',
    };
  }
  return null;
}

/** Source position of an op, if the parser recorded one. */
function locOf(op: PipeOp): { line?: number; column?: number } {
  const loc = (op as { loc?: { line: number; column: number } }).loc;
  return loc ? { line: loc.line, column: loc.column } : {};
}

function validatePipeline(pipeline: Pipeline, errors: ValidationError[]): void {
  let ctx: Context | null = sourceContext(pipeline.source);

  for (const op of pipeline.ops) {
    // Skip validation when context is unknown (e.g. FuncCall/VarRef source)
    if (ctx !== null) {
      const allowed = CONTEXT_OPS[ctx];
      if (allowed && !allowed.has(op.type)) {
        const { message, hint } = invalidOpMessage(op, ctx);
        errors.push({ code: 'context.invalid-op', message, nodeType: op.type, hint, ...locOf(op) });
        // A refused translate / scale moved nothing: judge the rest against
        // the 2D shape still held, not an invented solid (one error, not a
        // cascade into `'sweep' is not valid in 3D context`).
        if ((ctx === 'Face' || ctx === 'Wire') && (op.type === 'Translate' || op.type === 'Scale')) continue;
      } else if (op.type === 'Rotate') {
        const e = rotateArityError(op.args.length, ctx);
        if (e) errors.push({ code: 'arg.count', nodeType: op.type, ...e, ...locOf(op) });
      }
      ctx = nextContext(ctx, op.type, op) as Context;
    } else {
      // Context is unknown (a VarRef or FuncCall source). Only recover it from
      // ops whose result context does not depend on their input -- `extrude`
      // always yields 3D, `faces` always yields a FaceSelection.
      //
      // Assuming 3D for the rest used to "recover" a context that was never
      // established, and then reject legal pipelines built on it:
      // `$profile | polar 6 0 | union (circle 5) | extrude 3` was refused
      // because the boolean was judged in the invented 3D context.
      const from3D = nextContext('3D', op.type, op);
      const fromFace = nextContext('Face', op.type, op);
      const fromWire = nextContext('Wire', op.type, op);
      if (from3D === fromFace && from3D === fromWire) ctx = from3D as Context;
    }
  }

  // Validate nested expressions in pipe ops
  for (const op of pipeline.ops) {
    validatePipeOpNested(op, errors);
  }
}

function validatePipeOpNested(op: PipeOp, errors: ValidationError[]): void {
  // `revolve` is exempt: the parser enforces the axis, and the angle defaults
  // to 360 at eval time.
  const argName = REQUIRED_ARG[op.type];
  if (argName && 'args' in op && op.args.length === 0) {
    errors.push({
      code: 'arg.missing',
      message: `${opKeyword(op)} requires a ${argName} argument`,
      nodeType: op.type,
      ...locOf(op),
    });
  }
}
