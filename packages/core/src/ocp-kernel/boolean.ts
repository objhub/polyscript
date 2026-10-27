/**
 * OCP Kernel boolean operations — diff, union, intersect.
 * Uses occt-wasm: kernel.cut(), kernel.fuse(), kernel.common().
 *
 * 3D context: operates on `s.shape`.
 * 2D context: operates on `s.faces` and stores the result back as faces,
 *   so hole information survives to extrude/revolve/cut (e.g. annulus from
 *   `circle 10 | diff (circle 3)`). Wires have no area and are rejected.
 * Mixing a solid with a 2D shape is a type error (see applyBool).
 *
 * All three spellings -- pipe op (`a | diff b`), source form (`diff [a, b]`)
 * and shape operator (`a - b`) -- end here via applyBoolean in the evaluator.
 */

import type { OC, WpState, Shape } from './types.js';
import { cloneState } from './types.js';
import { ensureSolid } from './geometry.js';
import { requireFaces, combineFaces, explodeFaces, replaneTo } from './faces.js';
import { pushWarning } from '../diagnostics.js';

type BoolOp = 'fuse' | 'cut' | 'common';
const BOOL_NAME: Record<BoolOp, string> = { fuse: 'union', cut: 'diff', common: 'inter' };

/**
 * Drop degenerate sliver solids that OCCT booleans leave behind.
 *
 * A last-resort safety net, deliberately conservative so it can never claim
 * legitimate geometry: a solid is dropped only when its volume is not
 * positive (inside-out/empty shells are invalid by construction) or its
 * characteristic thickness (volume / surface area) is under one micron.
 * The primary defense is modeling-side: a boolean tool should overhang the
 * surface it cuts instead of exactly touching it -- a tangent tool is what
 * generates these slivers. Mirrors _prune_debris_solids in the Python
 * kernel; the two implementations must agree for snapshot parity.
 */
export function pruneDebrisSolids(oc: OC, shape: Shape): Shape {
  const solids = oc.getSubShapes(shape, 'solid');
  if (solids.length < 2) return shape;
  const kept = solids.filter((s: Shape) => {
    const v = oc.getVolume(s);
    return v > 0 && v / Math.max(oc.getSurfaceArea(s), 1e-12) > 1e-3;
  });
  if (kept.length === solids.length || kept.length === 0) return shape;
  if (kept.length === 1) return kept[0];
  return oc.makeCompound(kept);
}


/**
 * Fuse two coplanar 2D shapes into a single face.
 *
 * fuse() splits same-dimension arguments at their intersections and returns
 * every piece, so overlapping profiles stay separate faces. Extruding that
 * gives one solid per piece, which matches by volume but is not a single
 * part -- the failure mode behind `tooth | polar n 0 orient:true | union
 * (circle r)`. unifySameDomain merges the coplanar pieces back into one face.
 */
function fuse2D(oc: OC, a: Shape, b: Shape): Shape {
  return oc.unifySameDomain(oc.fuse(a, b));
}

/** Build a 2D shape from a workplane state's faces (null when it has none). */
function build2DShape(oc: OC, s: WpState, op: string): Shape | null {
  return combineFaces(oc, requireFaces(s, op));
}

/** Apply a 2D boolean op between two states. Returns a new state whose faces
 * are the result. The tool is brought onto the state's plane first. */
function apply2DBool(s: WpState, other: WpState, op: BoolOp): WpState {
  const { oc } = s;
  const name = BOOL_NAME[op];
  const selfShape = build2DShape(oc, s, name);
  const otherShape = combineFaces(oc, requireFaces(cloneState(other, replaneTo(other, s.plane)), name));
  if (!selfShape && !otherShape) return s;
  if (!selfShape) {
    if (op === 'fuse' && otherShape) {
      return cloneState(s, { faces: explodeFaces(oc, otherShape) });
    }
    return s;
  }
  if (!otherShape) return s;
  let result: Shape;
  if (op === 'fuse') result = fuse2D(oc, selfShape, otherShape);
  else if (op === 'cut') result = oc.cut(selfShape, otherShape);
  else result = oc.common(selfShape, otherShape);
  return cloneState(s, { faces: explodeFaces(oc, result) });
}

/** Nothing at all: no solid, no drawing. */
function isBlank(s: WpState): boolean {
  return !s.shape && s.faces.length === 0 && s.wires.length === 0;
}

