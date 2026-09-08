# Known gaps

Things deliberately not done. Do not fix them incidentally — each is here with
a reason, and several are waiting on information we do not have yet.

## World generation

**The climate model is fitted, not physical.** Temperature is a cubic in
sin²(latitude) fitted to observed zonal means; rainfall is two Gaussian bands
with three corrections. A real energy-balance model with moisture transport
would replace both. The fit is good enough that land cover matches Earth to
within 2.6 points, and until something needs seasons or interannual variation
that is enough.

**The moisture-capacity term is linear in temperature.** It stands in for the
Clausius-Clapeyron relation, which is exponential. Replacing it is cheap; it has
not been done because the calibration currently absorbs the difference.

**This world's high-latitude land is mountainous, so it grows tundra where
Earth grows taiga.** Tundra and ice are 0.085 of the land against a derived
0.025, and the cause is not the climate model or the treeline rule. Both check
out: correcting for altitude at the standard 6.5 C/km lapse rate, the model
tracks Earth's land temperatures within +3.5 to -2.8 C across four latitude
bands, and the treeline is Koppen's 10 C warmest month.

    band     mean elev   ours    at sea level   Earth land
    35-45      575 m     11.7 C      15.5 C        12 C
    45-55      883 m      2.2 C       8.0 C         6 C
    55-60      801 m     -4.4 C       0.8 C         1 C
    60-65      737 m     -8.6 C      -3.8 C        -1 C

Land above 55 degrees averages 800 m here against roughly 300 on Earth. Five
hundred metres is 3.3 C, which is the whole difference between taiga and tundra
at that latitude. The comparison target was derived from Earth's land cover
without accounting for the elevation this world's land actually sits at, so it
asks for a warmer high latitude than this planet has.

Nothing is wrong. What would fix the number is either comparing against Earth's
tundra share at THIS elevation profile, which is a derivation nobody has done,
or arranging for the tectonics to put less mountain at high latitude, which
would be choosing the answer.

**No seasons.** Everything is an annual mean, with the seasonal swing inferred
where a classification boundary needs it. A game with two-minute weeks will
eventually want real seasons, and that is a layer-1 concern.

**The world is smooth in the middle, and the cause is now measured.** At 132 m
cells over 40 maps the median land slope is 0.77 degrees against Earth's
roughly 2. The old entry here blamed the ladder for inheriting the mesh's
resolution and prescribed re-anchoring the detail amplitude to a measured local
relief. That premise is wrong: converted to a ten-kilometre baseline the mesh's
own relief already matches the anchors at both ends -- 22 m against a measured
plain of 18, and 917 m against a measured mountain of 900, over 143,489 land
cells. There was nothing to re-anchor.

What is actually happening is that `detailAmp` is a noise amplitude used as
though it were a relief. Measured over 34,848 samples, `fbm3` at the ladder's
own geometry realises 0.349 of its nominal amplitude as local relief, and its
value range is -0.52 to 0.53 rather than -1 to 1. The ladder therefore delivers
about two thirds of the law at every scale -- 0.50 to 0.74 down six layers,
0.525 at the median over ordinary ground, the same for gentle and rolling
terrain.

Three fixes have been tried and all are struck through in fix-attempts.md.
Dividing by the measured response lands the direct Earth comparison exactly and
breaks self-affinity. A derived quadrature taper does the same. Closing the
spectral hole underneath it -- the first sub-map was coarser than the physics
mesh, so the 34-112 km band was discarded -- was worth doing and IS done, but
it moved the implied Hurst by seventeen millionths under the taper, so it was
not the cause either.

**What the measurements now say the blocker is.** The taper's overshoot grows
with depth -- 0.844, 1.279, 1.729, 1.591, 1.757 down the ladder -- and that
growth is the loss of self-affinity itself. The detail calculation is
OPEN-LOOP: it computes what the base ought to be carrying, from the mesh's
relief scaled by the Hurst exponent, and never looks at what the base actually
has, so a layer that comes out above target is built on by a layer that still
adds its full nominal share. The error accumulates instead of correcting.

Closing that loop means measuring the base's real relief, which is exactly the
per-map measurement submap.ts rejects because two neighbouring maps measure
different numbers and disagree along the edge they share. The trade is real:
continuity buys an open loop. A third attempt has to break the trade -- a
base-relief measurement that is a continuous FIELD, sampled the way reliefM is
-- rather than tune inside it.

What survives from the attempts is `FBM_LOCAL_RELIEF_RESPONSE` in noise.ts,
measured and policed by verify_noise.ts: fbm3 delivers 0.349 of its nominal
amplitude as local relief, which any future attempt needs.

Three things that do NOT move it, measured, so the next attempt can skip them:
raising MESH_RELIEF_M (900 to 2700 gives 0.13 to 0.22 at the mesh's own scale,
because solveSeaLevel scales the extra straight back out to keep mean land
elevation at 840 m), cutting MESH_CREEP (0.18 to 0.02 gives 0.13 to 0.20), and
reducing the noise's inner octaves (3 to 1 changes nothing at all).

**Neighbouring maps' tiles interleave along a seam.** A hexagon of 91 hexagons
covers about 91% of the hexagon holding it, so the children of two adjacent
parents do not meet edge to edge -- they overlap. Measured: a tile three rings
from a map's rim picks up a tile of the next map 0.76 cell-spacings away, nearer
than its own lattice neighbours at 1.00, and the intrusion reaches about two
rings in before it stops.

    ring from centre   neighbours
    0 to 2             6 always
    3                  6, sometimes 7
    4                  6 to 10
    5 (the rim)        4 to 10

