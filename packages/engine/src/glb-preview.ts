/**
 * The preview picture of a GLB, drawn without a GPU.
 *
 * objhub shows every object's preview two ways: a PNG on its card, and the
 * preview GLB itself in a three.js viewer when the card is hovered or the
 * object is opened. The two have to look alike or the model appears to
 * change under the pointer. So this draws the PNG from the GLB bytes that
 * are uploaded, with the viewer's own framing, lights and material model, in
 * plain TypeScript: the browser editor calls it when saving and the `oh`
 * command calls it under Bun, where there is no WebGL.
 *
 * What it reproduces (see objhub's MiniViewer and three's
 * MeshStandardMaterial): a perspective camera with a 50 degree vertical fov
 * at 1.2, -1.2, 0.8 times the model's largest extent from its centre, Z up;
 * an ambient light of 0.6 and a directional light of 0.8 from (1, 1, 1); the
 * glTF metallic-roughness BRDF three draws with -- Lambert diffuse, GGX
 * specular with its multi-scattering compensation from three's own DFG
 * table -- and sRGB output. The background is the card's #f7fafc. A LINES
 * primitive (the CAD edges a preview GLB carries) is drawn over the faces
 * in its material's colour, one pixel wide, hidden where a face is nearer.
 *
 * What it leaves out: environment lighting (the viewers have none), normal
 * maps and textures (the GLBs objhub writes carry none), the roughness
 * fudge three adds from screen-space normal derivatives (invisible at
 * card size). Edges are antialiased by supersampling, as the viewers'
 * MSAA does.
 */

import { DFG_LUT, DFG_LUT_SIZE } from './dfg-lut.js';
import { encodePngRgb } from './png-encode.js';

export interface GlbPreviewOptions {
  /** Output size in pixels. The card is 4:3; the default is what the editor
   *  has always uploaded. */
  width?: number;
  height?: number;
  /** Render this many times larger on each axis and average down (default 2). */
  supersample?: number;
}

/** The card's background, which the viewers clear to as well. */
export const PREVIEW_BACKGROUND: [number, number, number] = [0xf7, 0xfa, 0xfc];

// --- GLB -------------------------------------------------------------------

/** One triangle primitive, with its node transform already applied. */
export interface GlbPrimitive {
  positions: Float32Array;
  /** Per-vertex unit normals, or null to shade flat as three does without them. */
  normals: Float32Array | null;
  /** Per-vertex linear RGB, or null. */
  colors: Float32Array | null;
  indices: Uint32Array;
  /** Linear RGB. */
  baseColor: [number, number, number];
  metalness: number;
  roughness: number;
  doubleSided: boolean;
}

/** One LINES primitive, with its node transform already applied. */
export interface GlbLines {
  positions: Float32Array;
  /** Pairs of vertex indices. */
  indices: Uint32Array;
  /** Linear RGB. */
  color: [number, number, number];
}

export interface GlbScene {
  triangles: GlbPrimitive[];
  lines: GlbLines[];
}

interface GltfAccessor {
  bufferView?: number;
  byteOffset?: number;
  componentType: number;
  normalized?: boolean;
  count: number;
  type: string;
}

interface GltfJson {
  scene?: number;
  scenes?: { nodes?: number[] }[];
  nodes?: {
    mesh?: number;
    children?: number[];
    matrix?: number[];
    translation?: number[];
    rotation?: number[];
    scale?: number[];
  }[];
  meshes?: { primitives: { attributes: Record<string, number>; indices?: number; material?: number; mode?: number }[] }[];
  materials?: {
    pbrMetallicRoughness?: { baseColorFactor?: number[]; metallicFactor?: number; roughnessFactor?: number };
    doubleSided?: boolean;
  }[];
  accessors?: GltfAccessor[];
  bufferViews?: { buffer: number; byteOffset?: number; byteLength: number; byteStride?: number }[];
}

const TYPE_SIZE: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

const COMPONENT_BYTES: Record<number, number> = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };

function readComponent(dv: DataView, off: number, componentType: number, normalized: boolean): number {
  switch (componentType) {
    case 5126:
      return dv.getFloat32(off, true);
    case 5125:
      return dv.getUint32(off, true);
    case 5123:
      return normalized ? dv.getUint16(off, true) / 65535 : dv.getUint16(off, true);
    case 5121:
      return normalized ? dv.getUint8(off) / 255 : dv.getUint8(off);
    case 5122:
      return normalized ? Math.max(dv.getInt16(off, true) / 32767, -1) : dv.getInt16(off, true);
    case 5120:
      return normalized ? Math.max(dv.getInt8(off) / 127, -1) : dv.getInt8(off);
    default:
      throw new Error(`GLB: unsupported component type ${componentType}`);
  }
}

