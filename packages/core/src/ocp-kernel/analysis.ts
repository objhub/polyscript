/**
 * OCP Kernel shape analysis — bounding box, volume, topology counting.
 *
 * Provides a single `shapeInfo()` function that returns a complete
 * B-Rep summary for regression testing and shape comparison.
 */

import type { OC, Shape } from './types.js';

export interface ShapeInfo {
  bbox: { min: [number, number, number]; max: [number, number, number] };
  volume: number;
  area: number;
  solids: number;
  is_valid: boolean;
  topology: { faces: number; edges: number; vertices: number };
}

/**
 * Extract B-Rep information from a shape: bounding box, volume, and topology counts.
 *
 * Uses occt-wasm's `getBoundingBox`, `getVolume`, and `getSubShapes` APIs directly.
 */
export function shapeInfo(oc: OC, shape: Shape): ShapeInfo {
  const bb = oc.getBoundingBox(shape);
  const volume = oc.getVolume(shape);
  const faces = oc.getSubShapes(shape, 'face');
  const edges = oc.getSubShapes(shape, 'edge');
  const vertices = oc.getSubShapes(shape, 'vertex');
  const solids = oc.getSubShapes(shape, 'solid');

  return {
    bbox: {
      min: [bb.xmin, bb.ymin, bb.zmin],
      max: [bb.xmax, bb.ymax, bb.zmax],
    },
    volume,
    area: oc.getSurfaceArea(shape),
    solids: solids.length,
    is_valid: oc.isValid(shape),
    topology: {
      faces: faces.length,
      edges: edges.length,
      vertices: vertices.length,
    },
  };
}

/** Centre of mass and the inertia matrix about it (row-major 3x3, symmetric).
 *  They see where material is, which the figures in ShapeInfo do not: a pocket
 *  moved across a face keeps volume, area, bbox and every count. Separate from
 *  shapeInfo because only the fingerprint and `poly diff` need them, and live
 *  calls shapeInfo after every build. */
export interface MassFacts {
  center: [number, number, number];
  inertia: number[];
}

export function massFacts(oc: OC, shape: Shape): MassFacts {
  const c = oc.getCenterOfMass(shape);
  return { center: [c.x, c.y, c.z], inertia: oc.getInertia(shape) };
}
