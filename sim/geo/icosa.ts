// The icosahedron the world grid will be laid out on, and the map from the
// sphere onto its faces.
//
// WHY THIS EXISTS
//
// The grid this replaces gives every region its own local patch of 91 cells,
// laid out in a basis built at that region's own centre. Inside a region that
// works and is now exact: turn the child lattice to the rosette angle and a
// parent's children and its neighbour's children are one lattice, measured at
// 1.006 spacings where a lattice neighbour is 1.000.
//
// It cannot work ACROSS regions, and the reason is not a bug to find. The
// rosette turn makes a parent grid and its child grid one lattice, which needs
// the parent grid to BE a lattice. The world grid is a Goldberg polyhedron --
// near-regular hexagons on a sphere plus Euler's twelve pentagons -- and
// measured over its 1,370 hexagon-to-hexagon steps its spacings run from 91.3%
// to 110.2% of the mean and its neighbour directions depart from a 60-degree
// lattice angle by up to 20.45 degrees. Two lattices cannot meet across that at
// any orientation. Across a region boundary the tiles sit 1.422 spacings apart
// instead of 1.000, and on the world map the regions' own tiles overlap at
// 0.439.
//
// THE ANSWER, which is the one H3 and the ISEA grids use: stop building a
// lattice per region and build ONE lattice per icosahedral face. A face is a
// flat triangle, a triangular lattice tiles it exactly, and every cell at every
// depth is a point of that lattice rather than a map of its own. Then adjacent
// cells share a lattice by construction, at every scale, and the only defects
// left are the twelve icosahedron vertices -- which is Euler's minimum and the
// same twelve the current grid already has.
//
// WHAT THIS FILE IS, AND IS NOT. It is the icosahedron and the projection: the
// twelve vertices, the twenty faces, which face a direction belongs to, and the
// map from a direction to plane coordinates on that face and back. It does not
// know about cells, lattices, or the ladder. Those come next, and they are
// built on this being exactly invertible, which verify_icosa measures.

/** The golden ratio, which is what makes an icosahedron regular. */
const PHI = (1 + Math.sqrt(5)) / 2;

export const VERTEX_COUNT = 12;
export const FACE_COUNT = 20;

/**
 * The twelve vertices, as unit directions.
 *
 * The standard construction: three mutually perpendicular golden rectangles,
 * whose twelve corners are the vertices. Every coordinate is 0, +/-1 or +/-PHI
 * before normalising, so the arithmetic is exact up to one square root and the
 * symmetry is exact rather than approximate.
 */
export const vertices = new Float64Array(VERTEX_COUNT * 3);

/**
 * A LATTICE DIRECTION of each face, in 3D, lying in the face's own plane.
 *
 * The edge from the face's first vertex to its second. It matters that this is
 * an EDGE and not the direction to a vertex: a triangular lattice drawn on a
 * face runs along its edges, and the direction from the centre to a vertex sits
 * thirty degrees off that -- which, against the sixty-degree symmetry of a hex
 * lattice, is the difference between aligned and as misaligned as it is
 * possible to be.
 *
 * Both faces either side of a shared edge have that edge among their own, so a
 * lattice aligned to edges meets itself across the join.
 */
export const faceLatticeDir = new Float64Array(FACE_COUNT * 3);

/** The three vertices of each face, as indices. */
export const faceVertices = new Int32Array(FACE_COUNT * 3);

/** Each face's centre, as a unit direction. */
export const faceCentres = new Float64Array(FACE_COUNT * 3);

/**
 * A face's own plane basis: east and north, perpendicular to its centre.
 *
 * East points at the face's FIRST vertex, so the three vertices land at 0, 120
 * and 240 degrees and the lattice built on this has a defined orientation
 * rather than an arbitrary one.
 */
const faceEast = new Float64Array(FACE_COUNT * 3);
const faceNorth = new Float64Array(FACE_COUNT * 3);

/**
 * The angle from a face's centre to one of its vertices, radians.
 *
 * The same for every face and every vertex, the icosahedron being regular. It
 * is what sets the scale of the projection: a vertex lands at plane radius 1,
 * so the face is the unit triangle and nothing downstream has to carry a
 * separate scale.
 */
export let FACE_RADIUS_RAD = 0;

/** tan of the above, which is the gnomonic radius of a vertex. */
let faceRadiusTan = 0;

build();