/** Every component of an accessor, in order, as numbers. Reads through a
 *  DataView rather than a typed-array view so byte strides and alignment
 *  are no concern. */
function readAccessor(json: GltfJson, bin: Uint8Array, index: number, want: number): Float32Array {
  const acc = json.accessors?.[index];
  if (!acc) throw new Error(`GLB: no accessor ${index}`);
  const comps = TYPE_SIZE[acc.type];
  if (!comps) throw new Error(`GLB: unsupported accessor type ${acc.type}`);
  const out = new Float32Array(acc.count * want);
  if (acc.bufferView === undefined) return out; // all zeros, per spec
  const view = json.bufferViews?.[acc.bufferView];
  if (!view) throw new Error(`GLB: no bufferView ${acc.bufferView}`);
  const elem = COMPONENT_BYTES[acc.componentType];
  if (!elem) throw new Error(`GLB: unsupported component type ${acc.componentType}`);
  const stride = view.byteStride ?? comps * elem;
  const base = (view.byteOffset ?? 0) + (acc.byteOffset ?? 0);
  if (base + (acc.count - 1) * stride + comps * elem > view.byteLength + (view.byteOffset ?? 0)) {
    throw new Error('GLB: accessor runs past its buffer view');
  }
  const dv = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  const n = Math.min(comps, want);
  for (let i = 0; i < acc.count; i++) {
    const off = base + i * stride;
    for (let c = 0; c < n; c++) {
      out[i * want + c] = readComponent(dv, off + c * elem, acc.componentType, acc.normalized ?? false);
    }
  }
  return out;
}

type Mat4 = Float64Array; // column-major, as glTF

function mat4Identity(): Mat4 {
  const m = new Float64Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
}

function mat4Multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Float64Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
      out[c * 4 + r] = s;
    }
  }
  return out;
}

function nodeMatrix(node: NonNullable<GltfJson['nodes']>[number]): Mat4 {
  if (node.matrix && node.matrix.length === 16) return Float64Array.from(node.matrix);
  const t = node.translation ?? [0, 0, 0];
  const q = node.rotation ?? [0, 0, 0, 1];
  const s = node.scale ?? [1, 1, 1];
  const [x, y, z, w] = q;
  const m = new Float64Array(16);
  m[0] = (1 - 2 * (y * y + z * z)) * s[0];
  m[1] = 2 * (x * y + z * w) * s[0];
  m[2] = 2 * (x * z - y * w) * s[0];
  m[4] = 2 * (x * y - z * w) * s[1];
  m[5] = (1 - 2 * (x * x + z * z)) * s[1];
  m[6] = 2 * (y * z + x * w) * s[1];
  m[8] = 2 * (x * z + y * w) * s[2];
  m[9] = 2 * (y * z - x * w) * s[2];
  m[10] = (1 - 2 * (x * x + y * y)) * s[2];
  m[12] = t[0];
  m[13] = t[1];
  m[14] = t[2];
  m[15] = 1;
  return m;
}

/** The inverse transpose of a matrix's upper 3x3, for normals. */
function normalMatrix(m: Mat4): Float64Array {
  const a = m[0], b = m[4], c = m[8];
  const d = m[1], e = m[5], f = m[9];
  const g = m[2], h = m[6], i = m[10];
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  const inv = det === 0 ? 1 : 1 / det;
  // Inverse (adjugate / det), then transpose: entries land as the cofactors.
  const out = new Float64Array(9);
  out[0] = A * inv; out[3] = B * inv; out[6] = C * inv;
  out[1] = -(b * i - c * h) * inv; out[4] = (a * i - c * g) * inv; out[7] = -(a * h - b * g) * inv;
  out[2] = (b * f - c * e) * inv; out[5] = -(a * f - c * d) * inv; out[8] = (a * e - b * d) * inv;
  return out;
}

const GLB_MAGIC = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

/** The triangles and lines of a GLB in scene space, with their materials.
 *  Other primitive modes (points, strips, fans) are skipped. */
