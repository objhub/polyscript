/**
 * Build and export models in a browser.
 *
 * Two engines behind one interface: PolyScript through the OCCT kernel, and
 * OpenSCAD through its own wasm. Both answer `build()` and `exportFile()`, so
 * a host can offer either without knowing which it has.
 *
 * OpenSCAD is not bundled. It is GPL and nine megabytes; a host that wants it
 * passes the URL of its own copy (see ScadOptions), and a host that only
 * builds PolyScript pays nothing for it.
 */
import { PolyEngine } from './poly-engine';
import { ScadEngine, type ScadOptions } from './scad-engine';
import type { EngineType, ModelEngine } from './types';

export type {
	BuildResult,
	BuildError,
	BuildOptions,
	BuildStats,
	EngineType,
	ExportFormat,
	ExportedFile,
	ModelEngine,
	ModelSummary
} from './types';
export type { ScadOptions } from './scad-engine';
export { meshSummary } from './mesh-info';
export { formatsFor, POLY_FORMATS, SCAD_FORMATS } from './formats';
export { meshDataToGLB } from './glb-export';
export { renderPreviewPng, renderGlbRgb, parseGlb, PREVIEW_BACKGROUND } from './glb-preview';
export type { GlbPreviewOptions, GlbPrimitive, GlbLines, GlbScene, RgbImage } from './glb-preview';
export { edgeLines, EDGE_TOLERANCE } from './edge-lines';
export type { EdgeLines } from './edge-lines';
export { encodePngRgb } from './png-encode';
export { meshDataToSTL } from './stl-export';
export { parseSTL } from './stl-parser';
export { parseOFF } from './off-parser';

/**
 * The engine for a model of this type.
 *
 * `scad` needs options -- there is no default URL to fall back to -- so the
 * type system asks for them only when they can be used.
 */
export function createEngine(type: 'poly'): ModelEngine;
export function createEngine(type: 'scad', options: ScadOptions): ModelEngine;
export function createEngine(type: EngineType, options?: ScadOptions): ModelEngine {
	if (type === 'poly') return new PolyEngine();
	if (!options) throw new Error('createEngine("scad") needs an openscadUrl');
	return new ScadEngine(options);
}
