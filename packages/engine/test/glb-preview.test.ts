import { describe, expect, it } from 'vitest';
import { inflateSync } from 'node:zlib';
import { meshDataToGLB } from '../src/glb-export';
import { parseGlb, renderGlbRgb, renderPreviewPng, PREVIEW_BACKGROUND } from '../src/glb-preview';
import { edgeLines } from '../src/edge-lines';
import type { MeshData } from '../src/stl-parser';

/** A unit cube, 12 triangles, counter-clockwise from outside, with flat
 *  per-face normals (each face has its own four vertices). */
function cube(colorPerFace?: boolean): MeshData {
  const faces: { n: [number, number, number]; v: [number, number, number][] }[] = [
    { n: [1, 0, 0], v: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]] },
    { n: [-1, 0, 0], v: [[0, 1, 0], [0, 0, 0], [0, 0, 1], [0, 1, 1]] },
    { n: [0, 1, 0], v: [[1, 1, 0], [0, 1, 0], [0, 1, 1], [1, 1, 1]] },
    { n: [0, -1, 0], v: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] },
    { n: [0, 0, 1], v: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]] },
    { n: [0, 0, -1], v: [[0, 1, 0], [1, 1, 0], [1, 0, 0], [0, 0, 0]] },
  ];
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  faces.forEach((f, fi) => {
    const base = fi * 4;
    for (const p of f.v) {
      positions.push(...p);
      normals.push(...f.n);
      colors.push(fi === 3 ? 1 : 0.2, fi === 3 ? 0.2 : 1, 0.2);
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  });
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices: new Uint32Array(indices),
    color: colorPerFace ? undefined : [1, 0.92, 0.3],
    colors: colorPerFace ? new Float32Array(colors) : undefined,
  } as MeshData;
}

/** The cube with its 12 edges as the kernel hands them out: segment pairs. */
function cubeWithEdges(): MeshData {
  const c = cube();
  const corners = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]];
  const edges = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
  const pts: number[] = [];
  for (const [a, b] of edges) pts.push(...corners[a], ...corners[b]);
  return { ...c, edgePoints: new Float32Array(pts) };
}

/** three's sRGB transfer, then 8 bits -- what a lit pixel should encode to. */
function srgb8(v: number): number {
  const c = v <= 0.0031308 ? v * 12.92 : Math.pow(v, 0.41666) * 1.055 - 0.055;
  return Math.round(c * 255);
}

function countNear(img: { data: Uint8Array }, rgb: number[], tol = 1): number {
  let n = 0;
  for (let i = 0; i < img.data.length; i += 3) {
    if (
      Math.abs(img.data[i] - rgb[0]) <= tol &&
      Math.abs(img.data[i + 1] - rgb[1]) <= tol &&
      Math.abs(img.data[i + 2] - rgb[2]) <= tol
    ) n++;
  }
  return n;
}

describe('parseGlb', () => {
  it('reads back what meshDataToGLB wrote', async () => {
    const glb = await meshDataToGLB(cube());
    const { triangles: prims, lines } = parseGlb(glb);
    expect(prims).toHaveLength(1);
    expect(lines).toHaveLength(0);
    const p = prims[0];
    expect(p.positions).toHaveLength(24 * 3);
    expect(p.normals).toHaveLength(24 * 3);
    expect(p.indices).toHaveLength(36);
    expect(p.colors).toBeNull();
    expect(p.baseColor.map((c) => +c.toFixed(3))).toEqual([1, 0.92, 0.3]);
    // Not glTF's default of 1: the writer sets it so the viewers do not draw
    // the model as dark metal.
    expect(p.metalness).toBe(0);
    expect(p.doubleSided).toBe(false);
  });

  it('reads per-vertex colours', async () => {
    const prims = parseGlb(await meshDataToGLB(cube(true))).triangles;
    expect(prims[0].colors).toHaveLength(24 * 3);
    expect(prims[0].baseColor).toEqual([1, 1, 1]);
  });

  it('merges coloured parts into one mesh with vertex colours', async () => {
    const whole = cube();
    const data: MeshData = {
      positions: new Float32Array(0),
      normals: new Float32Array(0),
      indices: new Uint32Array(0),
      parts: [
        { positions: whole.positions, normals: whole.normals, indices: whole.indices, color: [1, 0, 0] },
        {
          positions: whole.positions.map((v, i) => (i % 3 === 0 ? v + 2 : v)),
          normals: whole.normals,
          indices: whole.indices,
          color: [0, 0, 1]
        }
      ]
    } as MeshData;
    const p = parseGlb(await meshDataToGLB(data)).triangles[0];
    expect(p.positions).toHaveLength(48 * 3);
    expect(p.indices).toHaveLength(72);
    expect(Math.max(...p.indices)).toBe(47);
    expect(Array.from(p.colors!.subarray(0, 3))).toEqual([1, 0, 0]);
    expect(Array.from(p.colors!.subarray(24 * 3, 24 * 3 + 3))).toEqual([0, 0, 1]);
  });

  it('carries the CAD edges as a black LINES primitive', async () => {
    const glb = await meshDataToGLB(cubeWithEdges());
    const { triangles, lines } = parseGlb(glb);
    expect(triangles).toHaveLength(1);
    expect(lines).toHaveLength(1);
    expect(lines[0].color).toEqual([0, 0, 0]);
    // 12 edges of a cube, two indices each, over its 8 corners.
    expect(lines[0].indices).toHaveLength(24);
    expect(lines[0].positions).toHaveLength(8 * 3);
  });

  it('rejects what is not a GLB', () => {
    expect(() => parseGlb(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]))).toThrow(/not a GLB/);
  });
});

