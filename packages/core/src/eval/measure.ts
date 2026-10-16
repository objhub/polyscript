/**
 * Measured properties of values -- what `$g.volume`, `$g.bbox.x` and the
 * `assert` / `print` statements read.
 *
 * Only discrete or cheaply computed quantities (devel/lang-vision202609.md
 * section 6): counts, volume, area, bbox, validity, and `clear()` which is
 * one boolean. Nothing here samples or sweeps.
 */

import type { OC, Shape, WpState } from '../ocp-kernel/types.js';
import { EvalError, isBBox, isWpState, isUserFunc, describeValue, type BBoxValue, type Value } from './types.js';

export const SOLID_PROPS = ['volume', 'area', 'solids', 'faces', 'edges', 'verts', 'bbox', 'valid'] as const;
export const PLANAR_PROPS = ['area', 'faces', 'wires', 'bbox'] as const;
export const BBOX_PROPS = ['x', 'y', 'z', 'min', 'max', 'center'] as const;

/** `$g.<name>`. Throws `attr.unknown` with the list that applies. */
export function propertyOf(oc: OC, value: Value, name: string): Value {
  if (isBBox(value)) return bboxProperty(value, name);
  if (isWpState(value)) {
    const state = value as WpState;
    if (state.shape) return solidProperty(oc, state.shape, name);
    return planarProperty(oc, state, name);
  }
  throw unknownAttr(name, describeValue(value), []);
}

function solidProperty(oc: OC, shape: Shape, name: string): Value {
  switch (name) {
    case 'volume': return round(oc.getVolume(shape));
    case 'area': return round(oc.getSurfaceArea(shape));
    case 'solids': return oc.getSubShapes(shape, 'solid').length;
    case 'faces': return oc.getSubShapes(shape, 'face').length;
    case 'edges': return oc.getSubShapes(shape, 'edge').length;
    case 'verts': return oc.getSubShapes(shape, 'vertex').length;
    case 'bbox': return bboxOf(oc, [shape]);
    case 'valid': return oc.isValid(shape);
    default: throw unknownAttr(name, 'a solid', SOLID_PROPS);
  }
}

function planarProperty(oc: OC, state: WpState, name: string): Value {
  switch (name) {
    case 'area': {
      let a = 0;
      for (const f of state.faces) a += oc.getSurfaceArea(f as unknown as Shape);
      return round(a);
    }
    case 'faces': return state.faces.length;
    case 'wires': return state.wires.length;
    case 'bbox': return bboxOf(oc, [...state.faces, ...state.wires] as unknown as Shape[]);
    default: throw unknownAttr(name, 'a 2D shape', PLANAR_PROPS);
  }
}

function bboxProperty(b: BBoxValue, name: string): Value {
  switch (name) {
    case 'x': return round(b.max[0] - b.min[0]);
    case 'y': return round(b.max[1] - b.min[1]);
    case 'z': return round(b.max[2] - b.min[2]);
    case 'min': return [...b.min];
    case 'max': return [...b.max];
    case 'center': return [0, 1, 2].map((i) => round((b.min[i] + b.max[i]) / 2));
    default: throw unknownAttr(name, 'a bbox', BBOX_PROPS);
  }
}

function bboxOf(oc: OC, shapes: Shape[]): BBoxValue {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const s of shapes) {
    const bb = oc.getBoundingBox(s);
    min[0] = Math.min(min[0], bb.xmin); min[1] = Math.min(min[1], bb.ymin); min[2] = Math.min(min[2], bb.zmin);
    max[0] = Math.max(max[0], bb.xmax); max[1] = Math.max(max[1], bb.ymax); max[2] = Math.max(max[2], bb.zmax);
  }
  if (!shapes.length) return { __kind: 'bbox', min: [0, 0, 0], max: [0, 0, 0] };
  return {
    __kind: 'bbox',
    min: min.map(round) as [number, number, number],
    max: max.map(round) as [number, number, number],
  };
}

function unknownAttr(name: string, kind: string, props: readonly string[]): EvalError {
  const list = props.length ? `; ${kind} has ${props.join(' ')}` : '';
  return new EvalError(`${kind} has no property '${name}'${list}`, undefined, {
    code: 'attr.unknown',
    hint: props.length ? `use one of: ${props.map((p) => `.${p}`).join(' ')}` : 'only shapes and bboxes have properties',
  });
}

/**
 * `clear(a, b)`: the two solids share no volume. A bbox miss answers without a
 * boolean; otherwise one `common` decides. Touching counts as clear: a part
 * that sits exactly on another has zero common volume.
 */
export function shapesClear(oc: OC, a: Value, b: Value): boolean {
  const sa = solidOf(a, 'clear'), sb = solidOf(b, 'clear');
  const ba = oc.getBoundingBox(sa), bb = oc.getBoundingBox(sb);
  const eps = 1e-6;
  if (ba.xmax < bb.xmin - eps || bb.xmax < ba.xmin - eps
    || ba.ymax < bb.ymin - eps || bb.ymax < ba.ymin - eps
    || ba.zmax < bb.zmin - eps || bb.zmax < ba.zmin - eps) return true;
  const common = oc.common(sa, sb);
  const v = oc.getVolume(common);
  const ref = Math.max(Math.min(oc.getVolume(sa), oc.getVolume(sb)), 1e-12);
  return v / ref < 1e-9;
}

function solidOf(v: Value, fn: string): Shape {
  if (isWpState(v) && (v as WpState).shape) return (v as WpState).shape as Shape;
  throw new EvalError(`${fn}: expected a solid, got ${describeValue(v)}`);
}

/** `a ~ b`: within `tol` of the larger magnitude (relative) or within `tol`
 *  (absolute). Two zeros are equal under any tolerance. */
export function approxEqual(a: number, b: number, tol: { value: number; relative: boolean }): boolean {
  const d = Math.abs(a - b);
  if (tol.relative) return d <= tol.value / 100 * Math.max(Math.abs(a), Math.abs(b));
  return d <= tol.value;
}

export const DEFAULT_TOL = { value: 1, relative: true } as const;

/** One-line rendering of a value for messages and `print`. Numbers keep four
 *  decimals, a bbox reads as `80x60x25`, a solid as its summary, so a line is
 *  readable without the trace next to it. */
export function formatValue(oc: OC, v: Value): string {
  if (typeof v === 'number') return String(round(v));
  if (typeof v === 'string') return v;
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (v === null || v === undefined) return 'nothing';
  if (isBBox(v)) {
    const size = [0, 1, 2].map((i) => round(v.max[i] - v.min[i])).join('x');
    return `${size} at (${v.min.map(round).join(',')})`;
  }
  if (isUserFunc(v)) return `<function ${v.name}>`;
  if (isWpState(v)) {
    const s = v as WpState;
    if (s.shape) {
      try {
        const solids = oc.getSubShapes(s.shape, 'solid').length;
        const faces = oc.getSubShapes(s.shape, 'face').length;
        return `solid ${solids} faces ${faces} volume ${round(oc.getVolume(s.shape))}`;
      } catch { return 'a shape'; }
    }
    return `2d faces ${s.faces.length} wires ${s.wires.length}`;
  }
  if (Array.isArray(v)) return `[${v.map((e) => formatValue(oc, e as Value)).join(', ')}]`;
  return String(v);
}

function round(x: number): number {
  const r = Math.round(x * 10000) / 10000;
  return r === 0 ? 0 : r;
}