/** What a boolean operand holds, for the type-mismatch message. */
export function describeOperand(s: WpState): string {
  const drawn = s.faces.length > 0 || s.wires.length > 0;
  if (s.shape) return drawn ? 'a solid with a drawing on it' : 'a solid';
  if (s.faces.length > 0) return 'a face';
  if (s.wires.length > 0) return 'a wire';
  return 'an empty workplane';
}

/**
 * A solid and a 2D shape have no boolean in common: the operands must both be
 * solids (3D) or both faces on one workplane (2D). Say which pair was given
 * instead of guessing at one side -- `box | faces >Z | diff [rect 10 10,
 * circle 3]` reads as if the list were a source expression, but it is a fold
 * of two faces onto a bare solid, and `(rect 10 10) + (box 5 5 5)` used to
 * return the box and drop the rect.
 */
function rejectMixed(op: BoolOp, s: WpState, other: WpState): never {
  const name = BOOL_NAME[op];
  throw new Error(
    `${name}: cannot combine ${describeOperand(s)} with ${describeOperand(other)}. ` +
    `Both operands must be solids, or both faces on one workplane. ` +
    `To draw on a solid, select a face first ('box | faces >Z | rect 10 10 | ${name} (circle 3) | cut 2'); ` +
    `to combine 2D shapes as a source, write '${name} [rect 10 10, circle 3]'`,
  );
}

/** Loose boxes for the apart test: analytic extents plus the shape tolerance,
 *  so they contain the precise box, cost nothing on freeform faces, and do
 *  not move once a preview has meshed the shape (see faceCenter). */
const BBOX_LOOSE = { precise: false, useTriangulation: false } as const;

/** Two boxes closer than this are taken as meeting. Well under any modelled
 *  clearance (a print plate leaves millimetres, a mechanism tenths) and above
 *  the kernel's confusion tolerance, so a part placed exactly on another, or
 *  a hair into it, still goes through the fuse that joins them. */
const APART_GAP = 1e-6;

/**
 * Two solids whose bounding boxes do not meet share no face, edge or volume,
 * so their union is the two of them side by side -- the compound
 * BRepAlgoAPI_Fuse itself returns for disjoint operands, after a general
 * fuse that intersects every face pair. On a print plate the union of 33
 * parts spent 20s doing that (devel/perf.md 2026-10-27); here it is two bbox
 * reads. Returns null when the boxes meet, or either side holds no solid,
 * and the caller fuses as before. The result is flat (the solids of both
 * sides, not a compound of compounds), as a fuse result is.
 */
function compoundIfApart(oc: OC, a: Shape, b: Shape): Shape | null {
  if (boxesMeet(oc.getBoundingBox(a, BBOX_LOOSE), oc.getBoundingBox(b, BBOX_LOOSE))) return null;
  const sa = oc.getSubShapes(a, 'solid');
  const sb = oc.getSubShapes(b, 'solid');
  if (!sa.length || !sb.length) return null;
  return oc.makeCompound([...sa, ...sb]);
}

type BBox = ReturnType<OC['getBoundingBox']>;

/** Overlapping, or closer than APART_GAP on every axis. */
function boxesMeet(p: BBox, q: BBox): boolean {
  return !(p.xmax + APART_GAP < q.xmin || q.xmax + APART_GAP < p.xmin
    || p.ymax + APART_GAP < q.ymin || q.ymax + APART_GAP < p.ymin
    || p.zmax + APART_GAP < q.zmin || q.zmax + APART_GAP < p.zmin);
}

/**
 * Fuse two solids. BRepAlgoAPI_Fuse occasionally fails on disjoint complex
 * shapes; a compound of the two is the safety net (the parts are then
 * unfused, which `poly info` reports as solids > 1).
 */
function fuse3D(oc: OC, a: Shape, b: Shape): Shape {
  try {
    return ensureSolid(oc, oc.fuse(a, b));
  } catch (err) {
    console.warn(`fuse failed in union; falling back to compound: ${err instanceof Error ? err.message : String(err)}`);
    return oc.makeCompound([a, b]);
  }
}

/**
 * Union of three or more solids in one pass (devel/perf.md 2026-10-27,
 * proposal 4). A pairwise fold fuses the growing result against each next
 * operand, so the faces of the first are intersected again at every step;
 * BRepAlgoAPI_Fuse given all arguments at once intersects each pair of
 * faces once. On bot/toy/rubic-cube the fuses went from 68.6s to 37.1s.
 *
 * The operands are first grouped into clusters whose bounding boxes meet
 * (transitively): each cluster is one n-ary fuse, and clusters that are
 * apart are laid side by side as a compound, as compoundIfApart does for a
 * pair -- so a print plate of parts that never touch costs no fuse at all.
 * The result equals the pairwise fold's up to the seams a fuse leaves in
 * its faces, which the fold leaves too.
 *
 * Every operand holds a solid (applyBoolean checks). A drawing on `s` is
 * kept, as in applyBool.
 */