export function parseGlb(bytes: Uint8Array): GlbScene {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 12 || dv.getUint32(0, true) !== GLB_MAGIC) throw new Error('not a GLB file');
  if (dv.getUint32(4, true) !== 2) throw new Error(`GLB version ${dv.getUint32(4, true)} is not 2`);
  let json: GltfJson | null = null;
  let bin: Uint8Array | null = null;
  for (let off = 12; off + 8 <= bytes.byteLength; ) {
    const len = dv.getUint32(off, true);
    const type = dv.getUint32(off + 4, true);
    off += 8;
    if (off + len > bytes.byteLength) throw new Error('GLB: chunk runs past the file');
    const data = bytes.subarray(off, off + len);
    if (type === CHUNK_JSON) json = JSON.parse(new TextDecoder().decode(data)) as GltfJson;
    else if (type === CHUNK_BIN && !bin) bin = data;
    off += len;
  }
  if (!json) throw new Error('GLB: no JSON chunk');
  const binData = bin ?? new Uint8Array(0);

  const out: GlbScene = { triangles: [], lines: [] };
  const nodes = json.nodes ?? [];
  const visit = (index: number, parent: Mat4, depth: number) => {
    const node = nodes[index];
    if (!node || depth > 64) return;
    const world = mat4Multiply(parent, nodeMatrix(node));
    if (node.mesh !== undefined) {
      const mesh = json.meshes?.[node.mesh];
      for (const prim of mesh?.primitives ?? []) {
        const mode = prim.mode ?? 4;
        if (mode === 4) {
          const p = primitive(json, binData, prim, world);
          if (p) out.triangles.push(p);
        } else if (mode === 1) {
          const l = linePrimitive(json, binData, prim, world);
          if (l) out.lines.push(l);
        }
      }
    }
    for (const child of node.children ?? []) visit(child, world, depth + 1);
  };
  const scene = json.scenes?.[json.scene ?? 0];
  const roots = scene?.nodes ?? nodes.map((_, i) => i);
  for (const r of roots) visit(r, mat4Identity(), 0);
  return out;
}

function primitive(
  json: GltfJson,
  bin: Uint8Array,
  prim: NonNullable<GltfJson['meshes']>[number]['primitives'][number],
  world: Mat4
): GlbPrimitive | null {
  const posIndex = prim.attributes.POSITION;
  if (posIndex === undefined) return null;
  const local = readAccessor(json, bin, posIndex, 3);
  const count = local.length / 3;
  if (count === 0) return null;

  const positions = new Float32Array(local.length);
  for (let i = 0; i < count; i++) {
    const x = local[i * 3], y = local[i * 3 + 1], z = local[i * 3 + 2];
    positions[i * 3] = world[0] * x + world[4] * y + world[8] * z + world[12];
    positions[i * 3 + 1] = world[1] * x + world[5] * y + world[9] * z + world[13];
    positions[i * 3 + 2] = world[2] * x + world[6] * y + world[10] * z + world[14];
  }

  let normals: Float32Array | null = null;
  if (prim.attributes.NORMAL !== undefined) {
    const nm = normalMatrix(world);
    const ln = readAccessor(json, bin, prim.attributes.NORMAL, 3);
    normals = new Float32Array(ln.length);
    for (let i = 0; i < count; i++) {
      const x = ln[i * 3], y = ln[i * 3 + 1], z = ln[i * 3 + 2];
      const nx = nm[0] * x + nm[3] * y + nm[6] * z;
      const ny = nm[1] * x + nm[4] * y + nm[7] * z;
      const nz = nm[2] * x + nm[5] * y + nm[8] * z;
      const l = Math.hypot(nx, ny, nz) || 1;
      normals[i * 3] = nx / l;
      normals[i * 3 + 1] = ny / l;
      normals[i * 3 + 2] = nz / l;
    }
  }

  const colors = prim.attributes.COLOR_0 !== undefined ? readAccessor(json, bin, prim.attributes.COLOR_0, 3) : null;

  let indices: Uint32Array;
  if (prim.indices !== undefined) {
    indices = Uint32Array.from(readAccessor(json, bin, prim.indices, 1));
  } else {
    indices = new Uint32Array(count);
    for (let i = 0; i < count; i++) indices[i] = i;
  }
  for (let i = 0; i < indices.length; i++) {
    if (indices[i] >= count) throw new Error('GLB: index out of range');
  }

  const mat = prim.material !== undefined ? json.materials?.[prim.material] : undefined;
  const pbr = mat?.pbrMetallicRoughness;
  const bc = pbr?.baseColorFactor ?? [1, 1, 1, 1];
  // A mirrored transform turns the winding inside out; three flips the
  // front face for it, and so does the rasteriser below via this sign.
  const det =
    world[0] * (world[5] * world[10] - world[6] * world[9]) -
    world[4] * (world[1] * world[10] - world[2] * world[9]) +
    world[8] * (world[1] * world[6] - world[2] * world[5]);
  if (det < 0) {
    for (let i = 0; i + 2 < indices.length; i += 3) {
      const t = indices[i + 1];
      indices[i + 1] = indices[i + 2];
      indices[i + 2] = t;
    }
  }
  return {
    positions,
    normals,
    colors,
    indices,
    baseColor: [bc[0], bc[1], bc[2]],
    // glTF's defaults. Both of objhub's writers set metallicFactor to 0
    // explicitly; a GLB from elsewhere that leaves it at 1 is drawn as the
    // dark metal three makes of it, as the viewers would.
    metalness: pbr?.metallicFactor ?? 1,
    roughness: pbr?.roughnessFactor ?? 1,
    doubleSided: mat?.doubleSided ?? false
  };
}

