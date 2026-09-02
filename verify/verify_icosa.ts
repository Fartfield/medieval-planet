// The icosahedron, and whether the projection onto its faces is sound enough
// to build a world grid on.
//
// This is the foundation of the replacement for the per-region patch grid, and
// nothing else depends on it yet. That is deliberate: the projection has to be
// exactly invertible and the faces have to partition the sphere before there is
// any point laying a lattice on them, and both of those are measurable now.
//
// The one thing that is NOT settled here is area. A gnomonic face sends great
// circles to straight lines -- which is the property the lattice needs, since a
// face's edges must come out straight for a lattice to continue across them --
// and it stretches away from the face centre while doing it. How much is
// measured below rather than argued about, because it decides whether the next
// phase can use this projection or has to trade the straight lines for equal
// areas.

import {
  VERTEX_COUNT, FACE_COUNT, FACE_RADIUS_RAD,
  vertices, faceVertices, faceCentres, faceOf, toFace, fromFace,
} from '../sim/geo/icosa.ts';
import { check, measure, assert, suite } from './harness.ts';

const dot = (a: Float64Array, i: number, x: number, y: number, z: number): number =>
  a[i * 3] * x + a[i * 3 + 1] * y + a[i * 3 + 2] * z;

suite('the icosahedron', () => {
  // THE SOLID ITSELF. Twenty faces found by joining vertices at the shortest
  // distance the solid has, rather than typed in as a table of triples -- so
  // the count is a result and not a promise.
  measure('vertices', VERTEX_COUNT);
  measure('faces', FACE_COUNT);

  // Every vertex is on the sphere, and every one has exactly five neighbours,
  // which is what makes the twelve of them the pentagons of any grid built on
  // this. Euler's minimum, and the same twelve the grid it replaces has.
  let worstLen = 0;
  const around = new Int32Array(VERTEX_COUNT);
  for (let v = 0; v < VERTEX_COUNT; v++) {
    worstLen = Math.max(worstLen, Math.abs(Math.hypot(
      vertices[v * 3], vertices[v * 3 + 1], vertices[v * 3 + 2]) - 1));
  }
  for (let f = 0; f < FACE_COUNT; f++) {
    for (let i = 0; i < 3; i++) around[faceVertices[f * 3 + i]]++;
  }
  measure('worst vertex length error', worstLen);
  check('the vertices are on the sphere', worstLen, 0, 1e-12);
  assert('and five faces meet at each of them',
    Array.from(around).every((n) => n === 5));

  // The faces are regular and identical: same centre-to-vertex angle
  // everywhere, or the lattice would need a different scale on each one.
  let minR = Infinity;
  let maxR = 0;
  for (let f = 0; f < FACE_COUNT; f++) {
    for (let i = 0; i < 3; i++) {
      const v = faceVertices[f * 3 + i];
      const a = Math.acos(Math.min(1, dot(faceCentres, f,
        vertices[v * 3], vertices[v * 3 + 1], vertices[v * 3 + 2])));
      minR = Math.min(minR, a);
      maxR = Math.max(maxR, a);
    }
  }
  measure('face radius, degrees', (FACE_RADIUS_RAD * 180) / Math.PI);
  measure('face radius spread, degrees', ((maxR - minR) * 180) / Math.PI);
  check('every face is the same size', maxR - minR, 0, 1e-12);

  // THE FACES PARTITION THE SPHERE. Nearest-face-centre and inside-the-face
  // are claimed to be the same region; this walks a great many directions and
  // checks each one lands on a face whose three vertices are all closer to it
  // than any other face's are. A direction belonging to two faces, or to none,
  // would put a cell in two places at once.
  let wrongFace = 0;
  let sampled = 0;
  const dir = new Float64Array(3);
  for (let i = 0; i < 4000; i++) {
    // A deterministic spiral, so this is the same set of directions every run.
    const t = (i + 0.5) / 4000;
    const y = 1 - 2 * t;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const a = i * 2.399963229728653;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    const f = faceOf(x, y, z);
    sampled++;

    // Inside its own face, the gnomonic image must be inside the unit
    // triangle: all three barycentric weights non-negative.
    const p = toFace(f, x, y, z);
    if (!Number.isFinite(p.u) || !Number.isFinite(p.v)) { wrongFace++; continue; }
    // The face's three vertices in plane coordinates, at radius 1.
    let inside = true;
    for (let k = 0; k < 3; k++) {
      const th = (k * 2 * Math.PI) / 3;
      // Distance from the edge opposite this vertex; the triangle's inradius
      // is 1/2 in these units, so a point inside satisfies this for all three.
      const d = p.u * Math.cos(th) + p.v * Math.sin(th);
      if (d > 1 + 1e-9) inside = false;
    }
    if (!inside) wrongFace++;
  }
  measure('directions sampled', sampled);
  measure('directions outside the face they were given', wrongFace);
  check('every direction lands inside its own face', wrongFace, 0, 0);

  // THE PROJECTION IS EXACTLY INVERTIBLE, which everything above this file
  // will assume. A direction to plane coordinates and back has to return the
  // direction it started from, not one near it -- a sub-map's whole layout is
  // one of these round trips per cell.
  let worstTrip = 0;
  const back = new Float64Array(3);
  for (let i = 0; i < 4000; i++) {
    const t = (i + 0.5) / 4000;
    const y = 1 - 2 * t;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const a = i * 2.399963229728653;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    const f = faceOf(x, y, z);
    const p = toFace(f, x, y, z);
    fromFace(f, p.u, p.v, back, 0);
    // As a CHORD, not as an angle. acos is ill-conditioned near zero -- it
    // turns a dot product wrong in its last bit into an angle of 1.4e-8, so
    // the first version of this check measured its own precision floor and
    // reported an exact round trip as a 16 cm error. The chord is the same
    // quantity asked in a way that survives being small.
    worstTrip = Math.max(worstTrip,
      Math.hypot(back[0] - x, back[1] - y, back[2] - z));
  }
  measure('worst round trip, chord', worstTrip);
  check('sphere to face to sphere returns where it started', worstTrip, 0, 1e-12);

  // AREA, which is the number that decides the next phase.
  //
  // A lattice of equal cells in the plane is a set of equal cells on the
  // sphere only if the projection preserves area, and gnomonic does not: it
  // stretches away from the face centre. Measured as the ratio between the
  // largest and smallest spherical area a small planar square maps to, over
  // the face.
  //
  // The grid this replaces holds cell areas to a few percent, so this is the
  // standard to beat or to knowingly give up. If it is bad, the fix is a
  // radial correction behind the same signature, trading the straight lines
  // for equal areas -- Snyder's projection, which is what the ISEA grids use.
  const EPS = 1e-4;
  let minJ = Infinity;
  let maxJ = 0;
  const p0 = new Float64Array(3);
  const pu = new Float64Array(3);
  const pv = new Float64Array(3);
  for (let iu = -20; iu <= 20; iu++) {
    for (let iv = -20; iv <= 20; iv++) {
      const u = iu / 22;
      const v = iv / 22;
      // Inside the unit triangle only.
      let inside = true;
      for (let k = 0; k < 3; k++) {
        const th = (k * 2 * Math.PI) / 3;
        if (u * Math.cos(th) + v * Math.sin(th) > 1) inside = false;
      }
      if (!inside) continue;
      fromFace(0, u, v, p0, 0);
      fromFace(0, u + EPS, v, pu, 0);
      fromFace(0, u, v + EPS, pv, 0);
      // The area a unit planar square covers on the sphere: |du x dv|.
      const ax = pu[0] - p0[0], ay = pu[1] - p0[1], az = pu[2] - p0[2];
      const bx = pv[0] - p0[0], by = pv[1] - p0[1], bz = pv[2] - p0[2];
      const cxx = ay * bz - az * by;
      const cyy = az * bx - ax * bz;
      const czz = ax * by - ay * bx;
      const j = Math.hypot(cxx, cyy, czz) / (EPS * EPS);
      minJ = Math.min(minJ, j);
      maxJ = Math.max(maxJ, j);
    }
  }
  const spread = maxJ / minJ;
  measure('area stretch, largest over smallest', spread);
  // Recorded, not enforced. This is the measurement the next phase is chosen
  // from, and a threshold here would be a decision taken by a test rather than
  // by a person.
  assert('the projection does not fold or tear', minJ > 0 && Number.isFinite(spread));
});
