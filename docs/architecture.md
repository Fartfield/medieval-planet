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

A cell's address is the path taken to reach it: which region, then which cell
inside it, and so on down. `[8, 34, 20, 54, 41, 46]`. The path **is** the
identity — there is no id table, no allocation, no row that has to exist before
a tile does.

Every layer is a "10 by 10" hexagon of hexagons. Hexagonal numbers go
`3r² + 3r + 1`, so r=5 gives **91 cells** — nine per cent under a hundred, and
the nearest a hexagon of hexagons comes. The globe is a Goldberg polyhedron of
frequency 3: **92 cells**, 80 hexagons and the 12 pentagons a sphere cannot
avoid.

| Layer | Area | Across | Cells in the world | What it is |
|---|---|---|---|---|
| 0 region | 5,544,179 km² | 2,922 km | 92 | the world map |
| 1 march | 60,925 km² | 306 km | 8,372 | what a kingdom might hold |
| 2 shire | 670 km² | 32 km | 761,852 | where borders get drawn |
| 3 hundred | 7.36 km² | 3.4 km | 69.3 M | a day's walk across |
| 4 parish | 8.09 ha | 353 m | 6.31 G | a manor and its fields |
| **5 plot** | **888 m²** | **37 m** | **574 G** | **the game is played here** |
| 6 yard | 9.76 m² | 3.9 m | 52.2 T | a building, a room |
| 7 pace | 0.107 m² | 41 cm | 4.75 P | where a person stands |

**574 billion plots**, and 4.75 quadrillion cells at the finest layer. Layer 5
is where settlements stand; 6 and 7 are generated ground with no economy on
them yet.

`GROUND_DEPTH` in `geo/address.ts` names layer 5 so that nothing has to write
a bare number. It has moved once already and was hardcoded in nine files when
it did.

### What the coarse globe costs

**One region in eight is a pentagon.** The twelve are a fixed toll a sphere
charges regardless of resolution, so at 92 regions they are 13% of the world
map rather than the 0.12% they were at 10,242.

**A third of every sub-map is rim.** A radius-5 hexagon has 30 edge cells out
of 91, against 3.4% at radius 57. Anything computed from neighbours — slope,
and drainage above all — is much coarser, and a river network over 91 cells is
crude.

**A 2,900 km cell cannot resolve a mountain range.** Uplift smearing is scaled
to a real distance now rather than a number of passes, and at this resolution
that works out to no smearing at all, which is the honest answer.

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
geodesic's **vertices** — cut each icosahedron edge into three, and the 92
vertices that fall out are the 92 cell centres. Adjacency is geodesic edge
adjacency; a cell's outline is the ring of triangle centroids around its vertex.

The subdivision takes an arbitrary frequency rather than repeated halving.
Halving is simpler but can only produce 12, 42, 162, 642, 2562 or 10242 cells,
and the design asks for a hundred.

**Below the globe, everything is flat.** Curvature over one sub-map is far
below the rounding in any number the economy uses, so layers 1 and below are
ordinary flat hex fields: no pentagons, no seams, no projection, exact
arithmetic. **The pentagon problem exists on exactly one layer and never
propagates downward.** That is worth more than it sounds.

A rhombus of hexes would nest badly — a diamond floating inside a hexagon, with
ragged corners. A hexagon of hexagons nests the way the eye expects.

## Generation cascades downward

Tectonics decide where the mountains are. Mountains and latitude decide the
climate. Climate decides the vegetation. Each step reads only from the steps
above it.

This ordering is the whole reason the world looks like *somewhere* rather than
like noise. The Atacama is dry because it sits behind the Andes — and you
cannot express that if you generate rainfall before you generate relief.

Cost to open any tile is O(depth): eight generator calls, each of which needs
only its ancestors — and each is 91 cells rather than 9,919, so opening a tile
got *faster* when the ladder got deeper. Two milliseconds against a hundred
and fifty. Sub-maps are generated a whole map at a time rather than a
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
  geo/          sphere, sub-map grid, addressing, GROUND_DEPTH.
  gen/          noise, deterministic transcendentals, the planet generator.
  model/        biome, soil, resources, labour, supply, settlements, trade,
                polity.
  economy.ts    one week: produce, trade, consume, decide.
  expansion.ts  who spreads where, and where kingdoms come from.
server/       the turn loop, persistence, the wire protocol.
client/       canvas, input, the zoom through the layers.
verify/       suites and the measurement baseline.
tools/        the table baker. run when an anchor changes.
```