function linePrimitive(
  json: GltfJson,
  bin: Uint8Array,
  prim: NonNullable<GltfJson['meshes']>[number]['primitives'][number],
  world: Mat4
): GlbLines | null {
  const posIndex = prim.attributes.POSITION;
  if (posIndex === undefined) return null;
  const local = readAccessor(json, bin, posIndex, 3);
  const count = local.length / 3;
  if (count === 0) return null;
  const positions = new Float32Array(local.length);
  for (let i = 0; i < count; i++) {
    const x = local[i * 3], y = local[i * 3 + 1], z = local[i * 3 + 2];
    positions[i * 3] = world[0] * x + world[4] * y + world[8] * z + world[12];
    positions[i * 3 + 1] = world[1] * x + world[5] * y + world[9] * z + world[13];
    positions[i * 3 + 2] = world[2] * x + world[6] * y + world[10] * z + world[14];
  }
  let indices: Uint32Array;
  if (prim.indices !== undefined) {
    indices = Uint32Array.from(readAccessor(json, bin, prim.indices, 1));
  } else {
    indices = new Uint32Array(count);
    for (let i = 0; i < count; i++) indices[i] = i;
  }
  for (let i = 0; i < indices.length; i++) {
    if (indices[i] >= count) throw new Error('GLB: index out of range');
  }
  const mat = prim.material !== undefined ? json.materials?.[prim.material] : undefined;
  const bc = mat?.pbrMetallicRoughness?.baseColorFactor ?? [1, 1, 1, 1];
  return { positions, indices, color: [bc[0], bc[1], bc[2]] };
}

// --- shading ---------------------------------------------------------------

const PI = Math.PI;
const RECIPROCAL_PI = 1 / Math.PI;
const EPSILON = 1e-6;

const AMBIENT = 0.6;
const DIRECTIONAL = 0.8;
const LIGHT_DIR = (() => {
  const l = Math.sqrt(3);
  return [1 / l, 1 / l, 1 / l];
})();

function halfToFloat(h: number): number {
  const s = h & 0x8000 ? -1 : 1;
  const e = (h >> 10) & 0x1f;
  const f = h & 0x3ff;
  if (e === 0) return s * Math.pow(2, -14) * (f / 1024);
  if (e === 31) return f ? NaN : s * Infinity;
  return s * Math.pow(2, e - 15) * (1 + f / 1024);
}

const DFG = (() => {
  const t = new Float32Array(DFG_LUT.length);
  for (let i = 0; i < DFG_LUT.length; i++) t[i] = halfToFloat(DFG_LUT[i]);
  return t;
})();

/** texture2D(dfgLUT, vec2(roughness, dotNV)).rg with linear filtering and
 *  clamp-to-edge, as the GPU samples three's 16x16 table. */
function sampleDfg(roughness: number, dotNV: number, out: Float64Array): void {
  const n = DFG_LUT_SIZE;
  const u = Math.min(Math.max(roughness * n - 0.5, 0), n - 1);
  const v = Math.min(Math.max(dotNV * n - 0.5, 0), n - 1);
  const x0 = Math.floor(u), y0 = Math.floor(v);
  const x1 = Math.min(x0 + 1, n - 1), y1 = Math.min(y0 + 1, n - 1);
  const fx = u - x0, fy = v - y0;
  const i00 = (y0 * n + x0) * 2, i10 = (y0 * n + x1) * 2, i01 = (y1 * n + x0) * 2, i11 = (y1 * n + x1) * 2;
  const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;
  out[0] = DFG[i00] * w00 + DFG[i10] * w10 + DFG[i01] * w01 + DFG[i11] * w11;
  out[1] = DFG[i00 + 1] * w00 + DFG[i10 + 1] * w10 + DFG[i01 + 1] * w01 + DFG[i11 + 1] * w11;
}

function srgbEncode(v: number): number {
  // three's sRGBTransferOETF, then 8 bits.
  const c = v <= 0.0031308 ? v * 12.92 : Math.pow(v, 0.41666) * 1.055 - 0.055;
  return Math.max(0, Math.min(255, Math.round(c * 255)));
}