describe('renderGlbRgb', () => {
  it('frames the model on the card background at the requested size', async () => {
    const img = renderGlbRgb(await meshDataToGLB(cube()), { width: 200, height: 150 });
    expect(img.width).toBe(200);
    expect(img.height).toBe(150);
    expect(img.data).toHaveLength(200 * 150 * 3);
    const bg = countNear(img, PREVIEW_BACKGROUND, 0);
    // The camera sits 1.9 extents away with a 50 degree fov: the model takes
    // well under half the frame, as it does in the viewer.
    expect(bg).toBeGreaterThan(200 * 150 * 0.5);
    expect(bg).toBeLessThan(200 * 150 * 0.95);
    // Corners are empty, the centre is not.
    expect(Array.from(img.data.subarray(0, 3))).toEqual(PREVIEW_BACKGROUND);
    const c = (75 * 200 + 100) * 3;
    expect(Array.from(img.data.subarray(c, c + 3))).not.toEqual(PREVIEW_BACKGROUND);
  });

  it('lights faces as three lights a MeshStandardMaterial', async () => {
    const img = renderGlbRgb(await meshDataToGLB(cube()), { width: 400, height: 300, supersample: 1 });
    // The camera at (1.2, -1.2, 0.8) sees the +x, -y and +z faces. The light
    // comes from (1, 1, 1), so the -y face gets no direct light at all: its
    // colour is the ambient term alone, 0.6 * colour / pi, with no specular.
    const ambientOnly = [1, 0.92, 0.3].map((c) => srgb8((0.6 * c) / Math.PI));
    const n = countNear(img, ambientOnly);
    expect(n).toBeGreaterThan(400 * 300 * 0.02);
    // The +x and +z faces are lit (n.l = 0.577) and so brighter on every channel.
    let brighter = 0;
    for (let i = 0; i < img.data.length; i += 3) {
      if (img.data[i] > ambientOnly[0] + 20 && img.data[i + 2] > ambientOnly[2] + 5) brighter++;
    }
    expect(brighter).toBeGreaterThan(n);
  });

  it('multiplies per-vertex colours into the base colour', async () => {
    const img = renderGlbRgb(await meshDataToGLB(cube(true)), { width: 400, height: 300, supersample: 1 });
    // Face 3 is the -y face, painted (1, 0.2, 0.2) and in shadow: ambient only.
    const red = [1, 0.2, 0.2].map((c) => srgb8((0.6 * c) / Math.PI));
    expect(countNear(img, red)).toBeGreaterThan(400 * 300 * 0.02);
    // No face is the mesh's default yellow.
    const yellowAmbient = [1, 0.92, 0.3].map((c) => srgb8((0.6 * c) / Math.PI));
    expect(countNear(img, yellowAmbient)).toBe(0);
  });

  it('draws nothing but the background for an empty GLB', async () => {
    const empty: MeshData = {
      positions: new Float32Array(0),
      normals: new Float32Array(0),
      indices: new Uint32Array(0),
    } as MeshData;
    const img = renderGlbRgb(await meshDataToGLB(empty), { width: 20, height: 10 });
    expect(countNear(img, PREVIEW_BACKGROUND, 0)).toBe(200);
  });
});

