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

## Why the top layer has no pentagons

It used to have twelve, because it was a Goldberg polyhedron and a Goldberg
polyhedron cannot have any other number. That is Euler, not a choice: with
three faces meeting at each vertex, F hexagons give E = 3F edges and V = 2F
vertices, so V − E + F = 0 where a closed surface of genus zero requires 2.
Admit pentagons and the same arithmetic returns **P = 12 exactly**, whatever H
is. A football has twelve however many hexagons are sewn around them.

At 92 cells the twelve were 13% of the world map — one region in eight — and
the highest-variance thing on screen.

**So the tiling changed. A hex grid that wraps east to west has no pentagons at
all**, because a cylinder's Euler characteristic is zero rather than two.

### The projection is the whole trick

The grid is laid out in (longitude, sine of latitude) — the Lambert cylindrical
projection — and **Lambert is equal-area**. The area element on a sphere is
`cos(lat)·dlat·dlon`, and `d(sin lat) = cos(lat)·dlat`, so equal area in the
grid is exactly equal area on the sphere. Not approximately.

That is what makes it a change of tiling rather than a rewrite. Cells are still
points on the unit sphere, still equal-area, still measured with great-circle
distances — so tangent frames, sub-maps, catchments, supply ranges and every
calibrated number below this layer are untouched. Only which points are cell
centres changed.

### What it costs

**The poles are not gridded.** The band runs to 65.05°, which is the polar
circle to within a degree and a half, and beyond it are two ice caps that are
not cells. Twelve pentagons became two ice caps: the defects moved from twelve
places scattered through the temperate world to the two places nobody farms.

**Cells stretch towards the poles.** Equal area guarantees the area and says
nothing about the shape, so a cell at ±52° is 2.7 times taller than it is wide.
That is the distortion every cylindrical map has, and it lands on the rows
least likely to be looked at. It is a *metric* distortion rather than a
*topological* one, which is the important difference: the cells still tessellate
exactly, every corner still shared, no cell has five neighbours.

**Twenty-four by eight, and eight rows is not negotiable.** Six rows was closer
to the old cell count and too coarse to hold a climate: one band lands squarely
on the subtropical desert belt and the world comes out 33.3% desert — which is
exactly two rows in six, and the giveaway. Eight rows straddle the belt.

| | Goldberg globe | wrapped band |
|---|---|---|
| cells | 92 | 192 |
| pentagons | 12 (13%) | **0** |
| cell shape | near-regular | up to 2.7:1 at ±52° |
| poles | gridded | ice caps, ungridded |
| region | 5.54M km² | 2.41M km² |
| plot layer | 888 m² | 386 m² |

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

## Detail, one layer at a time

Every hex is painted as a **mosaic of its own children, and no further**.

A region on the world map is not a flat colour; it is its 91 sub-cells drawn in
their real positions. That gives the globe a coastline, a mountain range, the
edge of a desert — genuine terrain rather than an average — and it costs one
extra layer of generation, not seven.

The "no further" is the whole point. A globe that recursed would end up asking
for all 4.75 quadrillion cells to draw twelve hexagons, which is exactly what
generate-on-demand exists to prevent. So the renderer takes a `ChildLookup`
that returns one layer down, and calls it once per visible cell.

Three things make it behave:

* **The parent is filled first, underneath.** A hexagon of hexagons has stepped
  edges and does not quite tile a hexagon, so without the fill behind it the
  background would show through the steps.
* **Below 26 pixels a cell is painted flat.** A mosaic of 91 shapes inside
  something 24 pixels wide is invisible and ninety times the drawing.
* **Returning null is always safe.** That is what happens at the finest layer,
  where a cell has no children at all.

On the globe the children carry real positions on the sphere and are projected
exactly as their parent was. On a flat sub-map they lay out as their own hex
grid centred on the parent, so their positions are exact in local coordinates
with no projection at all.

Measured: a globe goes from 15 shapes to 1,179, asking 14 regions for children
once each. A sub-map draws 8,281 mosaic tiles.

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