interface Shader {
  /** Writes the sRGB-encoded 8-bit colour of one fragment into `rgb`. */
  shade(px: number, py: number, pz: number, nx: number, ny: number, nz: number, r: number, g: number, b: number, rgb: Uint8Array, at: number): void;
}

function makeShader(prim: GlbPrimitive, eye: [number, number, number]): Shader {
  const metal = Math.min(Math.max(prim.metalness, 0), 1);
  const rough = Math.min(Math.max(prim.roughness, 0.0525), 1);
  const alpha = rough * rough;
  const a2 = alpha * alpha;
  const dfgV = new Float64Array(2);
  const dfgL = new Float64Array(2);
  const [lx, ly, lz] = LIGHT_DIR;
  return {
    shade(px, py, pz, nx, ny, nz, r, g, b, rgb, at) {
      // View direction, per fragment: three's geometryViewDir for a
      // perspective camera.
      let vx = eye[0] - px, vy = eye[1] - py, vz = eye[2] - pz;
      const vl = Math.hypot(vx, vy, vz) || 1;
      vx /= vl; vy /= vl; vz /= vl;

      const dotNL = Math.max(nx * lx + ny * ly + nz * lz, 0);
      const dotNV = Math.min(Math.max(nx * vx + ny * vy + nz * vz, 0), 1);

      // The material, as lights_physical_fragment sets it up.
      const dr = r * (1 - metal), dg = g * (1 - metal), db = b * (1 - metal);
      const f0r = 0.04 + (r - 0.04) * metal, f0g = 0.04 + (g - 0.04) * metal, f0b = 0.04 + (b - 0.04) * metal;

      // Ambient: irradiance * BRDF_Lambert(diffuseContribution).
      let outR = AMBIENT * dr * RECIPROCAL_PI;
      let outG = AMBIENT * dg * RECIPROCAL_PI;
      let outB = AMBIENT * db * RECIPROCAL_PI;

      if (dotNL > 0) {
        const irradiance = DIRECTIONAL * dotNL;
        outR += irradiance * dr * RECIPROCAL_PI;
        outG += irradiance * dg * RECIPROCAL_PI;
        outB += irradiance * db * RECIPROCAL_PI;

        // BRDF_GGX: Schlick Fresnel, GGX distribution, Smith-correlated visibility.
        let hx = lx + vx, hy = ly + vy, hz = lz + vz;
        const hl = Math.hypot(hx, hy, hz) || 1;
        hx /= hl; hy /= hl; hz /= hl;
        const dotNH = Math.min(Math.max(nx * hx + ny * hy + nz * hz, 0), 1);
        const dotVH = Math.min(Math.max(vx * hx + vy * hy + vz * hz, 0), 1);
        const fresnel = Math.pow(2, (-5.55473 * dotVH - 6.98316) * dotVH);
        const Fr = f0r * (1 - fresnel) + fresnel;
        const Fg = f0g * (1 - fresnel) + fresnel;
        const Fb = f0b * (1 - fresnel) + fresnel;
        const gv = dotNL * Math.sqrt(a2 + (1 - a2) * dotNV * dotNV);
        const gl = dotNV * Math.sqrt(a2 + (1 - a2) * dotNL * dotNL);
        const V = 0.5 / Math.max(gv + gl, EPSILON);
        const denom = dotNH * dotNH * (a2 - 1) + 1;
        const D = (RECIPROCAL_PI * a2) / (denom * denom);
        const VD = V * D;

        // BRDF_GGX_Multiscatter's energy compensation, from the DFG table.
        sampleDfg(rough, dotNV, dfgV);
        sampleDfg(rough, dotNL, dfgL);
        const EmsV = 1 - (dfgV[0] + dfgV[1]);
        const EmsL = 1 - (dfgL[0] + dfgL[1]);
        const comp = EmsV * EmsL;
        const ms = (f0: number) => {
          const fssV = f0 * dfgV[0] + dfgV[1];
          const fssL = f0 * dfgL[0] + dfgL[1];
          const favg = f0 + (1 - f0) * 0.047619;
          return ((fssV * fssL * favg) / (1 - comp * favg + EPSILON)) * comp;
        };
        outR += irradiance * (Fr * VD + ms(f0r));
        outG += irradiance * (Fg * VD + ms(f0g));
        outB += irradiance * (Fb * VD + ms(f0b));
      }

      rgb[at] = srgbEncode(outR);
      rgb[at + 1] = srgbEncode(outG);
      rgb[at + 2] = srgbEncode(outB);
    }
  };
}

// --- camera and rasteriser -------------------------------------------------

