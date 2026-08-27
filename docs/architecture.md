# Architecture

## The claim this all rests on

A trillion tiles cannot be stored, so they are not stored.

A ground tile's biome, soil, ore, timber and game are a **pure function of the
world seed and the tile's address**. Nothing is written down until a player
changes something, and then only the change is written. An untouched tile
occupies zero bytes and takes about four function calls to produce when
somebody finally looks at it.

Every other decision in this document falls out of that one.

## The layers

A cell's address is the path taken to reach it: which region, then which realm
inside it, then which patch of ground inside that. `[4821, 3307, 9912]`. The
path **is** the identity — there is no id table, no allocation, no row that has
to exist before a tile does.

| Layer | Cells | Across | Area | What it carries |
|---|---|---|---|---|
| 0 Region | 10,242 | 277 km | 49,800 km² | plates, elevation, climate, biome |
| 1 Realm | ×9,919 | 2.8 km | 4.98 km² | relief, drainage, kingdom borders |
| 2 Ground | ×9,919 | 28 m | 506 m² | soil, ore, flora, fauna, people, buildings |
| 3 Plot | ×9,919 | 28 cm | 0.05 m² | building interiors |

Layer 2 is where the game is played: **1,007,675,157,762 tiles**, each a
generous building plot.

## Why the top layer is a sphere and the rest are not

**You cannot tile a sphere with hexagons.** Euler's formula forbids it: for any
polyhedron `V - E + F = 2`, and if every face had six sides that reduces to
`2 = 0`. Any hex-covered sphere needs exactly twelve pentagons, however many
hexagons you add. Every hex-globe game has them.

Ours are the twelve vertices of the icosahedron the globe is subdivided from,
and they are cells 0–11 so that `isPentagon` is an integer comparison. The
globe is a Goldberg polyhedron GP(32,0): 10,230 hexagons and 12 pentagons,
which is the closest this construction comes to the 10,000 regions the design
called for.

We never build the Goldberg polyhedron directly. A Goldberg polyhedron is the
*dual* of a geodesic sphere, so its cells correspond one-for-one to the
geodesic's **vertices** — subdivide an icosahedron five times and the 10,242
vertices that fall out are the 10,242 cell centres. Adjacency is geodesic edge
adjacency; a cell's outline is the ring of triangle centroids around its vertex.

**Below the globe, everything is flat.** A region is 277 km across, and over
that span the Earth's curvature distorts a flat projection by about 0.06% —
less than the rounding in any number the economy uses. So layers 1 and above
are ordinary flat hex fields: no pentagons, no seams, no projection, exact
arithmetic. **The pentagon problem exists on exactly one layer and never
propagates downward.** That is worth more than it sounds.

A sub-map is a hexagon of hexagons of radius 57, which is `3r² + 3r + 1` =
9,919 cells — 0.8% under ten thousand. A 100×100 rhombus would have been
exactly ten thousand and would have nested badly: a diamond floating inside a
hexagon, with ragged corners. A hexagon of hexagons nests the way the eye
expects.

## Generation cascades downward

Tectonics decide where the mountains are. Mountains and latitude decide the
climate. Climate decides the vegetation. Each step reads only from the steps
above it.

This ordering is the whole reason the world looks like *somewhere* rather than
like noise. The Atacama is dry because it sits behind the Andes — and you
cannot express that if you generate rainfall before you generate relief.

Cost to open any tile is O(depth): four generator calls, each of which needs
only its ancestors. Sub-maps are generated a whole map at a time rather than a
tile at a time, because relief and drainage need neighbours; 9,919 cells is a
few milliseconds and it is then cached.

The one exception to generate-on-demand is layer 0, which is built whole. Plate
boundaries, sea level and distance-to-ocean are *global* properties — you
cannot know whether a cell is coastal by looking only at that cell. Ten
thousand cells is nothing.

## Simulation and renderer are separate programs

`sim/` owns everything true about the world and has never heard of a pixel. It
must not touch the DOM, the network, the clock, or `Math.random`. `client/`
draws pictures of it and sends back what was clicked. `server/` runs the same
`sim/` with no screen attached.

This costs almost nothing on day one and is close to impossible to retrofit.
Three things fall out of it: the server is the simulation running somewhere
else, so multiplayer is a move rather than a rewrite; testing becomes
measurement, because the suites can run the world headless; and the renderer
becomes replaceable.

## The turn model

Two minutes of real time is one game-week. Turns resolve **simultaneously** and
the server is authoritative — this is not a lockstep RTS, and the determinism
machinery here is not for keeping clients in step. It is for something harder:
**a persistent world can never be regenerated differently.** If a player's city
sits on a hill, that hill must still be there after a server restart, a Node
upgrade, new hardware and a rewritten renderer. See `docs/determinism.md`.

## Where things live

```
sim/          the world. no DOM, no clock, no randomness that is not seeded.
  anchors.ts    measured reality. nothing here is a design choice.
  derive.ts     every game number, solved from anchors.
  fixed.ts      exact integer arithmetic for the economy.
  angle.ts      integer angles, from a baked table.
  rng.ts        seeded streams. there is deliberately no global one.
  hash.ts       state fingerprints.
  geo/          sphere, sub-map grid, addressing.
  gen/          noise, deterministic transcendentals, the planet generator.
  model/        biome classification, tiles, and what lives on them.
server/       the turn loop, persistence, the wire protocol.
client/       canvas, input, the zoom through the layers.
verify/       suites and the measurement baseline.
tools/        the table baker. run when an anchor changes.
```