export function wpUnionAll(s: WpState, tools: WpState[]): WpState {
  const { oc } = s;
  const shapes = [s.shape as Shape, ...tools.map((t) => t.shape as Shape)];
  const results: Shape[] = [];
  for (const members of clustersByBox(oc, shapes)) {
    if (members.length === 1) { results.push(members[0]); continue; }
    let fused: Shape;
    try {
      fused = ensureSolid(oc, oc.fuseAll(members));
    } catch (err) {
      console.warn(`fuse failed in union; falling back to compound: ${err instanceof Error ? err.message : String(err)}`);
      fused = oc.makeCompound(members);
    }
    fused = pruneDebrisSolids(oc, fused);
    warnIfUnionVolumeImpossible(oc, members, fused);
    results.push(fused);
  }
  if (results.length === 1) return cloneState(s, { shape: results[0] });
  return cloneState(s, { shape: oc.makeCompound(results.flatMap((r) => oc.getSubShapes(r, 'solid'))) });
}

/** Groups of shapes connected by meeting bounding boxes, each in the
 *  order the shapes were given; the groups in the order of their first
 *  member, so the result is deterministic. */
function clustersByBox(oc: OC, shapes: Shape[]): Shape[][] {
  const boxes = shapes.map((sh) => oc.getBoundingBox(sh, BBOX_LOOSE));
  const parent = shapes.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) i = parent[i];
    return i;
  };
  for (let i = 0; i < shapes.length; i++) {
    for (let j = i + 1; j < shapes.length; j++) {
      if (boxesMeet(boxes[i], boxes[j])) parent[find(j)] = find(i);
    }
  }
  const groups = new Map<number, Shape[]>();
  shapes.forEach((sh, i) => {
    const root = find(i);
    const g = groups.get(root);
    if (g) g.push(sh); else groups.set(root, [sh]);
  });
  return [...groups.values()];
}

/** Relative slack for the volume invariants below, against the larger
 *  operand. OCCT integrates the volume of a freeform solid only to a few 1e-4
 *  (a correct union and diff in functionalprint/28-water-bird read 1.3e-4 and
 *  3.2e-4 past their bounds); the failure that prompted the check grew a diff
 *  by 2.4e-3, and an emptied inter is off by 100%. */
const BOOL_VOLUME_TOL = 1e-3;

/**
 * `check.boolean-volume`: a 3D boolean whose result breaks an inequality no
 * correct boolean can break.
 *
 *   diff   A - B   between vA - vB and vA
 *   inter  A * B   at most min(vA, vB); empty only if A and B do not overlap
 *   union  A + B   between max(vA, vB) and vA + vB
 *
 * OCCT fails some booleans silently (cones whose apexes nearly meet, issue
 * 2026-10-26): the result is a valid B-Rep that is simply wrong, so these
 * numbers are the only witness. Three volume integrations per boolean; the
 * empty-inter case adds one fuse, only when the bounding boxes overlap.
 */
function warnIfVolumeImpossible(oc: OC, op: BoolOp, a: Shape, b: Shape, r: Shape): void {
  let va: number, vb: number, vr: number;
  try {
    if (typeof oc.getVolume !== 'function') return;
    va = Math.abs(oc.getVolume(a));
    vb = Math.abs(oc.getVolume(b));
    vr = Math.abs(oc.getVolume(r));
  } catch {
    return;
  }
  if (!(va > 0) || !(vb > 0)) return;
  const tol = BOOL_VOLUME_TOL * Math.max(va, vb);
  const name = BOOL_NAME[op];
  let problem: string | null = null;
  if (op === 'cut') {
    if (vr > va + tol) problem = `grew the volume from ${fmt(va)} to ${fmt(vr)}`;
    else if (vr < va - vb - tol) problem = `removed ${fmt(va - vr)}, more than the tool's whole volume ${fmt(vb)}`;
  } else if (op === 'common') {
    if (vr > Math.min(va, vb) + tol) problem = `came out at ${fmt(vr)}, larger than the smaller operand (${fmt(Math.min(va, vb))})`;
    else if (vr <= tol && boxesOverlap(oc, a, b)) {
      let vf: number;
      try { vf = Math.abs(oc.getVolume(oc.fuse(a, b))); } catch { return; }
      if (vf < va + vb - tol) problem = `came out empty, but the operands share ${fmt(va + vb - vf)} of volume`;
    }
  } else {
    if (vr > va + vb + tol) problem = `came out at ${fmt(vr)}, more than both operands together (${fmt(va + vb)})`;
    else if (vr < Math.max(va, vb) - tol) problem = `came out at ${fmt(vr)}, smaller than the larger operand (${fmt(Math.max(va, vb))})`;
  }
  if (problem) warnBooleanVolume(name, problem);
}

