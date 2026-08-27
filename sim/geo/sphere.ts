// The globe: 10,242 cells on a sphere, twelve of which are pentagons.
//
// WHY TWELVE
//
// You cannot tile a sphere with hexagons. Euler's formula forbids it: for any
// polyhedron V - E + F = 2, and if every face had six sides the arithmetic
// gives 2 = 0. Working it through, a sphere covered in hexagons needs exactly
// twelve pentagons, no matter how many hexagons you add. Every hex-globe game
// has them; the honest thing is to know where they are rather than pretend.
//
// Ours sit at the twelve vertices of the icosahedron we start from, and the
// generator treats them as ordinary cells with five neighbours instead of six.
// They are the only irregularity in the entire world, and they exist on this
// layer alone -- every layer below is a flat hex field with no pentagons at
// all, because at 250 km across an L0 cell is flat to within 0.06%.
//
// HOW IT IS BUILT
//
// A Goldberg polyhedron is the dual of a geodesic sphere, which means its
// cells correspond one-for-one to the *vertices* of the geodesic. So we never
// construct the Goldberg polyhedron directly: we subdivide an icosahedron five
// times, and the 10,242 vertices that fall out are our 10,242 cell centres.
// Cell adjacency is geodesic edge adjacency; a cell's outline is the ring of
// triangle centroids around its vertex.
//
// Five levels is not arbitrary. Each level quadruples the triangles and gives
// 10*4^level + 2 vertices; level 5 gives 10,242, which is the closest this
// construction comes to the 10,000 regions the design asked for -- 2.4% over.
//
// DETERMINISM
//
// Cell ids are assigned in subdivision order from a fixed starting icosahedron,
// so they are stable across runs and machines without any sorting. Edge
// midpoints are shared through a cache keyed by the *indices* of their two
// parents, never by comparing floating-point positions -- two faces computing
// "the same" midpoint would otherwise produce values differing in the last bit
// and silently split one cell into two. This is the single most important line
// in the file and it is the cache below.

export const SUBDIVISIONS = 5;
export const CELL_COUNT = 10 * 4 ** SUBDIVISIONS + 2; // 10,242
export const PENTAGON_COUNT = 12;

/** Cell centres as unit vectors, packed xyz. Index i is at [3i, 3i+1, 3i+2]. */
export const centres = new Float64Array(CELL_COUNT * 3);

/**
 * Neighbour ids, six per cell, packed. The twelve pentagons use only the first
 * five slots and store -1 in the sixth -- kept fixed-width so that iteration
 * over neighbours never allocates and never branches on cell shape.
 */
export const neighbours = new Int32Array(CELL_COUNT * 6).fill(-1);

/** Triangles of the underlying geodesic, three vertex ids each. */
let triangles: Int32Array;

/** Cell outlines, built lazily -- only the client ever needs them. */
let outlines: Float64Array[] | null = null;

build();

function build(): void {
  const t = (1 + Math.sqrt(5)) / 2;

  // The twelve icosahedron vertices, as three orthogonal golden rectangles.
  // These become cells 0..11 and are precisely the twelve pentagons.
  let verts: number[] = [
    -1, t, 0, 1, t, 0, -1, -t, 0, 1, -t, 0,
    0, -1, t, 0, 1, t, 0, -1, -t, 0, 1, -t,
    t, 0, -1, t, 0, 1, -t, 0, -1, -t, 0, 1,
  ];
  for (let i = 0; i < 12; i++) normalizeInto(verts, i);

  let faces: number[] = [
    0, 11, 5, 0, 5, 1, 0, 1, 7, 0, 7, 10, 0, 10, 11,
    1, 5, 9, 5, 11, 4, 11, 10, 2, 10, 7, 6, 7, 1, 8,
    3, 9, 4, 3, 4, 2, 3, 2, 6, 3, 6, 8, 3, 8, 9,
    4, 9, 5, 2, 4, 11, 6, 2, 10, 8, 6, 7, 9, 8, 1,
  ];

  for (let level = 0; level < SUBDIVISIONS; level++) {
    const next: number[] = [];
    // Keyed by the two parent vertex indices, smaller first. Integer keys, so
    // two faces sharing an edge get the same midpoint by identity rather than
    // by floating-point luck. Splitting a cell in two here would be invisible
    // until a border refused to close, a hundred hours later.
    const midpoints = new Map<number, number>();

    for (let f = 0; f < faces.length; f += 3) {
      const a = faces[f];
      const b = faces[f + 1];
      const c = faces[f + 2];
      const ab = midpoint(verts, midpoints, a, b);
      const bc = midpoint(verts, midpoints, b, c);
      const ca = midpoint(verts, midpoints, c, a);
      next.push(a, ab, ca, b, bc, ab, c, ca, bc, ab, bc, ca);
    }
    faces = next;
  }

  if (verts.length !== CELL_COUNT * 3) {
    throw new Error(`icosphere produced ${verts.length / 3} cells, expected ${CELL_COUNT}`);
  }
  centres.set(verts);
  triangles = Int32Array.from(faces);

  buildAdjacency();
}

