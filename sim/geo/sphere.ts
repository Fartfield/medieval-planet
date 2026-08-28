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
// construct the Goldberg polyhedron directly: we subdivide each face of an
// icosahedron into FREQUENCY^2 smaller triangles, and the 10*F^2 + 2 vertices
// that fall out are the cell centres. Cell adjacency is geodesic edge
// adjacency; a cell's outline is the ring of triangle centroids around its
// vertex.
//
// The subdivision is by arbitrary frequency rather than by repeated halving.
// Halving is simpler -- an edge-midpoint cache and one line of recursion --
// but it can only ever produce 12, 42, 162, 642, 2562 or 10242 cells, and the
// design asks for a hundred. Frequency 3 gives 92, which is what "10 by 10"
// means on a sphere.
//
// DETERMINISM
//
// Vertices are identified by their *position in the subdivision*, never by
// comparing floating-point coordinates. A point on the edge between two faces
// is generated twice, once by each face, and the two results differ in the
// last bit; keyed by geometry they would become two cells and a border would
// quietly fail to close. Keyed by (which edge, how many steps along it) they
// are the same cell by construction. This is the single most important thing
// in the file.

/**
 * How many pieces each icosahedron edge is cut into.
 *
 * 3 gives 92 cells: 80 hexagons and the 12 pentagons a sphere cannot avoid.
 * That is the design's "10 by 10 world map" as closely as a sphere allows.
 *
 * Note what that costs: one region in eight is a pentagon. The twelve are a
 * fixed toll, so the coarser the globe the larger a share of it they are --
 * at the old frequency of 32 they were 0.12% of the map and nobody noticed.
 */
export const FREQUENCY = 3;
export const CELL_COUNT = 10 * FREQUENCY * FREQUENCY + 2; // 92
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
let faceTriangles: Int32Array;

/** Cell outlines, built lazily -- only the client ever needs them. */
let outlines: Float64Array[] | null = null;

build();

function build(): void {
  const t = (1 + Math.sqrt(5)) / 2;

  // The twelve icosahedron vertices, as three orthogonal golden rectangles.
  // These become cells 0..11 and are precisely the twelve pentagons.
  const verts: number[] = [
    -1, t, 0, 1, t, 0, -1, -t, 0, 1, -t, 0,
    0, -1, t, 0, 1, t, 0, -1, -t, 0, 1, -t,
    t, 0, -1, t, 0, 1, -t, 0, -1, -t, 0, 1,
  ];
  for (let i = 0; i < 12; i++) normalizeInto(verts, i);

  const faces: number[] = [
    0, 11, 5, 0, 5, 1, 0, 1, 7, 0, 7, 10, 0, 10, 11,
    1, 5, 9, 5, 11, 4, 11, 10, 2, 10, 7, 6, 7, 1, 8,
    3, 9, 4, 3, 4, 2, 3, 2, 6, 3, 6, 8, 3, 8, 9,
    4, 9, 5, 2, 4, 11, 6, 2, 10, 8, 6, 7, 9, 8, 1,
  ];

  const m = FREQUENCY;
  // Shared points, keyed by where they sit in the subdivision rather than by
  // their coordinates. Corners are the twelve originals; a point on an edge is
  // named by that edge and how many steps along it, counting from whichever
  // end has the lower index so both faces agree; interior points belong to one
  // face and cannot collide.
  const shared = new Map<string, number>();
  for (let i = 0; i < 12; i++) shared.set(`c${i}`, i);

  const triangles: number[] = [];

  for (let f = 0; f < faces.length; f += 3) {
    const a = faces[f];
    const b = faces[f + 1];
    const c = faces[f + 2];

    // Points of this face, by barycentric step (i, j), with k = m - i - j.
    const local = new Map<number, number>();

    for (let i = 0; i <= m; i++) {
      for (let j = 0; j <= m - i; j++) {
        const k = m - i - j;
        const key = identify(i, j, k, a, b, c, m);

        let id = shared.get(key);
        if (id === undefined) {
          id = verts.length / 3;
          verts.push(
            (i * verts[a * 3] + j * verts[b * 3] + k * verts[c * 3]) / m,
            (i * verts[a * 3 + 1] + j * verts[b * 3 + 1] + k * verts[c * 3 + 1]) / m,
            (i * verts[a * 3 + 2] + j * verts[b * 3 + 2] + k * verts[c * 3 + 2]) / m,
          );
          normalizeInto(verts, id);
          shared.set(key, id);
        }
        local.set(i * (m + 1) + j, id);
      }
    }

    const at = (i: number, j: number): number => local.get(i * (m + 1) + j)!;
    for (let i = 0; i < m; i++) {
      for (let j = 0; j < m - i; j++) {
        triangles.push(at(i, j), at(i + 1, j), at(i, j + 1));
        if (j < m - 1 - i) {
          triangles.push(at(i + 1, j), at(i + 1, j + 1), at(i, j + 1));
        }
      }
    }
  }

  if (verts.length !== CELL_COUNT * 3) {
    throw new Error(`geodesic produced ${verts.length / 3} cells, expected ${CELL_COUNT}`);
  }
  centres.set(verts);
  faceTriangles = Int32Array.from(triangles);

  buildAdjacency();
}

/**
 * Name a point of the subdivision so that two faces sharing it agree.
 *
 * Never a coordinate comparison. The two faces meeting along an edge compute
 * the same point by different arithmetic and get answers differing in the last
 * bit; if that decided identity, one cell would silently become two and a
 * border would fail to close a hundred hours later.
 */
function identify(
  i: number, j: number, k: number,
  a: number, b: number, c: number, m: number,
): string {
  if (i === m) return `c${a}`;
  if (j === m) return `c${b}`;
  if (k === m) return `c${c}`;
  // On an edge: named by the edge and the step count from its lower-indexed
  // end, so both faces produce the same name.
  if (k === 0) return edgeKey(a, b, j, m);
  if (j === 0) return edgeKey(a, c, k, m);
  if (i === 0) return edgeKey(b, c, k, m);
  // Interior to this face, so the face is enough to make it unique.
  return `f${a}.${b}.${c}.${i}.${j}`;
}

function edgeKey(u: number, v: number, stepsFromU: number, m: number): string {
  return u < v
    ? `e${u}.${v}.${stepsFromU}`
    : `e${v}.${u}.${m - stepsFromU}`;
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
  for (let f = 0; f < faceTriangles.length; f += 3) {
    const a = faceTriangles[f];
    const b = faceTriangles[f + 1];
    const c = faceTriangles[f + 2];
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
  for (let f = 0; f < faceTriangles.length; f += 3) {
    incident[faceTriangles[f]].push(f);
    incident[faceTriangles[f + 1]].push(f);
    incident[faceTriangles[f + 2]].push(f);
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
      const a = faceTriangles[f];
      const b = faceTriangles[f + 1];
      const c = faceTriangles[f + 2];
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