/** The union invariant for n operands: between the largest and their sum.
 *  Each operand's integration error adds up, so the slack is against the
 *  sum rather than the largest. */
function warnIfUnionVolumeImpossible(oc: OC, operands: Shape[], r: Shape): void {
  let vs: number[], vr: number;
  try {
    if (typeof oc.getVolume !== 'function') return;
    vs = operands.map((o) => Math.abs(oc.getVolume(o)));
    vr = Math.abs(oc.getVolume(r));
  } catch {
    return;
  }
  if (vs.some((v) => !(v > 0))) return;
  const sum = vs.reduce((a, b) => a + b, 0);
  const max = Math.max(...vs);
  const tol = BOOL_VOLUME_TOL * sum;
  if (vr > sum + tol) warnBooleanVolume('union', `came out at ${fmt(vr)}, more than all ${vs.length} operands together (${fmt(sum)})`);
  else if (vr < max - tol) warnBooleanVolume('union', `came out at ${fmt(vr)}, smaller than the largest operand (${fmt(max)})`);
}

function warnBooleanVolume(name: string, problem: string): void {
  pushWarning(`${name}: the result ${problem} -- the kernel's boolean failed`, {
    code: 'check.boolean-volume',
    hint: 'OCCT is weak where surfaces nearly touch or a cone apex sits on the other operand -- '
      + 'trim the operands first (inter with a box or sphere around the part that matters), '
      + 'or move the tool so it clearly overlaps or clearly misses',
  });
}

function boxesOverlap(oc: OC, a: Shape, b: Shape): boolean {
  const p = oc.getBoundingBox(a), q = oc.getBoundingBox(b);
  return p.xmin < q.xmax && q.xmin < p.xmax && p.ymin < q.ymax && q.ymin < p.ymax
    && p.zmin < q.zmax && q.zmin < p.zmax;
}

function fmt(v: number): string {
  return String(Math.round(v * 100) / 100);
}

/**
 * Dispatch one boolean on operand kinds.
 *
 * solid x solid -> 3D boolean on `s.shape`. A drawing on the solid (`box |
 * faces >Z | rect 10 10 | union (cylinder 2 30)`) is kept.
 * 2D x 2D -> boolean on the faces; also when the drawing sits on a selected
 * face of a solid (`box | faces >Z | rect 10 10 | diff (circle 3) | cut 2`),
 * where `s.shape` is still the box.
 * empty x solid -> `union` adopts the solid (`workplane XZ | union (box)`).
 * Anything else mixes a solid with a 2D shape and is a type error.
 */
function applyBool(s: WpState, other: WpState, op: BoolOp): WpState {
  const { oc } = s;
  if (isBlank(other)) return s;
  if (other.shape) {
    if (s.shape) {
      let shape: Shape;
      if (op === 'fuse') {
        // No boolean ran, so there is no debris to prune and no volume
        // invariant that could have broken.
        const apart = compoundIfApart(oc, s.shape, other.shape);
        if (apart) return cloneState(s, { shape: apart });
        shape = fuse3D(oc, s.shape, other.shape);
      }
      else if (op === 'cut') shape = ensureSolid(oc, oc.cut(s.shape, other.shape));
      else shape = ensureSolid(oc, oc.common(s.shape, other.shape));
      shape = pruneDebrisSolids(oc, shape);
      warnIfVolumeImpossible(oc, op, s.shape, other.shape, shape);
      return cloneState(s, { shape });
    }
    if (op === 'fuse' && isBlank(s)) return cloneState(s, { shape: other.shape });
    return rejectMixed(op, s, other);
  }
  if (!s.shape || s.faces.length > 0 || s.wires.length > 0) return apply2DBool(s, other, op);
  return rejectMixed(op, s, other);
}

export function wpDiff(s: WpState, other: WpState): WpState {
  return applyBool(s, other, 'cut');
}

export function wpUnion(s: WpState, other: WpState): WpState {
  return applyBool(s, other, 'fuse');
}

export function wpInter(s: WpState, other: WpState): WpState {
  return applyBool(s, other, 'common');
}