const FOV_DEG = 50;
const NEAR = 0.1;
const FAR = 10000;
/** Where MiniViewer and the editor put the camera, in units of the model's
 *  largest extent, relative to its centre. */
const EYE = [1.2, -1.2, 0.8];

export interface RgbImage {
  width: number;
  height: number;
  /** Row-major RGB, 3 bytes per pixel. */
  data: Uint8Array;
}

/**
 * Draw the GLB's scene as the card's viewer frames it.
 *
 * The output is the full-size image after supersampling: every pixel is the
 * mean of a `supersample` x `supersample` block of shaded samples, averaged in
 * sRGB as a resolved MSAA buffer is.
 */
export function renderGlbRgb(glb: Uint8Array, options: GlbPreviewOptions = {}): RgbImage {
  const width = Math.max(1, Math.floor(options.width ?? 800));
  const height = Math.max(1, Math.floor(options.height ?? 600));
  const ss = Math.min(4, Math.max(1, Math.floor(options.supersample ?? 2)));
  const scene = parseGlb(glb);
  const prims = scene.triangles;

  const W = width * ss, H = height * ss;
  const rgb = new Uint8Array(W * H * 3);
  for (let i = 0; i < W * H; i++) {
    rgb[i * 3] = PREVIEW_BACKGROUND[0];
    rgb[i * 3 + 1] = PREVIEW_BACKGROUND[1];
    rgb[i * 3 + 2] = PREVIEW_BACKGROUND[2];
  }

  // Box3.setFromObject over every vertex, then the model is moved so the
  // box's centre sits at the origin and the camera looks at that.
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const p of [...prims, ...scene.lines]) {
    const a = p.positions;
    for (let i = 0; i < a.length; i += 3) {
      if (a[i] < minX) minX = a[i];
      if (a[i] > maxX) maxX = a[i];
      if (a[i + 1] < minY) minY = a[i + 1];
      if (a[i + 1] > maxY) maxY = a[i + 1];
      if (a[i + 2] < minZ) minZ = a[i + 2];
      if (a[i + 2] > maxZ) maxZ = a[i + 2];
    }
  }
  if (!(minX <= maxX)) return downsample(rgb, W, ss, width, height);
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, cz = (minZ + maxZ) / 2;
  const maxDim = Math.max(maxX - minX, maxY - minY, maxZ - minZ);
  if (!(maxDim > 0)) return downsample(rgb, W, ss, width, height);

  // The camera, as Object3D.lookAt builds it: z backwards along the view,
  // x = up cross z, y = z cross x, with Z up.
  const eye: [number, number, number] = [cx + EYE[0] * maxDim, cy + EYE[1] * maxDim, cz + EYE[2] * maxDim];
  let zx = eye[0] - cx, zy = eye[1] - cy, zz = eye[2] - cz;
  const zl = Math.hypot(zx, zy, zz);
  zx /= zl; zy /= zl; zz /= zl;
  // up = (0, 0, 1): x = up x z
  let xx = -zy, xy = zx, xz = 0;
  const xl = Math.hypot(xx, xy, xz) || 1;
  xx /= xl; xy /= xl; xz /= xl;
  const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;

  const f = 1 / Math.tan((FOV_DEG * PI) / 360);
  const aspect = width / height;

  const zbuf = new Float32Array(W * H); // 1/depth; larger is nearer; 0 is empty
  const faceN = new Float64Array(3);

  for (const prim of prims) {
    const pos = prim.positions;
    const count = pos.length / 3;
    // Per-vertex screen position and 1/w.
    const sx = new Float64Array(count), sy = new Float64Array(count), iw = new Float64Array(count);
    const ok = new Uint8Array(count);
    for (let i = 0; i < count; i++) {
      const px = pos[i * 3] - eye[0], py = pos[i * 3 + 1] - eye[1], pz = pos[i * 3 + 2] - eye[2];
      const vx = px * xx + py * xy + pz * xz;
      const vy = px * yx + py * yy + pz * yz;
      const vz = px * zx + py * zy + pz * zz; // negative in front of the camera
      const depth = -vz;
      if (depth < NEAR || depth > FAR) continue;
      ok[i] = 1;
      iw[i] = 1 / depth;
      sx[i] = ((f / aspect) * vx * iw[i] * 0.5 + 0.5) * W;
      sy[i] = (0.5 - f * vy * iw[i] * 0.5) * H;
    }

    const shader = makeShader(prim, eye);
    const nrm = prim.normals;
    const col = prim.colors;
    const [br, bg, bb] = prim.baseColor;
    const idx = prim.indices;

    for (let t = 0; t + 2 < idx.length; t += 3) {
      const i0 = idx[t], i1 = idx[t + 1], i2 = idx[t + 2];
      if (!ok[i0] || !ok[i1] || !ok[i2]) continue; // clipped rather than split; see NEAR
      const x0 = sx[i0], y0 = sy[i0], x1 = sx[i1], y1 = sy[i1], x2 = sx[i2], y2 = sy[i2];
      const area = (x1 - x0) * (y2 - y0) - (y1 - y0) * (x2 - x0);
      if (area === 0) continue;
      // Screen y points down, so a counter-clockwise (front) triangle in
      // clip space has negative area here.
      const front = area < 0;
      if (!front && !prim.doubleSided) continue;
      const flip = front ? 1 : -1;

      if (!nrm) {
        // Flat shading, as three does for a glTF primitive without normals.
        const ax = pos[i1 * 3] - pos[i0 * 3], ay = pos[i1 * 3 + 1] - pos[i0 * 3 + 1], az = pos[i1 * 3 + 2] - pos[i0 * 3 + 2];
        const bx = pos[i2 * 3] - pos[i0 * 3], by = pos[i2 * 3 + 1] - pos[i0 * 3 + 1], bz = pos[i2 * 3 + 2] - pos[i0 * 3 + 2];
        faceN[0] = ay * bz - az * by;
        faceN[1] = az * bx - ax * bz;
        faceN[2] = ax * by - ay * bx;
        const l = Math.hypot(faceN[0], faceN[1], faceN[2]) || 1;
        faceN[0] /= l; faceN[1] /= l; faceN[2] /= l;
      }

      const minPx = Math.max(0, Math.floor(Math.min(x0, x1, x2)));
      const maxPx = Math.min(W - 1, Math.ceil(Math.max(x0, x1, x2)));
      const minPy = Math.max(0, Math.floor(Math.min(y0, y1, y2)));
      const maxPy = Math.min(H - 1, Math.ceil(Math.max(y0, y1, y2)));
      if (minPx > maxPx || minPy > maxPy) continue;
      const invArea = 1 / area;
      const w0i = iw[i0], w1i = iw[i1], w2i = iw[i2];

      for (let py = minPy; py <= maxPy; py++) {
        const yc = py + 0.5;
        for (let px = minPx; px <= maxPx; px++) {
          const xc = px + 0.5;
          // Barycentric weights, normalised to sum to 1 (sign of area cancels).
          let l0 = ((x1 - xc) * (y2 - yc) - (y1 - yc) * (x2 - xc)) * invArea;
          let l1 = ((x2 - xc) * (y0 - yc) - (y2 - yc) * (x0 - xc)) * invArea;
          let l2 = 1 - l0 - l1;
          if (l0 < 0 || l1 < 0 || l2 < 0) continue;
          const z = l0 * w0i + l1 * w1i + l2 * w2i;
          const at = py * W + px;
          if (z <= zbuf[at]) continue;
          zbuf[at] = z;
          // Perspective-correct weights for the attributes.
          l0 = (l0 * w0i) / z; l1 = (l1 * w1i) / z; l2 = (l2 * w2i) / z;

          const wx = l0 * pos[i0 * 3] + l1 * pos[i1 * 3] + l2 * pos[i2 * 3];
          const wy = l0 * pos[i0 * 3 + 1] + l1 * pos[i1 * 3 + 1] + l2 * pos[i2 * 3 + 1];
          const wz = l0 * pos[i0 * 3 + 2] + l1 * pos[i1 * 3 + 2] + l2 * pos[i2 * 3 + 2];
          let nx: number, ny: number, nz: number;
          if (nrm) {
            nx = l0 * nrm[i0 * 3] + l1 * nrm[i1 * 3] + l2 * nrm[i2 * 3];
            ny = l0 * nrm[i0 * 3 + 1] + l1 * nrm[i1 * 3 + 1] + l2 * nrm[i2 * 3 + 1];
            nz = l0 * nrm[i0 * 3 + 2] + l1 * nrm[i1 * 3 + 2] + l2 * nrm[i2 * 3 + 2];
            const nl = Math.hypot(nx, ny, nz) || 1;
            nx = (nx / nl) * flip; ny = (ny / nl) * flip; nz = (nz / nl) * flip;
          } else {
            nx = faceN[0] * flip; ny = faceN[1] * flip; nz = faceN[2] * flip;
          }
          let r = br, g = bg, b = bb;
          if (col) {
            r *= l0 * col[i0 * 3] + l1 * col[i1 * 3] + l2 * col[i2 * 3];
            g *= l0 * col[i0 * 3 + 1] + l1 * col[i1 * 3 + 1] + l2 * col[i2 * 3 + 1];
            b *= l0 * col[i0 * 3 + 2] + l1 * col[i1 * 3 + 2] + l2 * col[i2 * 3 + 2];
          }
          shader.shade(wx, wy, wz, nx, ny, nz, r, g, b, rgb, at * 3);
        }
      }
    }
  }

  // Edges over the faces: a LINES primitive, one output pixel wide, hidden
  // behind nearer faces. A line lies exactly on the faces it borders, so the
  // depth test looks at the sample's neighbours too and allows a little
  // slack; otherwise the line loses half its pixels to the very face it
  // outlines, as three's own LineSegments do.
  const LINE_SLACK = 0.002;
  for (const line of scene.lines) {
    const pos = line.positions;
    const count = pos.length / 3;
    const sx = new Float64Array(count), sy = new Float64Array(count), iw = new Float64Array(count);
    const ok = new Uint8Array(count);
    for (let i = 0; i < count; i++) {
      const px = pos[i * 3] - eye[0], py = pos[i * 3 + 1] - eye[1], pz = pos[i * 3 + 2] - eye[2];
      const vx = px * xx + py * xy + pz * xz;
      const vy = px * yx + py * yy + pz * yz;
      const depth = -(px * zx + py * zy + pz * zz);
      if (depth < NEAR || depth > FAR) continue;
      ok[i] = 1;
      iw[i] = 1 / depth;
      sx[i] = ((f / aspect) * vx * iw[i] * 0.5 + 0.5) * W;
      sy[i] = (0.5 - f * vy * iw[i] * 0.5) * H;
    }
    const cr = srgbEncode(line.color[0]), cg = srgbEncode(line.color[1]), cb = srgbEncode(line.color[2]);
    const half = ss / 2;
    const idx = line.indices;
    for (let t = 0; t + 1 < idx.length; t += 2) {
      const a = idx[t], b = idx[t + 1];
      if (!ok[a] || !ok[b]) continue;
      const x0 = sx[a], y0 = sy[a], x1 = sx[b], y1 = sy[b];
      const steps = Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) / half) + 1;
      for (let k = 0; k <= steps; k++) {
        const u = k / steps;
        const x = x0 + (x1 - x0) * u, y = y0 + (y1 - y0) * u;
        const z = iw[a] + (iw[b] - iw[a]) * u; // 1/w is linear on screen
        const px0 = Math.max(0, Math.floor(x - half)), px1 = Math.min(W - 1, Math.ceil(x + half) - 1);
        const py0 = Math.max(0, Math.floor(y - half)), py1 = Math.min(H - 1, Math.ceil(y + half) - 1);
        for (let py = py0; py <= py1; py++) {
          for (let px = px0; px <= px1; px++) {
            let near = zbuf[py * W + px];
            for (let dy = -1; dy <= 1; dy++) {
              const ny2 = py + dy;
              if (ny2 < 0 || ny2 >= H) continue;
              for (let dx = -1; dx <= 1; dx++) {
                const nx2 = px + dx;
                if (nx2 < 0 || nx2 >= W) continue;
                const zn = zbuf[ny2 * W + nx2];
                if (zn < near) near = zn;
              }
            }
            if (z < near * (1 - LINE_SLACK)) continue;
            const at = (py * W + px) * 3;
            rgb[at] = cr; rgb[at + 1] = cg; rgb[at + 2] = cb;
          }
        }
      }
    }
  }

  return downsample(rgb, W, ss, width, height);
}

function downsample(rgb: Uint8Array, W: number, ss: number, width: number, height: number): RgbImage {
  if (ss === 1) return { width, height, data: rgb };
  const out = new Uint8Array(width * height * 3);
  const n = ss * ss;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0, g = 0, b = 0;
      for (let dy = 0; dy < ss; dy++) {
        let at = ((y * ss + dy) * W + x * ss) * 3;
        for (let dx = 0; dx < ss; dx++, at += 3) {
          r += rgb[at]; g += rgb[at + 1]; b += rgb[at + 2];
        }
      }
      const o = (y * width + x) * 3;
      out[o] = Math.round(r / n);
      out[o + 1] = Math.round(g / n);
      out[o + 2] = Math.round(b / n);
    }
  }
  return { width, height, data: out };
}

/** The preview PNG of this GLB: what a card shows until it is hovered. */
export async function renderPreviewPng(glb: Uint8Array, options: GlbPreviewOptions = {}): Promise<Uint8Array<ArrayBuffer>> {
  const img = renderGlbRgb(glb, options);
  return encodePngRgb(img.data, img.width, img.height);
}
