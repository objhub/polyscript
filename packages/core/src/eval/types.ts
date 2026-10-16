/**
 * Evaluator types, helpers, and utilities.
 */

import type { Expression, NamedArg, SourceLocation } from '../ast.js';
import type { WpState } from '../ocp-kernel.js';
import type { DiagnosticCode } from '../diagnostics.js';

// ---------------------------------------------------------------------------
// Value types
// ---------------------------------------------------------------------------

/** Runtime value — either a primitive or a WpState (shape context). */
export type Value =
  | number
  | string
  | boolean
  | null
  | Value[]
  | [number, number]
  | WpState
  | UserFunc
  | BBoxValue;

/** The value of `$g.bbox`: axis-aligned extent, with its own properties
 *  (`.x .y .z` sizes, `.min .max .center` as 3-element lists). */
export interface BBoxValue {
  __kind: 'bbox';
  min: [number, number, number];
  max: [number, number, number];
}

export interface UserFunc {
  __kind: 'func';
  name: string;
  params: string[];
  body: Expression;
  closure: Environment;
}

// ---------------------------------------------------------------------------
// Environment (variable scope)
// ---------------------------------------------------------------------------

export class Environment {
  private bindings: Map<string, Value>;
  private parent: Environment | null;

  constructor(parent: Environment | null = null) {
    this.bindings = new Map();
    this.parent = parent;
  }

  get(name: string): Value {
    if (this.bindings.has(name)) return this.bindings.get(name)!;
    if (this.parent) return this.parent.get(name);
    throw new EvalError(`Undefined variable: ${name}`);
  }

  set(name: string, value: Value): void {
    this.bindings.set(name, value);
  }

  has(name: string): boolean {
    if (this.bindings.has(name)) return true;
    if (this.parent) return this.parent.has(name);
    return false;
  }

  child(): Environment {
    return new Environment(this);
  }
}

// ---------------------------------------------------------------------------
// Evaluation error
// ---------------------------------------------------------------------------

export class EvalError extends Error {
  loc?: SourceLocation;
  /** Stable diagnostic code, when the thrower named one. Kernel-level throws
   *  carry it on a plain Error; the evaluator moves it across when it attaches
   *  the source position. */
  code?: DiagnosticCode;
  hint?: string;
  /** The message without the ` at line N, column M` tail. A structured
   *  diagnostic carries the position in its own fields and would otherwise
   *  print it twice. */
  rawMessage: string;
  constructor(message: string, loc?: SourceLocation, opts: { code?: DiagnosticCode; hint?: string } = {}) {
    const locStr = loc ? ` at line ${loc.line}, column ${loc.column}` : '';
    super(message + locStr);
    this.name = 'EvalError';
    this.rawMessage = message;
    this.loc = loc;
    this.code = opts.code;
    this.hint = opts.hint;
  }
}

// ---------------------------------------------------------------------------
// Math builtins
// ---------------------------------------------------------------------------

export const MATH_FUNCS: Record<string, (...args: number[]) => number> = {
  sin: (deg: number) => Math.sin(deg * Math.PI / 180),
  cos: (deg: number) => Math.cos(deg * Math.PI / 180),
  tan: (deg: number) => Math.tan(deg * Math.PI / 180),
  asin: (x: number) => Math.asin(x) * 180 / Math.PI,
  acos: (x: number) => Math.acos(x) * 180 / Math.PI,
  atan: (x: number) => Math.atan(x) * 180 / Math.PI,
  atan2: (y: number, x: number) => Math.atan2(y, x) * 180 / Math.PI,
  sqrt: Math.sqrt,
  abs: Math.abs,
  floor: Math.floor,
  ceil: Math.ceil,
  round: Math.round,
  min: Math.min,
  max: Math.max,
  radians: (deg: number) => deg * Math.PI / 180,
  degrees: (rad: number) => rad * 180 / Math.PI,
  rad: (deg: number) => deg * Math.PI / 180,
  deg: (rad: number) => rad * 180 / Math.PI,
  // len accepts an array at runtime despite the numeric signature; callers
  // bypass asNumber() for len.  The cast keeps the Record<> key uniform.
  len: ((arr: unknown) => Array.isArray(arr) ? arr.length : 0) as (...args: number[]) => number,
};