`World.neighboursOf` reports this honestly rather than forcing six: adjacency is
defined by DISTANCE, so it is symmetric, and a tile on a seam simply has more
neighbours than one in the middle. For a road or a border that is the truth of
the terrain rather than an inconvenience.

What would remove it is a sub-map whose children tile their parent exactly, and
no hexagon of hexagons does -- the stepped edge is inherent. It is recorded
because anything measuring "how many neighbours does a tile have" will meet it.

## Simulation

**No roads and no terrain cost.** A cart track is assumed passable between any
two land tiles, which is generous — real terrain has bogs and gorges. It is the
optimistic assumption, so settlements read as slightly better supplied than
they should.

**No backhaul.** Long-distance trade is cheaper than the model says, because a
cart on an established route carries something back rather than returning
empty. The round-trip figure is right for a settlement fetching its own crop
and pessimistic for trade.

**No river topology.** Water haulage is used when both ends can take a boat,
which lets two settlements on *different* rivers barge to each other. Generous
in the same direction as the missing roads. The fix needs the cross-boundary
work first.

**Only two goods move.** Grain and iron. Timber, stone, salt, clay and cloth
are all already generated on the map and none of them are traded.

**No prices and no money.** Deliberate so far — transport cost is denominated
in the cargo itself, so none was needed. It will be needed the moment a third
good competes with a second for the same hands.

**Everybody trades with everybody.** No alliances, no embargoes, no refusing to
sell to an enemy. That arrives with Houses.

**Migration comes from nowhere, and emigration goes nowhere.** People arrive
at a settlement with a surplus and leave one with no work, both at 8% a year,
both to and from an unmodelled elsewhere. The two are symmetric so the world
neither invents nor destroys people on average, but it does not conserve them
exactly, and it should. Replace both with migration between real settlements.

**Nothing consumes timber but ironworking.** No building, no fuel for heating,
no shipbuilding. A town's woods are therefore larger than they should be.

**Harvest is averaged across the year.** `weeklyGrainKg` divides an annual
yield by 52. Real grain arrives once, and the whole shape of a medieval year is
about storing it and not running out before the next one. Averaging makes
famine a slow slide rather than a cliff in March, which is the wrong shape. The
first thing seasons will fix.

**No buildings, no crafts, no NPC-driven development.** The design has half a
town's growth driven by its own people choosing trades. None of it exists —
population is a single number with no occupations in it.

**No frontiersman and no attendants.** The player is a polity that owns tiles.
The character with four assignable attendants that the design opens with is not
built.

**No conflict.** Two kingdoms that meet simply stop expanding.
`Polity.tributaryTo` exists and nothing ever sets it. Invasion, conquest,
concession and tribute are the next system, and the pieces are already here:
fighting men spared from the fields, iron for their equipment, and grain to
keep them in the field.

**No NPC kingdoms before you arrive.** The world starts empty and fills only
from where a player plants. Kingdoms that already exist need settlements
generated at their equilibrium for a realm nobody has visited -- the same
generate-don't-store trick one layer up. See [kingdoms.md](kingdoms.md).

**Nothing ever has a bad year.** The insurance a village plants against one is
therefore never spent, so granaries fill to the spoilage ceiling and sit there.
Same root as the missing seasons.

**Houses are a number that colours a border.** No heads of household, no
alliances, no representation on the map beyond the colour.

**Players are identified by name.** Rejoining by name is enough to play with
and not enough for anything else.

## Infrastructure

**The mosaic is one layer only, by design, but that is also its limit.** A
region shows its 91 children and nothing finer, so zooming the globe never
reveals more detail — you have to descend. Two layers of mosaic would look
better and cost 91 times as much.

**No spatial index on the delta store.** "Which changed tiles are inside this
region" is a prefix scan over string keys today. Fine at small numbers, not
fine at a million.

**The WebSocket implementation is hand-rolled.** No compression, no
fragmentation on send, no backpressure. Fine for a few players on a LAN;
replace it with `ws` before it faces anything else.

**No spatial index for "which settlements are near this one".** Supply lines
will want one immediately.


## Plants are drawn at one layer only

Measured with `verify/check_client.ts`, which now counts stamped plants per
layer:

    world view   0      layer 3   0      layer 6   0
    layer 1      0      layer 4   0      layer 7   0  (flat, no mosaic)
    layer 2      0      layer 5   2,795

Layer 5 is right. Layer 4 and above are right too -- at the parish layer there
would be twenty-six thousand plants on screen and the density tint says the
same thing more cheaply. **Layers 6 and 7 are the gap**, and the cause is
precise:

A plant is drawn by the tile that holds its STEM. At layer 6 a tile is about
0.2 m across, so it holds 0.0000006 of an oak, and the stems that would cover
your view are on ground outside the visible map entirely -- an oak's crown is
eighteen metres and the whole layer-6 view is two. So the trees do not fail to
be generated; they fail to be *found*, because the search grid is the tile
ladder and the tile ladder is ninety times finer than a crown down there.

It also explains why the draw budget is a knife edge (see `DRAW_BUDGET`): one
layer at a time falls inside it, and there is no layer below where the same
trees persist and simply get bigger.

**The fix is a lattice of about one crown per cell**, anchored to the region
rather than to whichever map is being drawn, sampled over the visible rectangle
extended by a crown radius. Then the same wood is generated at every depth and
descending shows it getting nearer -- which is the argument `floraColour`
already makes in the renderer about the canopy field, applied to the plants
themselves. It needs the region's basis passed down, so it is a change to
`drawSubMap`'s signature and to `main.ts`, not a local edit.