function build(): void {
  const raw: number[][] = [];
  // The three golden rectangles, in the three coordinate planes.
  for (const s1 of [-1, 1]) {
    for (const s2 of [-1, 1]) {
      raw.push([0, s1 * 1, s2 * PHI]);
      raw.push([s1 * 1, s2 * PHI, 0]);
      raw.push([s1 * PHI, 0, s2 * 1]);
    }
  }
  for (let v = 0; v < VERTEX_COUNT; v++) {
    const [x, y, z] = raw[v];
    const len = Math.sqrt(x * x + y * y + z * z);
    vertices[v * 3] = x / len;
    vertices[v * 3 + 1] = y / len;
    vertices[v * 3 + 2] = z / len;
  }

  // Faces, found rather than tabulated. Two vertices are joined by an edge
  // when they are at the shortest distance the solid has; three mutually
  // joined vertices are a face. A table of twenty triples would be a place for
  // a typo to hide, and this is checked against the count it must produce.
  let shortest = Infinity;
  for (let a = 0; a < VERTEX_COUNT; a++) {
    for (let b = a + 1; b < VERTEX_COUNT; b++) {
      const d = dist2(a, b);
      if (d < shortest) shortest = d;
    }
  }
  const edge = shortest * 1.01;

  let f = 0;
  for (let a = 0; a < VERTEX_COUNT; a++) {
    for (let b = a + 1; b < VERTEX_COUNT; b++) {
      if (dist2(a, b) > edge) continue;
      for (let c = b + 1; c < VERTEX_COUNT; c++) {
        if (dist2(a, c) > edge || dist2(b, c) > edge) continue;
        if (f >= FACE_COUNT) throw new Error('more than twenty faces');
        faceVertices[f * 3] = a;
        faceVertices[f * 3 + 1] = b;
        faceVertices[f * 3 + 2] = c;
        f++;
      }
    }
  }
  if (f !== FACE_COUNT) throw new Error(`found ${f} faces, expected ${FACE_COUNT}`);

  for (let i = 0; i < FACE_COUNT; i++) {
    const a = faceVertices[i * 3];
    const b = faceVertices[i * 3 + 1];
    const c = faceVertices[i * 3 + 2];
    let cx = vertices[a * 3] + vertices[b * 3] + vertices[c * 3];
    let cy = vertices[a * 3 + 1] + vertices[b * 3 + 1] + vertices[c * 3 + 1];
    let cz = vertices[a * 3 + 2] + vertices[b * 3 + 2] + vertices[c * 3 + 2];
    const len = Math.sqrt(cx * cx + cy * cy + cz * cz);
    cx /= len; cy /= len; cz /= len;
    faceCentres[i * 3] = cx;
    faceCentres[i * 3 + 1] = cy;
    faceCentres[i * 3 + 2] = cz;

    // East towards the first vertex, with the part along the centre removed.
    let ex = vertices[a * 3] - cx * (vertices[a * 3] * cx + vertices[a * 3 + 1] * cy + vertices[a * 3 + 2] * cz);
    let ey = vertices[a * 3 + 1] - cy * (vertices[a * 3] * cx + vertices[a * 3 + 1] * cy + vertices[a * 3 + 2] * cz);
    let ez = vertices[a * 3 + 2] - cz * (vertices[a * 3] * cx + vertices[a * 3 + 1] * cy + vertices[a * 3 + 2] * cz);
    const elen = Math.sqrt(ex * ex + ey * ey + ez * ez);
    ex /= elen; ey /= elen; ez /= elen;
    faceEast[i * 3] = ex;
    faceEast[i * 3 + 1] = ey;
    faceEast[i * 3 + 2] = ez;
    // The first edge, which lies in the face's plane because both its ends do.
    let lx = vertices[b * 3] - vertices[a * 3];
    let ly = vertices[b * 3 + 1] - vertices[a * 3 + 1];
    let lz = vertices[b * 3 + 2] - vertices[a * 3 + 2];
    const llen = Math.sqrt(lx * lx + ly * ly + lz * lz);
    faceLatticeDir[i * 3] = lx / llen;
    faceLatticeDir[i * 3 + 1] = ly / llen;
    faceLatticeDir[i * 3 + 2] = lz / llen;

    // North completes the right-handed frame.
    faceNorth[i * 3] = cy * ez - cz * ey;
    faceNorth[i * 3 + 1] = cz * ex - cx * ez;
    faceNorth[i * 3 + 2] = cx * ey - cy * ex;
  }

  const a0 = faceVertices[0];
  const cosR = Math.min(1,
    vertices[a0 * 3] * faceCentres[0]
    + vertices[a0 * 3 + 1] * faceCentres[1]
    + vertices[a0 * 3 + 2] * faceCentres[2]);
  FACE_RADIUS_RAD = Math.acos(cosR);
  // From the dot product rather than from the angle: tan = sin/cos, and sin
  // is a square root away from cos. Math.tan is banned in sim/ because it is
  // not pinned by IEEE 754 and two platforms may disagree in the last bits --
  // and this number scales every position on every face, so a disagreement
  // here would be a different planet rather than a rounding difference.
  faceRadiusTan = Math.sqrt(1 - cosR * cosR) / cosR;
}

