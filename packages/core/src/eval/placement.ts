/**
 * Placement and group evaluator functions: at, polar, grid, group.
 */

import type { Expression, GridPipe, PolarPipe, NamedArg } from '../ast.js';
import type { OC, Shape, WpState } from '../ocp-kernel.js';
import { wpPushPoints } from '../ocp-kernel.js';
import { pushWarning } from '../diagnostics.js';
import { asNumber, getNamedNum, resolveNamedArgs, type Value } from './types.js';

export function placementToPoints(val: Value): [number, number, number][] {
  if (Array.isArray(val)) {
    // Flat tuple: [x, y] or [x, y, z]
    if (val.length >= 2 && typeof val[0] === 'number' && typeof val[1] === 'number') {
      // Could be a single point or a list of points
      if (val.every(v => typeof v === 'number')) {
        // Single point: (x, y) or (x, y, z)
        return [[val[0] as number, val[1] as number, (val[2] as number) ?? 0]];
      }
    }
    // List of tuples
    if (val.length > 0 && Array.isArray(val[0])) {
      return val.map(item => {
        const arr = item as Value[];
        return [asNumber(arr[0]), asNumber(arr[1]), arr[2] != null ? asNumber(arr[2]) : 0];
      });
    }
    // Already points
    return (val as [number, number][]).map(p => [p[0], p[1], 0]);
  }
  return [[0, 0, 0]];
}

/**
 * Apply at-placement to a WpState: translate shape/wires to the given points.
 * Used by 2D/3D primitive evaluators when `at:` named arg is present.
 */
export function applyAtPlacement(
  oc: OC,
  state: WpState,
  placementVal: Value,
): WpState {
  const points = placementToPoints(placementVal);
  if (points.length === 0) return state;

  // 3D shape: translate copies and combine as compound
  if (state.shape) {
    if (points.length === 1) {
      const [x, y, z] = points[0];
      const result = (x !== 0 || y !== 0 || z !== 0)
        ? oc.translate(state.shape, x, y, z)
        : state.shape;
      return { ...state, shape: result } as WpState;
    }
    const translated = points.map(([x, y, z]) => oc.translate(state.shape!, x, y, z));
    const result = oc.makeCompound(translated);
    return { ...state, shape: result } as WpState;
  }

  // 2D faces/wires: translate copies
  if (state.faces.length > 0 || state.wires.length > 0) {
    const copies = (items: Shape[]) => items.flatMap(item =>
      points.map(([x, y, z]) => (x !== 0 || y !== 0 || z !== 0) ? oc.translate(item, x, y, z) : item));
    return { ...state, faces: copies(state.faces), wires: copies(state.wires) } as WpState;
  }

  // Fallback: set center points (2D only)
  return wpPushPoints(state, points.map(([x, y]) => [x, y] as [number, number]));
}

// --- Pipe operations: grid / polar ---

export function gridPoints(args: number[], namedArgs: NamedArg[], evalFn: (e: Expression) => Value): [number, number][] {
  const kwargs = resolveNamedArgs(namedArgs, evalFn);
  const nx = args[0] ?? 1;
  const ny = args[1] ?? 1;
  const sp = args[2] ?? getNamedNum(kwargs, 'pitch', 10);
  const points: [number, number][] = [];
  const offX = (nx - 1) * sp / 2;
  const offY = (ny - 1) * sp / 2;
  for (let iy = 0; iy < ny; iy++) {
    for (let ix = 0; ix < nx; ix++) {
      points.push([ix * sp - offX, iy * sp - offY]);
    }
  }
  return points;
}

export function polarPoints(args: number[], namedArgs: NamedArg[], evalFn: (e: Expression) => Value): [number, number][] {
  const kwargs = resolveNamedArgs(namedArgs, evalFn);
  const count = args[0] ?? getNamedNum(kwargs, 'count');
  const radius = args[1] ?? getNamedNum(kwargs, 'radius');
  const points: [number, number][] = [];
  for (let i = 0; i < count; i++) {
    const angle = (2 * Math.PI * i) / count;
    points.push([radius * Math.cos(angle), radius * Math.sin(angle)]);
  }
  return points;
}

