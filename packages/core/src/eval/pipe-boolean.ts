/**
 * Boolean pipe operation evaluator functions: diff, union, inter.
 *
 * The operand is one shape expression, or a list of them (`diff [a, b]`).
 * A list folds left, one boolean per element -- the same order Python uses,
 * so `state | diff [a, b]` is `state.cut(a).cut(b)`. Lists are recognised
 * by their runtime value, matching the source-position `union [...]` path,
 * so a variable holding a list works too.
 *
 * The shape operators `+` `-` `*` (evalBinOp) are spellings of the same three
 * operations and go through `applyBoolean` too, so the two forms cannot drift.
 */

import type { Expression, Diff, Union, Inter } from '../ast.js';
import type { WpState } from '../ocp-kernel.js';
import { wpDiff, wpUnion, wpInter } from '../ocp-kernel.js';
import { mergeColorMaps } from '../ocp-kernel/types.js';
import { wpUnionAll } from '../ocp-kernel/boolean.js';
import { isWpState, describeValue, EvalError, type Value } from './types.js';

export type BooleanKind = 'union' | 'diff' | 'inter';

/** Turn an operand value (one shape or a list of shapes) into tool states.
 * `op` names the operation when an element is not a shape. */
export function toolStatesOf(v: Value, op?: string): WpState[] {
  const items: Value[] = Array.isArray(v) ? (v as Value[]) : [v];
  return items.map(item => {
    if (isWpState(item)) return item;
    throw new EvalError(`${op ? `${op}: ` : ''}expected a shape or a list of shapes, got ${describeValue(item)}`);
  });
}

/** A tool with no geometry at all is a no-op, not an error. */
function isEmpty(t: WpState): boolean {
  return !t.shape && t.faces.length === 0 && t.wires.length === 0;
}

/** Fold `tools` into `state` with one boolean per tool -- except a union of
 *  three or more solids, which is one n-ary fuse (wpUnionAll). */
export function applyBoolean(state: WpState, tools: WpState[], kind: BooleanKind): WpState {
  if (kind === 'union' && state.shape) {
    const live = tools.filter((t) => !isEmpty(t));
    if (live.length >= 2 && live.every((t) => t.shape)) {
      const result = wpUnionAll(state, live);
      let colorMap = state.colorMap;
      for (const t of live) colorMap = mergeColorMaps(colorMap, t.colorMap);
      if (colorMap) result.colorMap = colorMap;
      return result;
    }
  }
  for (const tool of tools) {
    if (isEmpty(tool)) continue;
    if (kind === 'diff') {
      state = wpDiff(state, tool);
      continue;
    }
    const result = kind === 'union' ? wpUnion(state, tool) : wpInter(state, tool);
    const colorMap = mergeColorMaps(state.colorMap, tool.colorMap);
    if (colorMap) result.colorMap = colorMap;
    state = result;
  }
  return state;
}

/** True when the value takes part in a shape boolean (a shape, or a list holding one). */
export function isShapeOperand(v: Value): boolean {
  if (isWpState(v)) return true;
  return Array.isArray(v) && v.length > 0 && v.every(x => isWpState(x));
}

function evalBooleanOp(state: WpState, op: Diff | Union | Inter, kind: BooleanKind,
  evalExprFn: (e: Expression) => Value): WpState {
  return applyBoolean(state, toolStatesOf(evalExprFn(op.args[0]), kind), kind);
}

export function evalDiffOp(state: WpState, op: Diff, evalExprFn: (e: Expression) => Value): WpState {
  return evalBooleanOp(state, op, 'diff', evalExprFn);
}

export function evalUnionOp(state: WpState, op: Union, evalExprFn: (e: Expression) => Value): WpState {
  return evalBooleanOp(state, op, 'union', evalExprFn);
}

export function evalInterOp(state: WpState, op: Inter, evalExprFn: (e: Expression) => Value): WpState {
  return evalBooleanOp(state, op, 'inter', evalExprFn);
}