function dist2(a: number, b: number): number {
  const dx = vertices[a * 3] - vertices[b * 3];
  const dy = vertices[a * 3 + 1] - vertices[b * 3 + 1];
  const dz = vertices[a * 3 + 2] - vertices[b * 3 + 2];
  return dx * dx + dy * dy + dz * dz;
}

/**
 * Which face a direction belongs to: the one whose centre it is nearest.
 *
 * Nearest-centre and "inside the face's spherical triangle" are the same
 * region here, and that is a property of the solid rather than an
 * approximation: the twenty face centres are symmetric under the icosahedral
 * group, so their Voronoi cells on the sphere are the twenty spherical
 * triangles themselves. verify_icosa checks it by walking the edges.
 */
export function faceOf(x: number, y: number, z: number): number {
  let best = 0;
  let bestDot = -Infinity;
  for (let f = 0; f < FACE_COUNT; f++) {
    const d = x * faceCentres[f * 3] + y * faceCentres[f * 3 + 1] + z * faceCentres[f * 3 + 2];
    if (d > bestDot) { bestDot = d; best = f; }
  }
  return best;
}

/**
 * A direction to plane coordinates on a face, gnomonically.
 *
 * GNOMONIC, which is to say straight lines. The projection is the one that
 * sends every great circle to a straight line, and that is the property the
 * whole construction needs: the edges of a face are great-circle arcs, so they
 * come out as the three straight sides of a triangle, and a triangular lattice
 * drawn inside that triangle continues across an edge onto the next face
 * instead of bending at it. No other projection does that.
 *
 * What it costs is area. A gnomonic face stretches away from its centre, so a
 * lattice of equal planar cells is NOT a set of equal spherical cells, and the
 * corners of a face carry the worst of it. verify_icosa measures how much;
 * if it is too much, the fix is a radial correction that trades the straight
 * lines for equal areas, and it goes here, behind this same signature.
 *
 * Units: a face's vertices sit at radius 1, so the face is the unit triangle.
 */
export function toFace(face: number, x: number, y: number, z: number): { u: number; v: number } {
  const cx = faceCentres[face * 3], cy = faceCentres[face * 3 + 1], cz = faceCentres[face * 3 + 2];
  const along = x * cx + y * cy + z * cz;
  // Behind the face's plane: there is no gnomonic image. Callers ask about
  // their own face, where this cannot happen.
  if (along <= 1e-12) return { u: NaN, v: NaN };
  const px = x / along - cx;
  const py = y / along - cy;
  const pz = z / along - cz;
  const s = 1 / faceRadiusTan;
  return {
    u: (px * faceEast[face * 3] + py * faceEast[face * 3 + 1] + pz * faceEast[face * 3 + 2]) * s,
    v: (px * faceNorth[face * 3] + py * faceNorth[face * 3 + 1] + pz * faceNorth[face * 3 + 2]) * s,
  };
}

/** Plane coordinates on a face back to a direction. The exact inverse. */
export function fromFace(face: number, u: number, v: number, out: Float64Array, at: number): void {
  const s = faceRadiusTan;
  const x = faceCentres[face * 3] + s * (u * faceEast[face * 3] + v * faceNorth[face * 3]);
  const y = faceCentres[face * 3 + 1] + s * (u * faceEast[face * 3 + 1] + v * faceNorth[face * 3 + 1]);
  const z = faceCentres[face * 3 + 2] + s * (u * faceEast[face * 3 + 2] + v * faceNorth[face * 3 + 2]);
  const len = Math.sqrt(x * x + y * y + z * z);
  out[at] = x / len;
  out[at + 1] = y / len;
  out[at + 2] = z / len;
}
