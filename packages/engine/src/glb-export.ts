/**
 * Convert MeshData to the preview GLB using @gltf-transform/core.
 *
 * Supports:
 * - positions + normals + indices (basic mesh)
 * - single color (uniform material)
 * - per-vertex colors (vertex color attribute)
 * - parts with colours of their own, merged into one mesh with vertex colours
 * - empty normals (auto-computed via computeVertexNormals before calling this)
 * - CAD edges (`edgePoints`), as a second, LINES primitive in black
 *
 * This is the preview the site stores: what a card and the object page show.
 * It is not what a download gets -- those are exported afresh by the engine
 * (OCCT's own glTF for poly) -- so it can carry the edges and be shaped for
 * the viewer without that mattering to anyone else.
 */

import { Document, NodeIO, Primitive } from '@gltf-transform/core';
import type { MeshData } from './stl-parser';
import { edgeLines } from './edge-lines';

/**
 * What a mesh with no colour of its own is drawn in.
 *
 * Duplicated from ModelViewer's own default rather than imported: it lives in
 * a `.svelte` file as a literal, with nothing exported to reach it. Kept here
 * with this note so the next person who changes one knows to change the other.
 */
const DEFAULT_COLOR: [number, number, number] = [1.0, 0.92, 0.3];

/**
 * glTF accessors take arrays backed by a plain ArrayBuffer, and the type says
 * so; `MeshData` says only `Float32Array`, which since TypeScript 5.7 also
 * admits a SharedArrayBuffer. Every mesh here comes from wasm memory or from a
 * postMessage transfer, so it is always the plain kind -- but nothing in the
 * type records that, and the writer has no way to accept the wider one.
 */
function plain<T extends { buffer: ArrayBufferLike }>(a: T): T extends Float32Array
	? Float32Array<ArrayBuffer>
	: Uint32Array<ArrayBuffer> {
	return a as never;
}

/**
 * A multi-colour model's parts as one mesh with per-vertex colours.
 *
 * The kernel tessellates such a model part by part (the viewer gives each
 * part a material of its own) and leaves the top-level arrays empty; a GLB
 * with one primitive wants them joined.
 */
function mergeParts(data: MeshData): MeshData {
  const parts = data.parts ?? [];
  const nv = parts.reduce((n, p) => n + p.positions.length, 0);
  const ni = parts.reduce((n, p) => n + p.indices.length, 0);
  const positions = new Float32Array(nv);
  const normals = new Float32Array(nv);
  const colors = new Float32Array(nv);
  const indices = new Uint32Array(ni);
  let v = 0;
  let i = 0;
  for (const part of parts) {
    positions.set(part.positions, v);
    if (part.normals.length === part.positions.length) normals.set(part.normals, v);
    const base = v / 3;
    for (let k = 0; k < part.indices.length; k++) indices[i + k] = part.indices[k] + base;
    const color = part.color ?? DEFAULT_COLOR;
    for (let k = 0; k < part.positions.length; k += 3) colors.set(color, v + k);
    v += part.positions.length;
    i += part.indices.length;
  }
  return { ...data, positions, normals, colors, indices, parts: undefined };
}

export async function meshDataToGLB(input: MeshData): Promise<Uint8Array<ArrayBuffer>> {
  const data = input.parts && input.parts.length > 0 ? mergeParts(input) : input;
  const doc = new Document();
  const buffer = doc.createBuffer();

  // Positions
  const posAccessor = doc
    .createAccessor()
    .setType('VEC3')
    .setArray(plain(data.positions))
    .setBuffer(buffer);

  // Normals (may be empty for OFF-parsed data — caller should computeVertexNormals first)
  let normalAccessor;
  if (data.normals.length > 0) {
    normalAccessor = doc
      .createAccessor()
      .setType('VEC3')
      .setArray(plain(data.normals))
      .setBuffer(buffer);
  }

  // Indices
  const indexAccessor = doc
    .createAccessor()
    .setType('SCALAR')
    .setArray(plain(data.indices))
    .setBuffer(buffer);

  // Primitive
  const prim = doc
    .createPrimitive()
    .setAttribute('POSITION', posAccessor)
    .setIndices(indexAccessor);

  if (normalAccessor) {
    prim.setAttribute('NORMAL', normalAccessor);
  }

  // Material
  // glTF's default metallicFactor is 1, and a rough metal with nothing to
  // reflect is what three drew the cards' models as: a dark, nearly black
  // version of the colour. 0 is a plain lit surface in that colour, which is
  // what the author saw in the editor. oh's writer (objhub/cli/src/glb.ts)
  // and the preview renderer (glb-preview.ts) assume the same.
  const material = doc.createMaterial().setDoubleSided(false).setMetallicFactor(0);

  if (data.colors) {
    // Per-vertex colors
    const colorAccessor = doc
      .createAccessor()
      .setType('VEC3')
      .setArray(plain(data.colors))
      .setBuffer(buffer);
    prim.setAttribute('COLOR_0', colorAccessor);
    material.setBaseColorFactor([1, 1, 1, 1]); // white base, vertex colors multiply
  } else if (data.color) {
    material.setBaseColorFactor([data.color[0], data.color[1], data.color[2], 1]);
  } else {
    // The same yellow ModelViewer paints an uncoloured mesh with. The GLB
    // records what the author was looking at when they saved; a different
    // default here would ship the same model in two colours.
    material.setBaseColorFactor([...DEFAULT_COLOR, 1]);
  }

  prim.setMaterial(material);

  const mesh = doc.createMesh().addPrimitive(prim);

  // The CAD edges, as the viewer draws them over the faces: a LINES
  // primitive three loads as LineSegments, black. The preview renderer draws
  // the same lines into the PNG.
  if (data.edgePoints && data.edgePoints.length >= 6) {
    const lines = edgeLines(data.edgePoints);
    if (lines.indices.length > 0) {
      const linePositions = doc
        .createAccessor()
        .setType('VEC3')
        .setArray(lines.positions)
        .setBuffer(buffer);
      const lineIndices = doc
        .createAccessor()
        .setType('SCALAR')
        .setArray(lines.indices)
        .setBuffer(buffer);
      const lineMaterial = doc.createMaterial().setBaseColorFactor([0, 0, 0, 1]).setMetallicFactor(0);
      mesh.addPrimitive(
        doc
          .createPrimitive()
          .setMode(Primitive.Mode.LINES)
          .setAttribute('POSITION', linePositions)
          .setIndices(lineIndices)
          .setMaterial(lineMaterial)
      );
    }
  }
  const node = doc.createNode().setMesh(mesh);
  doc.createScene().addChild(node);

  const io = new NodeIO();
  // The writer allocates a fresh ArrayBuffer for its output; its signature
  // says only `Uint8Array`, which is what a fetch body will not take.
  return (await io.writeBinary(doc)) as Uint8Array<ArrayBuffer>;
}
