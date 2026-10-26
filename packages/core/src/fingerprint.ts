/**
 * A short digest of the built shape — "did my edit change the geometry?"
 *
 * Editing a model is otherwise blind: renaming a variable, extracting a
 * `@param`, reordering two independent branches are all meant to leave the
 * shape untouched, and nothing in a build report says whether they did. The
 * fingerprint makes that one comparison, and `poly diff` shows what moved when
 * it changed.
 *
 * It is a digest of the B-Rep facts, not of the exported mesh: same volume,
 * area, bounding box, solid count, topology counts, centre of mass and inertia
 * matrix means the same fingerprint. The last two are what notice a feature
 * that moved without changing size (a pocket slid across a face); without them
 * that edit read as identical. What it still cannot see: a change that keeps
 * the mass distribution too (a rotation about an axis of symmetry, two equal
 * features swapping places). Treat a changed fingerprint as proof of a change
 * and an unchanged one as strong evidence of none.
 *
 * Figures are rounded to FINGERPRINT_PRECISION significant digits before
 * hashing; the centre and the inertia, whose components are often zero give
 * or take noise, to that many digits of the part's size and largest moment. Below that, OCCT's own numbers move between kernel patch versions
 * and CPU architectures (devel/lang-vision202609.md section 7), which would
 * turn the digest into noise.
 */

import type { MassFacts, ShapeInfo } from './ocp-kernel/analysis.js';

/** `mass` is optional so facts without a kernel at hand (tests, a stored
 *  report) still hash; a fingerprint with it never equals one without. */
export type ShapeFacts = ShapeInfo & { mass?: MassFacts };

export const FINGERPRINT_PRECISION = 7;

/** Canonical text form — also what `poly diff` compares field by field. */
function canonical(facts: ShapeFacts): string {
  const n = (v: number) => {
    const r = Number(v.toPrecision(FINGERPRINT_PRECISION));
    return String(r === 0 ? 0 : r);
  };
  return [
    `v=${n(facts.volume)}`,
    `a=${n(facts.area)}`,
    `bb=${facts.bbox.min.map(n).join(',')}/${facts.bbox.max.map(n).join(',')}`,
    `s=${facts.solids}`,
    `f=${facts.topology.faces}`,
    `e=${facts.topology.edges}`,
    `x=${facts.topology.vertices}`,
    ...(facts.mass ? massFields(facts.mass, facts.bbox) : []),
  ].join('|');
}

/** Relative to a scale, rounded to FINGERPRINT_PRECISION decimals: a
 *  component that is zero up to kernel noise (1e-12 one run, -3e-13 the next)
 *  comes out 0 both times, which toPrecision would not give. */
function relative(v: number, scale: number): string {
  const q = 10 ** FINGERPRINT_PRECISION;
  const r = scale > 0 ? Math.round((v / scale) * q) : 0;
  return String(r === 0 ? 0 : r);
}

function massFields(mass: MassFacts, bbox: ShapeFacts['bbox']): string[] {
  const size = Math.max(...bbox.max.map((v, i) => v - bbox.min[i]));
  const [ixx, ixy, ixz, , iyy, iyz, , , izz] = mass.inertia;
  const moment = Math.max(Math.abs(ixx), Math.abs(iyy), Math.abs(izz));
  return [
    `c=${mass.center.map(v => relative(v, size)).join(',')}`,
    `i=${[ixx, iyy, izz, ixy, ixz, iyz].map(v => relative(v, moment)).join(',')}`,
  ];
}

/**
 * 12 hex characters. FNV-1a twice with different offsets rather than a real
 * hash: core runs in the browser too, where node:crypto is absent and
 * SubtleCrypto is async, and nothing here needs to resist an adversary.
 */
export function fingerprint(facts: ShapeFacts): string {
  const text = canonical(facts);
  const mix = (offset: number): number => {
    let h = offset;
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      // h * 16777619, kept in 32 bits without losing the high bits to the
      // double's mantissa.
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
  };
  const a = mix(0x811c9dc5);
  const b = mix(0x7ee3c9f1);
  return (a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0')).slice(0, 12);
}