function midpoint(
  verts: number[],
  cache: Map<number, number>,
  a: number,
  b: number,
): number {
  const key = a < b ? a * CELL_COUNT + b : b * CELL_COUNT + a;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;

  const i = verts.length / 3;
  verts.push(
    (verts[a * 3] + verts[b * 3]) / 2,
    (verts[a * 3 + 1] + verts[b * 3 + 1]) / 2,
    (verts[a * 3 + 2] + verts[b * 3 + 2]) / 2,
  );
  normalizeInto(verts, i);
  cache.set(key, i);
  return i;
}

function normalizeInto(v: number[], i: number): void {
  const x = v[i * 3];
  const y = v[i * 3 + 1];
  const z = v[i * 3 + 2];
  const len = Math.sqrt(x * x + y * y + z * z);
  v[i * 3] = x / len;
  v[i * 3 + 1] = y / len;
  v[i * 3 + 2] = z / len;
}

function buildAdjacency(): void {
  const count = new Uint8Array(CELL_COUNT);
  const link = (a: number, b: number): void => {
    for (let i = 0; i < count[a]; i++) {
      if (neighbours[a * 6 + i] === b) return;
    }
    if (count[a] >= 6) throw new Error(`cell ${a} has more than six neighbours`);
    neighbours[a * 6 + count[a]++] = b;
  };
  for (let f = 0; f < triangles.length; f += 3) {
    const a = triangles[f];
    const b = triangles[f + 1];
    const c = triangles[f + 2];
    link(a, b); link(b, a);
    link(b, c); link(c, b);
    link(c, a); link(a, c);
  }
  for (let i = 0; i < CELL_COUNT; i++) {
    const n = count[i];
    if (n !== 6 && !(n === 5 && i < 12)) {
      throw new Error(`cell ${i} has ${n} neighbours; only cells 0-11 may have five`);
    }
  }
}

/** The twelve pentagons are exactly the original icosahedron vertices. */
export function isPentagon(cell: number): boolean {
  return cell < PENTAGON_COUNT;
}

export function neighbourCount(cell: number): number {
  return isPentagon(cell) ? 5 : 6;
}

export function centre(cell: number, out: Float64Array): Float64Array {
  out[0] = centres[cell * 3];
  out[1] = centres[cell * 3 + 1];
  out[2] = centres[cell * 3 + 2];
  return out;
}

/**
 * The cell containing a direction, by greedy descent.
 *
 * Start anywhere and repeatedly step to whichever neighbour is closer to the
 * target. On a sphere whose cells come from a Delaunay triangulation this
 * cannot get stuck in a local minimum, so it always lands on the true nearest
 * cell -- in about 50 steps rather than the 10,242 a linear scan would take.
 */
export function cellAt(x: number, y: number, z: number): number {
  const len = Math.sqrt(x * x + y * y + z * z);
  if (len === 0) return 0;
  const nx = x / len;
  const ny = y / len;
  const nz = z / len;

  let best = 0;
  let bestDot = dot(0, nx, ny, nz);
  for (let step = 0; step < 64; step++) {
    let moved = false;
    for (let i = 0; i < 6; i++) {
      const n = neighbours[best * 6 + i];
      if (n < 0) continue;
      const d = dot(n, nx, ny, nz);
      if (d > bestDot) {
        bestDot = d;
        best = n;
        moved = true;
      }
    }
    if (!moved) return best;
  }
  return best;
}