describe('edgeLines', () => {
  it('joins segments into polylines and drops the points that do not bend them', () => {
    // A quarter circle sampled at 1 degree, then a straight run: the arc
    // keeps a handful of points, the straight run keeps only its ends.
    const pts: number[] = [];
    const arc: number[][] = [];
    for (let d = 0; d <= 90; d++) arc.push([Math.cos((d * Math.PI) / 180) * 10, Math.sin((d * Math.PI) / 180) * 10, 0]);
    for (let i = 0; i + 1 < arc.length; i++) pts.push(...arc[i], ...arc[i + 1]);
    for (let i = 0; i < 10; i++) pts.push(0, 10 + i, 0, 0, 11 + i, 0);
    const lines = edgeLines(new Float32Array(pts));
    const segments = lines.indices.length / 2;
    expect(segments).toBeLessThan(30);
    expect(segments).toBeGreaterThan(4);
    // Shared endpoints: fewer vertices than segment ends.
    expect(lines.positions.length / 3).toBe(segments + 1);
    // The ends survive exactly.
    const xs = Array.from({ length: lines.positions.length / 3 }, (_, i) => Array.from(lines.positions.subarray(i * 3, i * 3 + 3)));
    expect(xs).toContainEqual([10, 0, 0]);
    expect(xs).toContainEqual([0, 20, 0]);
  });

  it('keeps every point at tolerance 0', () => {
    const pts = [0, 0, 0, 1, 0.1, 0, 1, 0.1, 0, 2, 0, 0];
    const lines = edgeLines(new Float32Array(pts), 0);
    expect(lines.indices.length / 2).toBe(2);
    expect(lines.positions.length / 3).toBe(3);
  });

  it('keeps a closed loop as a loop', () => {
    const sq = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]];
    const pts: number[] = [];
    for (let i = 0; i < 4; i++) pts.push(...sq[i], ...sq[(i + 1) % 4]);
    const lines = edgeLines(new Float32Array(pts));
    expect(lines.indices.length / 2).toBe(4);
    expect(lines.positions.length / 3).toBe(4);
  });
});

describe('renderGlbRgb with edges', () => {
  it('draws the visible edges in black and hides the rest', async () => {
    const withEdges = renderGlbRgb(await meshDataToGLB(cubeWithEdges()), { width: 400, height: 300 });
    const without = renderGlbRgb(await meshDataToGLB(cube()), { width: 400, height: 300 });
    let black = 0;
    let changed = 0;
    for (let i = 0; i < withEdges.data.length; i += 3) {
      if (withEdges.data[i] < 40 && withEdges.data[i + 1] < 40 && withEdges.data[i + 2] < 40) black++;
      if (withEdges.data[i] !== without.data[i]) changed++;
    }
    // Nine edges are visible from the iso view, each a few hundred pixels
    // long at one pixel wide; the three hidden ones add nothing.
    expect(black).toBeGreaterThan(400);
    expect(black).toBeLessThan(400 * 300 * 0.03);
    // Only the lines differ: the faces and the background are untouched.
    // Supersampling greys the pixels a line half covers, so more pixels
    // change than are black, but not many more.
    expect(changed).toBeGreaterThan(black);
    expect(changed).toBeLessThan(black * 4);
  });
});

describe('renderPreviewPng', () => {
  it('writes a PNG of the render', async () => {
    const glb = await meshDataToGLB(cube());
    const png = await renderPreviewPng(glb, { width: 64, height: 48 });
    expect(Array.from(png.subarray(0, 8))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const dv = new DataView(png.buffer, png.byteOffset, png.byteLength);
    expect(new TextDecoder().decode(png.subarray(12, 16))).toBe('IHDR');
    expect(dv.getUint32(16)).toBe(64);
    expect(dv.getUint32(20)).toBe(48);
    expect(png[24]).toBe(8); // bit depth
    expect(png[25]).toBe(2); // RGB

    // Walk the chunks, inflate the IDAT, and check the rows against the raw render.
    let off = 8;
    let idat = new Uint8Array(0);
    let sawEnd = false;
    while (off < png.length) {
      const len = dv.getUint32(off);
      const type = new TextDecoder().decode(png.subarray(off + 4, off + 8));
      if (type === 'IDAT') idat = png.subarray(off + 8, off + 8 + len);
      if (type === 'IEND') sawEnd = true;
      off += 12 + len;
    }
    expect(sawEnd).toBe(true);
    const raw = inflateSync(idat);
    expect(raw.length).toBe((64 * 3 + 1) * 48);
    const img = renderGlbRgb(glb, { width: 64, height: 48 });
    for (let y = 0; y < 48; y++) {
      expect(raw[y * (64 * 3 + 1)]).toBe(0); // filter: none
      expect(Buffer.from(raw.subarray(y * 193 + 1, (y + 1) * 193))).toEqual(
        Buffer.from(img.data.subarray(y * 192, (y + 1) * 192))
      );
    }
  });
});
