/**
 * OcctKernel for PolyScript — wraps occt-wasm module.
 *
 * Provides a Workplane-like immutable context that mirrors the Python
 * ocp_kernel.py implementation. Each operation returns a new context.
 *
 * This barrel module re-exports all sub-modules so that external imports
 * from './ocp-kernel.js' continue to work unchanged.
 */

// Types
export type { OC, Shape, Wire, Face, Edge, Vertex, Pnt, Dir, Vec, Pln, Ax1, Ax2, Ax3 } from './types.js';
export type { BoundingBox, WpState } from './types.js';
export { cloneState, mergeColorMaps } from './types.js';

// Initialization
export { initOC, setOC } from './init.js';

// Geometry helpers
export {
  makePnt, makeDir, makeVec, makePlane,
  planeOrigin, planeNormal, planeXDir, planeYDir, to3d,
  getFaces, getEdges, getVertices, ensureSolid,
  faceCenter, faceNormal, edgeCenter, edgeDirection, vertexPoint,
  axisComponent, vecComponent,
  alignZToDir,
} from './geometry.js';

// Shape analysis
export type { ShapeInfo, MassFacts } from './analysis.js';
export { shapeInfo, massFacts } from './analysis.js';

// Selector engine
export { selectItems } from './selector.js';

// Wire/Face builders and transform helpers
export {
  makeWireFromPoints, makeFaceFromWire, makeRectWire, makeCircleWire, makeEllipseWire,
  makeLineWire, makeArcWire, makeCenterArcWire, makeTangentArcWire, makeBezierWire,
  makeHelixWire, computeArcAngles, computeCenterArcMidpoint, computeCenterFromRadius,
  translateShape, rotateShape, scaleShapeUniform, scaleShapeNonUniform,
} from './builders.js';

// Workplane factory, bounding box, offsets
export { boundingBox, createWorkplane, getOffsets } from './workplane.js';

// 3D Primitives
export { wpBox, wpCylinder, wpSphere, wpCone, wpTorus, wpWedge, wpThread, type Center3 } from './primitives-3d.js';

// 2D Primitives
export { wpRect, wpCircle, wpEllipse, wpPolygon, wpText, type Center2 } from './primitives-2d.js';

// Text rendering
export { textToWires, textToFaces, setTextFont, resetFontCache, textFontPath, fontFromCollection } from './text-render.js';

// Selection
export { wpFaces, wpEdges, wpVertices, wpWorkplane, wpTag } from './selection.js';

// Modifiers
export { wpFillet, wpChamfer, wpShell, wpOffset } from './modifiers.js';

// Boolean operations
export { wpDiff, wpUnion, wpInter } from './boolean.js';

// Extrusion operations
export { wpExtrude, wpRevolve, wpSweep, wpLoft, wpCutThruAll, wpCutBlind, wpHole, wpFaceHole } from './extrusion.js';

// Transform operations
export { wpTranslate, wpRotate, wpScale, wpMove, wpMoveTo, wpMirror, wpPushPoints, wpSpline } from './transform.js';

// Export operations
export {
  exportSTL, exportSTEP, exportShape,
  exportSTLString, exportSTLBuffer, exportSTEPString,
  exportBREPString, importBREP,
  exportGLTFBuffer, exportGLTF,
  exportSVG, exportSVGString, SVG_VIEWS,
  exportPNG, exportPNGBuffer,
  tessellate,
  edgeSegments,
} from './export.js';
export type {
  TessellationMesh, ExportOptions, ExportShapeOptions, SvgExportOptions, PngExportOptions,
  TessellateOptions,
} from './export.js';

// Cross sections (measurements, not pictures)
export { sectionShape, sectionSVG, formatSectionReport, parseSectionSpecs } from './section.js';
export type { SectionAxis, SectionSpec, SectionLoop, SectionResult, SectionOptions } from './section.js';

// Color parts (per-part colors that survive the pipeline)
export { colorParts, hasDistinctColors } from './color-parts.js';
export type { ColorPart, RGB } from './color-parts.js';
export { memoizeKernel, MEMOIZED } from './memo.js';
export type { KernelMemo, KernelMemoStats, KernelMemoOptions } from './memo.js';
