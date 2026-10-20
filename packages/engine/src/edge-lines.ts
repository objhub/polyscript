/**
 * CAD edges as polylines for a preview GLB.
 *
 * The kernel hands out edges as independent segments (two points each, the
 * form THREE.LineSegments takes), sampled as finely as the faces. For the
 * preview GLB that is more than needed: the picture is a card, and every
 * card hover downloads the file. So this joins the segments back into
 * polylines, drops the points that do not bend them by more than a small
 * tolerance, and shares the endpoints, which is what a glTF LINES primitive
 * with an index buffer wants. The lines stay the kernel's edges -- no angle
 * threshold decides what is an edge -- only sampled more coarsely.
 */

export interface EdgeLines {
  positions: Float32Array<ArrayBuffer>;
  /** Pairs of vertex indices, one pair per segment (glTF mode LINES). */
  indices: Uint32Array<ArrayBuffer>;
}

/** Tolerance as a fraction of the edges' bounding-box diagonal: a point is
 *  dropped when the polyline through its neighbours passes within this of it.
 *  0.3% is under a pixel on a card and invisible in the hover view. */
export const EDGE_TOLERANCE = 0.003;

/**
 * Join `edgePoints` (XYZ pairs per segment) into decimated polylines.
 *
 * `tolerance` is absolute, in model units; the default is EDGE_TOLERANCE of
 * the bounding-box diagonal. 0 keeps every point.
 */
export function edgeLines(edgePoints: Float32Array, tolerance?: number): EdgeLines {
  const segCount = Math.floor(edgePoints.length / 6);
  if (segCount === 0) return { positions: new Float32Array(0), indices: new Uint32Array(0) };

  // The extent, for the default tolerance and for matching points.
  let min = [Infinity, Infinity, Infinity];
  let max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i + 2 < edgePoints.length; i += 3) {
    min = [Math.min(min[0], edgePoints[i]), Math.min(min[1], edgePoints[i + 1]), Math.min(min[2], edgePoints[i + 2])];
    max = [Math.max(max[0], edgePoints[i]), Math.max(max[1], edgePoints[i + 1]), Math.max(max[2], edgePoints[i + 2])];
  }
  const diagonal = Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) || 1;
  tolerance ??= EDGE_TOLERANCE * diagonal;

  // Distinct points, matched on coordinates: the kernel repeats a polyline's
  // interior points and the ends where edges meet. Matched to a millionth
  // of the extent, so a point computed two ways still meets itself.
  const quantum = diagonal * 1e-6;
  const ids = new Map<string, number>();
  const xs: number[] = [];
  const ys: number[] = [];
  const zs: number[] = [];
  const idOf = (x: number, y: number, z: number) => {
    const k = `${Math.round(x / quantum)},${Math.round(y / quantum)},${Math.round(z / quantum)}`;
    let id = ids.get(k);
    if (id === undefined) {
      id = xs.length;
      ids.set(k, id);
      xs.push(x);
      ys.push(y);
      zs.push(z);
    }
    return id;
  };
  const segA = new Int32Array(segCount);
  const segB = new Int32Array(segCount);
  const adjacency: number[][] = [];
  for (let s = 0; s < segCount; s++) {
    const a = idOf(edgePoints[s * 6], edgePoints[s * 6 + 1], edgePoints[s * 6 + 2]);
    const b = idOf(edgePoints[s * 6 + 3], edgePoints[s * 6 + 4], edgePoints[s * 6 + 5]);
    if (a === b) continue;
    segA[s] = a;
    segB[s] = b;
    (adjacency[a] ??= []).push(s);
    (adjacency[b] ??= []).push(s);
  }

  // Walk chains. Start at every point that is not simply passed through
  // (an end, or where three or more edges meet), then sweep up closed loops.
  const used = new Uint8Array(segCount);
  const polylines: number[][] = [];
  const walk = (start: number, seg: number) => {
    const line = [start];
    let at = start;
    let s = seg;
    for (;;) {
      used[s] = 1;
      at = segA[s] === at ? segB[s] : segA[s];
      line.push(at);
      const next = adjacency[at];
      if (!next || next.length !== 2) break;
      s = next[0] === s ? next[1] : next[0];
      if (used[s]) break;
    }
    polylines.push(line);
  };
  for (let v = 0; v < xs.length; v++) {
    const segs = adjacency[v];
    if (!segs || segs.length === 2) continue;
    for (const s of segs) if (!used[s]) walk(v, s);
  }
  for (let s = 0; s < segCount; s++) if (!used[s] && segA[s] !== segB[s]) walk(segA[s], s);

  // Decimate each polyline (Douglas-Peucker), then emit shared vertices.
  const keep = new Uint8Array(xs.length);
  const simplify = (line: number[], from: number, to: number) => {
    keep[line[from]] = 1;
    keep[line[to]] = 1;
    if (to - from < 2) return;
    const ax = xs[line[from]], ay = ys[line[from]], az = zs[line[from]];
    let dx = xs[line[to]] - ax, dy = ys[line[to]] - ay, dz = zs[line[to]] - az;
    const len = Math.hypot(dx, dy, dz);
    if (len > 0) { dx /= len; dy /= len; dz /= len; }
    let worst = -1;
    let worstDist = tolerance;
    for (let i = from + 1; i < to; i++) {
      const px = xs[line[i]] - ax, py = ys[line[i]] - ay, pz = zs[line[i]] - az;
      let dist: number;
      if (len > 0) {
        const t = px * dx + py * dy + pz * dz;
        dist = Math.hypot(px - t * dx, py - t * dy, pz - t * dz);
      } else {
        dist = Math.hypot(px, py, pz);
      }
      if (dist > worstDist) { worstDist = dist; worst = i; }
    }
    if (worst < 0) return;
    simplify(line, from, worst);
    simplify(line, worst, to);
  };
  const pairs: number[] = [];
  for (const line of polylines) {
    const closed = line.length > 2 && line[0] === line[line.length - 1];
    if (closed) {
      // Split a loop in two so neither half collapses onto its chord.
      const mid = Math.floor(line.length / 2);
      simplify(line, 0, mid);
      simplify(line, mid, line.length - 1);
    } else {
      simplify(line, 0, line.length - 1);
    }
    let prev = line[0];
    for (let i = 1; i < line.length; i++) {
      const v = line[i];
      if (!keep[v]) continue;
      pairs.push(prev, v);
      prev = v;
    }
  }

  const remap = new Int32Array(xs.length).fill(-1);
  const positions: number[] = [];
  const indices = new Uint32Array(pairs.length);
  for (let i = 0; i < pairs.length; i++) {
    const v = pairs[i];
    if (remap[v] < 0) {
      remap[v] = positions.length / 3;
      positions.push(xs[v], ys[v], zs[v]);
    }
    indices[i] = remap[v];
  }
  return { positions: new Float32Array(positions), indices };
}