function dot(cell: number, x: number, y: number, z: number): number {
  return centres[cell * 3] * x + centres[cell * 3 + 1] * y + centres[cell * 3 + 2] * z;
}

/** Great-circle distance between two cells, in metres, on a given radius. */
export function distance(a: number, b: number, radiusM: number): number {
  const d = Math.max(-1, Math.min(1, dot(a, centres[b * 3], centres[b * 3 + 1], centres[b * 3 + 2])));
  return Math.acos(d) * radiusM;
}

/** Latitude and longitude of a cell centre, in radians. Drives climate. */
export function latLon(cell: number): { lat: number; lon: number } {
  const x = centres[cell * 3];
  const y = centres[cell * 3 + 1];
  const z = centres[cell * 3 + 2];
  return { lat: Math.asin(y), lon: Math.atan2(z, x) };
}

/**
 * The cell's outline: the ring of triangle centroids around its vertex, in
 * order. This is the Goldberg face -- the hexagon (or pentagon) a player sees.
 *
 * Built lazily and cached, because only the renderer needs it. The ordering
 * uses atan2 in the cell's tangent plane, which is fine here in a way it would
 * not be inside the simulation: an outline is a picture, not state.
 */
export function outline(cell: number): Float64Array {
  if (outlines === null) outlines = buildOutlines();
  return outlines[cell];
}

function buildOutlines(): Float64Array[] {
  const incident: number[][] = Array.from({ length: CELL_COUNT }, () => []);
  for (let f = 0; f < triangles.length; f += 3) {
    incident[triangles[f]].push(f);
    incident[triangles[f + 1]].push(f);
    incident[triangles[f + 2]].push(f);
  }

  return incident.map((tris, cell) => {
    const cx = centres[cell * 3];
    const cy = centres[cell * 3 + 1];
    const cz = centres[cell * 3 + 2];

    // Any two perpendicular directions in the tangent plane will do; pick the
    // axis least aligned with the normal so the cross product stays stable.
    const ax = Math.abs(cx) < Math.abs(cy) && Math.abs(cx) < Math.abs(cz) ? 0 : Math.abs(cy) < Math.abs(cz) ? 1 : 2;
    const ux = ax === 0 ? 1 : 0;
    const uy = ax === 1 ? 1 : 0;
    const uz = ax === 2 ? 1 : 0;
    let ex = uy * cz - uz * cy;
    let ey = uz * cx - ux * cz;
    let ez = ux * cy - uy * cx;
    const el = Math.sqrt(ex * ex + ey * ey + ez * ez);
    ex /= el; ey /= el; ez /= el;
    const fx = cy * ez - cz * ey;
    const fy = cz * ex - cx * ez;
    const fz = cx * ey - cy * ex;

    const pts = tris.map((f) => {
      const a = triangles[f];
      const b = triangles[f + 1];
      const c = triangles[f + 2];
      let px = (centres[a * 3] + centres[b * 3] + centres[c * 3]) / 3;
      let py = (centres[a * 3 + 1] + centres[b * 3 + 1] + centres[c * 3 + 1]) / 3;
      let pz = (centres[a * 3 + 2] + centres[b * 3 + 2] + centres[c * 3 + 2]) / 3;
      const l = Math.sqrt(px * px + py * py + pz * pz);
      px /= l; py /= l; pz /= l;
      const angle = Math.atan2(
        px * fx + py * fy + pz * fz,
        px * ex + py * ey + pz * ez,
      );
      return { px, py, pz, angle };
    });

    pts.sort((p, q) => p.angle - q.angle);
    const out = new Float64Array(pts.length * 3);
    for (let i = 0; i < pts.length; i++) {
      out[i * 3] = pts[i].px;
      out[i * 3 + 1] = pts[i].py;
      out[i * 3 + 2] = pts[i].pz;
    }
    return out;
  });
}