function applyArrayPlacement(
  oc: OC, state: WpState, points: [number, number][],
): WpState {
  if (points.length === 0) return state;

  // 2D faces/wires: translate copies (check before shape, because
  // face-selection context carries the base shape AND active 2D content)
  if (state.faces.length > 0 || state.wires.length > 0) {
    const copies = (items: Shape[]) => items.flatMap(item =>
      points.map(([x, y]) => (x !== 0 || y !== 0) ? oc.translate(item, x, y, 0) : item));
    return { ...state, faces: copies(state.faces), wires: copies(state.wires) } as WpState;
  }

  // 3D shape: translate copies and combine as compound
  if (state.shape) {
    const copies = points.map(([x, y]) => oc.translate(state.shape!, x, y, 0));
    return { ...state, shape: oc.makeCompound(copies) } as WpState;
  }

  return state;
}

export function evalGridPipe(
  oc: OC, state: WpState, op: GridPipe, evalFn: (e: Expression) => Value,
): WpState {
  const args = op.args.map(e => asNumber(evalFn(e)));
  const points = gridPoints(args, op.namedArgs, evalFn);
  return applyArrayPlacement(oc, state, points);
}

export function evalPolarPipe(
  oc: OC, state: WpState, op: PolarPipe, evalFn: (e: Expression) => Value,
): WpState {
  const args = op.args.map(e => asNumber(evalFn(e)));
  const kwargs = resolveNamedArgs(op.namedArgs, evalFn);
  const count = args[0] ?? getNamedNum(kwargs, 'count');
  const radius = args[1] ?? getNamedNum(kwargs, 'radius');
  const orient = kwargs.get('orient');

  if (orient) {
    return applyPolarRotate(oc, state, count, radius);
  }
  // Radius 0 without orient puts every copy on the original: the result
  // looks like one part and the feature that was meant to repeat is there
  // once (four published models shipped that way, devel/lessons.md 2026-11-18).
  if (radius === 0 && count > 1) {
    pushWarning(`polar ${count} 0 places all ${count} copies in the same spot`, {
      code: 'check.no-effect',
      hint: 'add orient:true to turn the copies about Z, or give a radius',
      loc: op.loc,
    });
  }
  const points = polarPoints(args, op.namedArgs, evalFn);
  return applyArrayPlacement(oc, state, points);
}

function applyPolarRotate(
  oc: OC, state: WpState, count: number, radius: number,
): WpState {
  const zAxis = { point: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: 0, z: 1 } };

  if (state.faces.length > 0 || state.wires.length > 0) {
    const copies = (items: Shape[]) => items.flatMap(item => {
      const out: Shape[] = [];
      for (let i = 0; i < count; i++) {
        const angleRad = (2 * Math.PI * i) / count;
        const x = radius * Math.cos(angleRad);
        const y = radius * Math.sin(angleRad);
        let w = item;
        if (angleRad !== 0) w = oc.rotate(w, zAxis, angleRad);
        if (x !== 0 || y !== 0) w = oc.translate(w, x, y, 0);
        out.push(w);
      }
      return out;
    });
    return { ...state, faces: copies(state.faces), wires: copies(state.wires) } as WpState;
  }

  if (state.shape) {
    const copies: Shape[] = [];
    for (let i = 0; i < count; i++) {
      const angleRad = (2 * Math.PI * i) / count;
      const x = radius * Math.cos(angleRad);
      const y = radius * Math.sin(angleRad);
      let copy = state.shape;
      if (angleRad !== 0) copy = oc.rotate(copy, zAxis, angleRad);
      if (x !== 0 || y !== 0) copy = oc.translate(copy, x, y, 0);
      copies.push(copy);
    }
    return { ...state, shape: oc.makeCompound(copies) } as WpState;
  }

  return state;
}