/** Argument counts `[min, max]` of the built-in functions, `range` included.
 *  The validator reports a call outside the range as `call.arity`: before
 *  this, `rad($R, $k, $t)` silently dropped the extra arguments. */
export const BUILTIN_ARITY: Record<string, [number, number]> = {
  ...Object.fromEntries(Object.keys(MATH_FUNCS).map(name => [name, [1, 1]])),
  atan2: [2, 2],
  min: [1, Infinity],
  max: [1, Infinity],
  range: [1, 3],
  clear: [2, 2],
};

/** One-line gloss of each built-in, for messages that name one. */
export const BUILTIN_GLOSS: Record<string, string> = {
  sin: 'sine of degrees', cos: 'cosine of degrees', tan: 'tangent of degrees',
  asin: 'arcsine in degrees', acos: 'arccosine in degrees', atan: 'arctangent in degrees',
  atan2: 'arctangent of y/x in degrees', sqrt: 'square root', abs: 'absolute value',
  floor: 'round down', ceil: 'round up', round: 'round to nearest',
  min: 'smallest argument', max: 'largest argument',
  radians: 'degrees → radians', degrees: 'radians → degrees',
  rad: 'degrees → radians', deg: 'radians → degrees',
  len: 'length of a list', range: 'list of integers',
  clear: 'true when two shapes do not intersect',
};

// ---------------------------------------------------------------------------
// Named arg helpers
// ---------------------------------------------------------------------------

export function resolveNamedArgs(
  namedArgs: NamedArg[],
  evalExpr: (e: Expression) => Value,
): Map<string, Value> {
  const map = new Map<string, Value>();
  for (const na of namedArgs) {
    map.set(na.key, evalExpr(na.value));
  }
  return map;
}

export function getNamedNum(kwargs: Map<string, Value>, key: string, def?: number): number {
  if (kwargs.has(key)) return asNumber(kwargs.get(key)!);
  if (def !== undefined) return def;
  throw new EvalError(`Missing required named argument: ${key}`);
}

export function getNamedStr(kwargs: Map<string, Value>, key: string, def?: string): string {
  if (kwargs.has(key)) return String(kwargs.get(key)!);
  if (def !== undefined) return def;
  throw new EvalError(`Missing required named argument: ${key}`);
}

// ---------------------------------------------------------------------------
// Type coercions
// ---------------------------------------------------------------------------

export function asNumber(v: Value): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  throw new EvalError(`Expected number, got ${typeof v}`);
}

export function asString(v: Value): string {
  if (typeof v === 'string') return v;
  return String(v);
}

/** Short type name of a value, for error messages. */
export function describeValue(v: Value): string {
  if (isWpState(v)) return 'a shape';
  if (isBBox(v)) return 'a bbox';
  if (Array.isArray(v)) return 'a list';
  if (v === null || v === undefined) return 'nothing';
  return typeof v;
}

/** Coerce a value to a workplane state. `op` names the operation in the error
 * (`diff: expected a shape, got number` for `box | diff 5`). */
export function asWpState(v: Value, op?: string): WpState {
  if (isWpState(v)) return v;
  throw new EvalError(`${op ? `${op}: ` : ''}expected a shape, got ${describeValue(v)}`);
}

export function isWpState(v: Value): v is WpState {
  if (v === null || typeof v !== 'object') return false;
  const obj = v as unknown as Record<string, unknown>;
  return 'oc' in obj && 'plane' in obj;
}

export function isBBox(v: Value): v is BBoxValue {
  if (v === null || typeof v !== 'object') return false;
  const obj = v as unknown as Record<string, unknown>;
  return '__kind' in obj && obj.__kind === 'bbox';
}

export function isUserFunc(v: Value): v is UserFunc {
  if (v === null || typeof v !== 'object') return false;
  const obj = v as unknown as Record<string, unknown>;
  return '__kind' in obj && obj.__kind === 'func';
}

export function asTupleList(v: Value): [number, number][] {
  if (Array.isArray(v)) {
    return v.map(item => {
      if (Array.isArray(item) && item.length >= 2) {
        return [asNumber(item[0]), asNumber(item[1])];
      }
      throw new EvalError(`Expected (x, y) tuple in list`);
    });
  }
  throw new EvalError(`Expected list of tuples`);
}
