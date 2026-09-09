# Fix attempts

One section per problem. Every attempt, and **the measurement that killed it**.

Read the section before touching the problem. Struck-through entries have been
tried; the number beside them is why they failed. Re-running one hoping for a
different answer is the specific waste this file exists to prevent.

Note explicitly when an attempt failed for a reason that has since changed,
because those are the ones worth revisiting.

---

## Biome distribution did not match Earth

**Problem.** The first generator produced 0.2% desert against Earth's 19% of
land, and 44.6% forest against 31%. A planet with no deserts on it.

* ~~Fit the zonal precipitation profile to observed zonal means.~~ **0.2%
  desert.** The published zonal mean at 30° is around 600 mm, and fitting to it
  gave a planet with essentially no arid land. The mistake was subtle: that
  600 mm is almost entirely *ocean*. The land sitting at 30° is the Sahara,
  Arabia, the Atacama, the Kalahari and the Australian interior. The model only
  ever evaluates precipitation over land, so the land profile is the honest
  target and the all-surface figure is the wrong one.

* ~~Refit the profile against land: raise the ITCZ peak, narrow both bands,
  drop the background from 200 mm to 70, strengthen continentality.~~ **4.1%
  desert, 44.6% forest.** Better but still nowhere near. Sweeping four
  parameters over sixteen combinations could not get desert above 8% without
  destroying the forest fraction — which is the signature of a problem that is
  not in the parameters at all.

* **Classify on the aridity index rather than on rainfall.** **Worked: total
  absolute error 0.266 → 0.068.** Absolute rainfall thresholds have no cold
  desert in them. Everything temperate and dry was becoming grassland, so the
  Gobi, the Great Basin, the Taklamakan and Patagonia — about a third of
  Earth's desert area — were all classified wrong. The UNEP aridity index is
  precipitation over potential evapotranspiration, so it asks how much water a
  place has relative to how fast it loses it. 200 mm is a desert at 25 °C and a
  wetland at 0 °C, and no single rainfall number can say that.

  Final: forest 32.0% (Earth 31), grass 27.9% (25), desert 19.3% (19),
  tundra and ice 17.4% (20).

**Still open.** Tundra and ice sit 2.6 points low. Not chased yet; it is within
the tolerance the suite asserts and the likeliest cause is that the seasonal
amplitude model is too crude near the poles.

---

## A rainforest was more fertile than a prairie

**Problem.** The first soil model derived fertility from productivity, less
what leaching carried away. It produced tropical rainforest 0.280 against
temperate grassland 0.275 -- backwards, and enough to make "settle in the
jungle" the correct opening move forever.

* ~~Fertility from net primary productivity, penalised by leaching.~~
  **Rainforest 0.280, grassland 0.275.** Leaching is real and necessary, but on
  its own it cannot overcome the raw productivity gap: a rainforest fixes three
  times what a prairie does, and a leaching penalty of 0.31 against 1.00 leaves
  it still ahead. Raising the leaching exponent to compensate drove taiga to
  0.002, which is not poor soil, it is no soil.

* **Add the two mechanisms that were missing.** **Worked.** Grassland 0.972,
  savanna 0.541, temperate forest 0.403, taiga 0.146, rainforest 0.128, tundra
  0.078, desert 0.031 -- Earth's ordering exactly, with the rainforest holding
  the *highest* productivity in the set at 2,466 g/m2/yr.

  * *Where the production goes.* Grasses put three quarters of what they make
    into roots that die back annually and become humus in place. A tree puts it
    into a trunk that stands two centuries. Root-to-shoot allocation is
    measured, and it is the dominant term.
  * *How fast it rots.* Q10 of 2 -- decomposition doubles per 10 degC. This is
    why boreal soils hold a third of the soil carbon on the planet.

**Also fixed here.** `leachingFraction` returned 1.0 on permanently frozen
ground, because potential evapotranspiration is zero there and the formula read
zero PET as infinite surplus -- declaring the Arctic the most heavily leached
soil on Earth. Frozen ground has no liquid water moving through it and leaches
nothing. Guarded.

**Also fixed here.** A short growing season cannot mineralise what the soil
holds, however much it holds -- tundra peat is nutrient-rich and useless.
Fertility now scales with biotemperature.

---

## Tin was commoner than copper

**Problem.** Tin is deliberately clustered into provinces, because on Earth it
comes out of granite intrusions and those come in provinces -- which is what
made the tin trade worth crossing Europe for. The multiplier was written as
`1 + 6 * province`.

* ~~Multiply tin's frequency by `1 + 6 * province`.~~ **Tin 0.32% against
  copper 0.30% worldwide**, where crustal abundance says copper should be about
  three times commoner. A term that is always at least 1 does not cluster a
  metal, it creates more of it.

* **Centre the multiplier on 1 rather than adding to it**: `0.10 + 2.70 *
  province`. Same 28-fold contrast between a province and the ground around it,
  global frequency back where abundance put it. Same correction applied to the
  placer-gold term, which had the same shape.

**Note for later.** The first version of the test that caught this sampled a
single ground map and was *wrong to fail* -- a map inside a tin province should
show more tin than copper. Metal rarity is a global claim and has to be sampled
globally. The test now walks 24 regions.

---

## A sub-map spacing test failed against correct code

* ~~Assert realm cell spacing is 2,780 m.~~ **Got 2,408 m.** The code was
  right. A hexagon has two widths: vertex-to-vertex is 2r, and flat-to-flat --
  which is also the centre-to-centre distance between neighbours -- is
  sqrt(3)*r, about 13% less. The docs quote "2.8 km across", meaning vertex to
  vertex; `spacingM` is the centre-to-centre figure the slope calculation
  needs. Both are now measured, and the test says which is which.

---

## Shrinking the map to 10x10 broke five things, and two were real

**Problem.** The world went from 10,242 regions of 9,919 cells to 92 regions of
91, with eight layers instead of four. Most of the fallout was stale constants
in tests. Two were genuine bugs the old resolution had been hiding.

* **Continentality was expressed per CELL.** A cell went from 277 km to
  2,530 km and the term became ten times too weak, so no continental interior
  was ever dry and forest cover came out at 44% against a target of 31%. It is
  per kilometre now, which is what it should always have been -- the physics
  does not care how the world is subdivided. Same for the uplift smearing,
  which is now scaled to the width of a real mountain range and at this
  resolution correctly does nothing at all.

* **`cellsWithin` descended one layer too far.** Addresses start at length one
  and each step adds a number, so reaching length L takes L-1 steps; it ran L.
  Every area query returned cells a whole layer too fine, generated an entire
  extra level of sub-maps -- a forty-year run took 126 seconds instead of nine
  -- and put the annulus filter on the wrong layer, so a founding party asked
  for somewhere 3.6 km out was handed the thousand tiles nearest its own door
  and told there was nowhere to go.

**And one that was not a bug but a setting.** The sub-map cache defaulted to 96
maps, sized for the old 9,919-cell maps. A catchment now touches over a hundred
maps plus every ancestor, so the cache thrashed and the expansion suite went
from 15 seconds to over ten minutes -- without ever producing a wrong answer,
which is what makes that kind of regression hard to notice.

**Three tests were wrong rather than the code**, all for the same reason --
they encoded the size of the old map. A globe with 92 cells has one cell 12
degrees from the pole rather than one almost exactly on it; 27 land cells
cannot reproduce Earth's biome distribution and the climate suite now pools
twenty seeds; and a metal on 0.2% of the ground cannot be sampled from a
91-tile map.

---

## The cross-boundary problem, solved for area queries

**Problem.** Deferred since the first commit and finally forced by the smaller
maps. A settlement could only see cells inside its own sub-map, which at 9,919
cells was a limitation nobody hit and at 91 cells meant its entire reachable
world was exactly what it farmed. There was never anywhere to put a daughter
village, and expansion stopped dead.

* ~~Walk the neighbour graph outward from the home cell.~~ Cannot leave the
  sub-map. A rim cell has five neighbours and no way to name the sixth.

* **Descend instead of walking.** At the globe every cell is reachable from
  every other, so take the ones near the point; then inside each of *those*
  take the sub-cells near the point; and so on down. Boundaries cross for free,
  because at every level all the parents that reach the disc are considered and
  not just the one the point sits in.

  Measured: 4,096 cells within 2 km, spread over **60 different parent maps**.

What this does not solve is tile-to-tile adjacency across a boundary -- a rim
cell still has five neighbours, and rivers still stop at the edge of a sub-map.
Area queries are the case that catchments, trade and settlement need, and they
work now.

---

## Land stopped at the edge of a hexagon, for four separate reasons

**Problem.** Reported from the screen once the mosaic was drawing real tiles:
land appears at the edge of a hex and does not continue into the next one. Four
causes, found in order, and only the last was the big one.

### 1. Every sub-map sampled a different noise field

The detail noise was seeded from the parent's ADDRESS, so two adjacent maps
read different fields. The file header claims terrain is continuous because
noise is sampled in 3D world space, and sampling in world space is necessary
and **not sufficient** -- two maps can read the same coordinates and still
disagree if they are reading different functions.

Measured at the exact midpoint of every region border: the two maps' noise
differed by 16% of the detail amplitude at the median and 70% at the worst.
Keyed on the depth instead, so each layer still has its own field and every map
on a layer shares it, the seam is **exactly zero** -- both maps evaluate the
same function.

Rock provinces had the same bug from the same seed and got the same fix.

### 2. Sixty-four of ninety-two regions drew nothing at all

`drawGlobe` skipped any region whose average was below sea level. A coastline
lives in the children, so a region that is mostly sea still holds the beach on
the far side of its border -- and skipping it meant the coast was resolved on
the land side of every boundary and simply absent on the other. The eye reads
that as a continent cut out with a hexagonal cookie cutter.

### 3. The world lost two thirds of its land on the way down

**A planet solved for Earth's 29.2% land came out at 12.1% one layer down and
8.8% the next.** Coastlines are fractal in length, not in area, so this is
straightforwardly wrong.

* ~~Make the coastline guard symmetric.~~ Its own comment already said "or the
  reverse" while the code ran one way only -- sea could not become land and
  land could drown freely. Fixing that moved the number by 0.1 points.

* ~~Widen the guard band to the continental shelf, and then to the local
  relief.~~ Both helped a little and neither addressed it. The band was in
  METRES, and metres are not symmetric about a coast: land stands 840 m up on
  average and the sea floor lies 3,688 m down, so any threshold in metres
  protects the ocean far more strictly than the land, and the noise eats the
  difference at every layer.

* ~~Interpolate elevation as a normalised land/sea signal.~~ This places the
  coast correctly -- 12.1% became 27.9% -- and puts a **4.4x kink in the
  gradient at exactly sea level**, which the interpolation then reproduces as a
  cliff along every shore. Six suites went red.

* **Interpolate the classification as its own field.** Elevation and coastline
  want opposite things from an interpolator: elevation wants a straight average
  so a planar hillside stays planar, the coastline wants land and sea weighted
  equally so the crossing sits near the boundary between two cells. Two fields,
  one question each, and no kink in either.

### 4. The rim of every map was still nearest-neighbour

The one that mattered. A map's rim cell is missing two or three neighbours,
because they live in a sibling map under a different grandparent -- so no
triangle contains the sample point and the sampler fell back to the cell's own
value. **Nearest-neighbour, on every map edge, at every layer**, and a rim is
30 cells of 91.

Measured on a child of a rim cell: a **987 m step across one 306 m cell**, a
73-degree cliff, entirely inherited rather than added by noise, and relief that
did not fall from its parent's at all.

* ~~Extrapolate from the least-bad triangle.~~ Worse. A triangle that does not
  contain the point can be lopsided, and unbounded extrapolation amplifies
  whatever gradient it has: adjacent cells came back 987 m apart from a field
  varying by tens of metres.

* ~~Fit a plane through the cell and whatever neighbours it has.~~ Bounded, and
  still wrong where the sibling would have said something else. Relief started
  falling again but 85-degree cliffs remained.

* **Let the World fetch the sibling.** A map cannot reach sideways; the World
  can, by descending from the globe to the cell containing the point. The
  missing neighbour's POSITION is computable from inside the map -- the hex
  lattice runs on past the edge of the array -- and only its value needs
  fetching. This is `cellsWithin`'s answer applied to one cell instead of an
  area: **descend, do not walk.**

  Measured, relief down the seven layers: 5829, 2086, 660, 190, 32.4, 6.6,
  1.9 m, falling at every step, with slope rising 0.7 to 60 degrees as the
  scale shrinks -- which is what self-affine means. Rim cells now average
  0.898 of the interior's slope: indistinguishable, and slightly gentler for
  an honest reason, because a rim cell has fewer neighbours to take a maximum
  over. The whole descent costs 33 ms.

**And one test was measuring the wrong layer.** "Most cells do not carry a
river" failed at 64 of 91 -- asked of the march map, where a cell is 27.8 km
across and drains 670 km². Nearly every such cell carries the 844 m3/s the
threshold asks for and it is right that it does: the water is real and it is
spread over a hundred channels, none of them resolved. Moved to the ground
layer, where a channel is narrower than a tile and the question means
something. Same finding as the soil model's, one field over -- the rule is
right and the grid cannot ask it.

---

## ## The world view fell back to a blend, and the threshold was the reason

**Problem.** "The tiles on the world view still do not render their constituent
hexes. We made them take a shade, I think." The third time that sentence has
been true, and the first time the cause was the line deciding *whether* to draw
the tiles rather than *how*.

**The globe and the flat maps were asking different questions.** A sub-map
gates the mosaic on "is a TILE big enough to draw?" -- `size * CHILD_SCALE`.
The globe gated on "is the REGION big enough?" -- and since the two divide
parent by child differently, 9.5 against 8.7, one threshold of 34 px meant
**3.9 px tiles on a sub-map and 7.4 px tiles on the globe.** The world view was
being held to twice the standard every other layer met.

That was survivable at 92 world cells. At 192 it was not: region pixels fall as
the square root of the cell count, so the window needed to clear the gate grew
from about 390 px to 600. Under that, the world view fell back to the flat
blend -- correctly, by its own rule, and silently.

| canvas | tile px | before | after |
|---|---|---|---|
| 400 | 5.3 | blend | tiles |
| 500 | 6.7 | blend | tiles |
| 600 | 8.0 | tiles | tiles |

**Stated once, in tile pixels, both callers ask the identical question.** Below
four pixels a tile is not a shape and the blend says the same thing more
cheaply; above it, every layer draws its constituent hexes, including the
world.

The lesson is not the constant. It is that the same decision was written twice
in two different units, so the two drifted without either being wrong on its
own terms -- and the drift only became visible when an unrelated change moved
one of the inputs.

---

## ## The world map was the only layer laid out in a different space

**Problem.** "World is the only one whose tiles are not a clean mosaic of their
constituent hexes." Every other layer nests cleanly; the world map did not, and
the same function builds them all.

**Measured, and the number is the whole story.** How many of a region's 91
children have their centre inside that region?

| latitude | before | after |
|---|---|---|
| ±7° | 85 | 85 |
| ±20° | 81 | 85 |
| ±35° | 77 | 87 |
| ±53° | **61** | 83 |
| a flat sub-map | 85 | 85 |

A third of every polar region's tiles belonged to a different region. And the
equator was already right, which is the clue: **whatever was wrong got worse
with latitude.**

**Because the world map is a hex grid in (longitude, sine of latitude) and the
ladder below it was not.** A cell up there is a regular hexagon in the
projection and a stretched one on the sphere -- 2.7 times taller than wide at
53 degrees. Children were laid out isotropically in a tangent plane, which
cannot tile a stretched hexagon, and the mismatch is exactly the projection's
scale factor. At the equator that factor is one, which is why the equator
looked fine and why this was invisible until the world map stopped being a
Goldberg polyhedron.

* ~~Scale the tile cover per cell to match each region's own reach.~~ That was
  already there, from the pentagon fix, and it is a plaster: it stretches the
  arrangement to the cell's LONG axis, so the short axis over-covers and the
  clip eats it. It cannot fix a shape mismatch with one number.

* ~~Give the basis the projection's scale factors -- east times cos(lat),
  north over cos(lat) -- and keep the usual `origin + x·east + y·north`.~~
  Correct to first order and nowhere near good enough: a region spans 2,500 km
  and the scale factor being linearised is precisely what varies across that
  span. One cell's tiles reached 76% of its own outline, and the relief between
  two layers fell by a factor of 124 where the ladder should lose about five.

* **Carry the anchor in projection coordinates and convert exactly.** A map's
  basis holds its (longitude, sine of latitude); `toDirection` adds the offset
  there and converts once; `cellContaining` converts back the same way. The
  children are then laid out in the same space their parent is drawn in, at
  every latitude, and the nesting comes out flat: 83 to 87 against a flat map's
  85.

**Two things fell out of it.** The per-cell tile cover collapsed to a single
constant -- `sqrt(91)/(sqrt(3)·RADIUS)`, the reciprocal of the 90.8% a hexagon
of hexagons spans -- which is exactly the number the flat maps have always
used. And the layer-0 cell radius is now taken from the world grid's own
`CELL_R` rather than derived from an equal-area hexagon, because the world grid
is the definition.

**And one thing had to be built.** Doing the projection exactly means calling
sine, cosine and arctangent on every cell centre in the world, and `Math.sin`
is only approximated by the spec -- two engines disagreeing in the last bit
would put a cell boundary in a different place and hand two players different
worlds. `sim/angle.ts` was no help: that is a fixed-point system on 1024 steps
to a turn, built for how a soldier faces, and a tenth of a degree is an
eighteen-kilometre error on a coastline. So `mathx.ts` gained `dsin`, `dcos`
and `datan2`, range-reduced with fixed term counts like `dexp` beside them, and
agreeing with `Math` to within 9e-16 across the tested range.

---

## ## A region border is a line drawn across a continent

**Problem.** "The detail of constituent hexes works great on every level except
World." The world view's continents looked coarse where every layer below
looked fine, and the same code draws both.

Measured first, because the obvious guess -- that the detail was not there --
was wrong. **103 of 192 regions have a coastline running through them**, and a
region holds three to eight distinct biomes. The tiles were being generated,
were varied, and were being drawn.

**What was wrong was a line.** A region is 2,500 km across, so its outline is
wider than most countries, and drawn at the weight it needs to be visible when
there is nothing else, it beats everything inside it. Every landmass came out
as a honeycomb of enormous hexagons with the real coastline -- which the tiles
were drawing perfectly well -- demoted to texture inside the facets.

The fix is one condition: **once the tiles are being drawn, they are the grid**,
and the region border stands down. Borders still appear where they carry
information -- ownership, and the selection -- but not merely to say where one
administrative hexagon stops.

Worth keeping because of what it was NOT. It was not a resolution problem, and
going a second layer down would not have helped: 192 regions by 91 by 91 is 1.6
million cells against about 1.4 million pixels of globe, so the mosaic is
already at the screen's limit and the extra work would have been invisible even
if it had been affordable. The detail was all present. Something was drawn on
top of it.

---

## ## The twelve pentagons are gone, and two guards went with them

**Problem.** "The pentagons are the problem. We need a hexagon only projection.
Or just do a full spherical wrap."

A hexagon-only *closed sphere* is impossible and that is a theorem. A
hexagon-only *wrapped grid* is ordinary, and the question was really asking for
the second.

* ~~Raise the subdivision frequency so the twelve are a smaller share.~~ Works
  and does not answer it: twelve is twelve at any resolution, and the cost is
  the whole ladder shrinking underneath.

* ~~Keep the sphere and force all twelve pentagons into deep ocean.~~ Cheap --
  3 of 40 seeds do it by chance -- and it hides the problem rather than
  removing it.

* **Lay the grid in (longitude, sine of latitude) and wrap it east to west.**
  That projection is Lambert cylindrical and Lambert is EQUAL-AREA, so cells
  are exactly equal-area on the sphere; and a cylinder has Euler
  characteristic zero, so no pentagons are required. Cells stay points on the
  unit sphere measured by great-circle distance, which is why nothing below
  the top layer had to change.

  Measured: 192 cells, **zero** with five neighbours, 156 with six and 36
  against the ice caps with four, adjacency symmetric, and the wrap closing
  exactly -- column 0's western neighbour is column 23.

**Eight rows, not six.** Six was closer to the old cell count and could not
hold a climate: with six latitude bands one lands squarely on the subtropical
desert belt and the world came out **33.3% desert, which is exactly two rows in
six** and the giveaway. Eight rows straddle the belt and it falls to 27%.

**And then two guards had to go**, both of which had been holding up something
that was no longer falling.

The coastline guard existed because a planet solved for 29% land came out at
12% one layer down. That was measured on a **92-cell** world map, where a
continent was three cells across and most of a land cell's neighbours were
abyss. At 192 cells a continent's interior cells are surrounded by other land
and the drowning largely stops on its own: 29.7% → 23.6% → 25.6%, stable.

What the guard cost was worse than the six points it saved. As a **clamp** --
land forced to at least +1 m -- it is a discontinuity by construction: two
neighbours straddling the threshold get one snapped to +1 and the other left
wherever it was. Measured on a coastal ground map, **147 m across one 22 m
cell**, with the noise contributing nothing at all, and the clamped value then
inherited so the next layer's median was exactly 1 m. Rewritten as a smooth
**pull** toward the layer above's classification it made the land fraction
*worse* -- 21.6% against 23.6% for no guard at all -- because it leans on sea
as hard as on land and there is more sea.

So: no guard. The `landness` field it was the only consumer of went with it.

**One bound was kept**, and it is measured rather than invented: no point on
Earth is above Everest or below Challenger Deep, both already anchored. Relief
is extrapolated from a ten-kilometre baseline by the Hurst exponent, and over a
184 km cell that overshoots -- it asked for 12 km of relief where the real
world manages about eight. Terrain is only self-affine over a range.

**Three tests were asking questions the new world cannot answer as posed**, and
were re-aimed rather than loosened. Tundra and ice are a fifth of Earth's land
and almost all of that fifth is poleward of 65°, which is now outside the grid.
"No cliff is near vertical" is a claim about landscapes, so it is asserted down
to the plot layer and measured below it, where a cell is 22 cm and a vertical
step is a stream bank. And the river test descended to the best *farm*, which
lands in a headwater as often as not; it now follows the biggest channel on the
world map down, and finds 11,691 m³/s still there at the ground layer, out of
11,767 at the top.

---

## ## Twelve pentagons were quietly missing a third of their ground

**Problem.** "The world is not just hexagons, but pentagons as well. Can we
make a sphere out of only hexagons?"

**No, and it is a theorem rather than a limitation.** With three faces meeting
at each vertex, F hexagons give E = 3F edges and V = 2F vertices, so
V - E + F = 0 -- and a sphere requires 2. Allow pentagons in and the same
arithmetic returns **P = 12 exactly**, whatever H is. Twelve, always, however
fine the grid gets. It is why a football has twelve however many hexagons are
sewn around them, and why every fullerene has twelve.

So the pentagons cannot go. But the question was pointing at something real,
and it was ours rather than the sphere's.

**The tile cover was one global number sized for the widest hexagon.** Ninety-
one tiles have their region's area but not its shape, so they are drawn
slightly large and clipped to the cell -- and the scale for that was measured
once, against the widest hexagon at 0.242 radians. A pentagon only reaches
0.191. Measured: its tiles were drawn **27% too far out**, the clip threw away
**38% of the area they covered**, and the pentagon showed **56 of its 91
tiles**. Twelve places on the globe were missing a third of their ground.

That reads as "errors around the edges" without ever looking like a specific
bug, because nothing was NaN, nothing was missing from the draw list, and the
other eighty cells were fine.

**Measured per cell instead**: each region's tiles reach exactly as far as that
region does, from its own outline. Coverage across a sample of pentagons and
hexagons went from 0.79-1.00 to a uniform 1.07-1.08.

The fraction of the world that is pentagon is a free choice and worth writing
down, because it is the one dial the theorem leaves:

| frequency | cells | pentagons | region | plot layer |
|---|---|---|---|---|
| 3 (now) | 92 | 13.0% | 5.54M km² | 888 m² |
| 4 | 162 | 7.4% | 3.15M | 505 m² |
| 6 | 362 | 3.3% | 1.41M | 226 m² |
| 8 | 642 | 1.9% | 0.79M | 127 m² |
| 16 | 2562 | 0.47% | 0.20M | 32 m² |

More regions means smaller regions, so the whole ladder shrinks under them --
which is the trade, not the pentagons.

---

## ## The tiles on the globe could not tessellate, and no measurement said so

**Problem.** Reported from the screen: "there are errors around the edges and
the hexes don't fit together neatly", and -- the detail that located it -- "only
an issue on world map, the smaller maps are all well aligned".

Every measurement passed. The right number of shapes, no NaN coordinates, the
flat-map alignment arithmetic exact to 1e-9. **The suite was checking what the
renderer was asked to draw and not what it looks like once drawn.**

So the first thing built was a way to look: `tools/preview.ts` runs the real
renderer against a software rasteriser and writes a PNG. It is about two
hundred lines and it found the bug in one image.

**The tiles were fixed-size, fixed-orientation hexagons dropped at each
projected centre.** On a flat map that is exactly right, which is why the
smaller maps were fine. On a sphere it cannot work: the projection rotates and
foreshortens the lattice by a different amount at every point, so the tiles sat
upright wherever they were while the grid under them turned, and the background
showed through the gaps.

* **Build each corner as the centroid of a triple of touching cells.** The same
  dual construction `sphere.ts` already uses to outline a Goldberg cell, and
  the reason it is the right one: two neighbouring tiles compute the SAME
  triple, so they arrive at the same corner and the tiling closes by
  construction rather than by tolerance. Rotation, foreshortening and per-tile
  scale all come out of it for free, because the corners are positions rather
  than an offset from a centre.

  Measured: 240 of 240 adjacent pairs share exactly two corners, to 1e-9.

  The outermost ring needs corners from cells one step beyond the map. Those
  are positions and nothing else -- the lattice runs on past the edge of the
  array -- so no sibling map has to be consulted for them.

**And then a fringe.** Ninety-one tiles have exactly their region's area, which
is how the ladder is built, but not its shape: a hexagon of hexagons is not a
Goldberg cell, and for the twelve pentagons it does not even have the same
number of sides. Measured, the arrangement reaches 0.208 radians from the
centre where the widest cell reaches 0.242 -- so a seventh of every region's
radius was bare, all the way round, and read as a ring of flat colour that made
each mosaic look like a patch laid on the globe rather than the surface of it.

The tiles are drawn at 1.163x, the ratio of those two measurements, so the
widest cell is exactly covered and every other is over-covered and trimmed by
the clip. Uniform, so the tiling stays a tiling, and a drawing decision only:
nothing downstream reads it, a tile's real position is what the generator says,
and picking works off the region outline.

**The lesson is the tool, not the fix.** A renderer is the one part of this
project where the measurements can all be green and the thing still be wrong,
because the output is an image and the suite never looked at one. `preview.ts`
is cheap to keep and it is the only reason this was a twenty-minute problem.

---

## ## Ninety-one tiles in a hexagon, three ways

**Problem.** Each hex should show the tiles that make it up, one layer down, so
that detail resolves at every step without the world map reaching to the
bottom. Getting the information right turned out to be the easy half.

* ~~Draw the 91 children as padded axis-aligned squares.~~ Read as dither.
  Squares do not tessellate with hexagons, so the tiling left a lattice of
  gaps; at the 26 px threshold each child was about 2.5 px, and the parent
  stopped reading as a hexagon at all. Reported as "the mosaic doesn't land
  well". **The information was right and the geometry was wrong**, which is why
  it was tempting to conclude the whole idea was wrong.

* ~~Replace it with a single blended colour per hex.~~ Overcorrected. It does
  read as one clean shape and it is the right thing at a distance, but it
  throws away exactly what was asked for -- reported back as "the tiles don't
  look like I expected, they should show every tile that makes them".

* **Hexagons, turned to meet their parent, clipped to it.** Three things,
  and all three are needed:

  - **Hexagons, not quads.** They tessellate, so the tiling closes up and
    reads as ground rather than as noise.
  - **Turned thirty degrees.** Ninety-one hexes of circumradius r arrange into
    a hexagon of circumradius sqrt(3)*RADIUS*r, and that arrangement comes out
    *flat*-topped while a cell drawn by `corners` is *pointy*-topped. Turning
    the children puts the grain of the small hexes parallel to the big one's
    edges instead of cutting across them.
  - **Clipped, over a solid parent.** The union of 91 hexagons has a serrated
    edge: without the clip the silhouette is ragged, and without the fill
    underneath the background shows through every notch.

  Measured: with the child scale at 1/(sqrt(3)*RADIUS), the outermost child
  sits exactly 100 units from the centre of a parent of circumradius 100, at
  30 degrees, which is a parent corner. Both halves have to be right -- get
  the scale right and the turn wrong and the tiling sits skew inside its own
  parent.

**And a threshold, because both earlier answers are right somewhere.** Below
34 px a cell is painted with the blend instead, and below 6 px flat. A child is
a ninth of its parent across, so 34 px is where children reach about 3.5 px --
roughly the smallest a shape can be and still read as a shape. The blend is not
wasted work; it is the same information at the distance where averaging is what
the eye is doing anyway.

---

## ## Soil sat on a seventy-four degree cliff

**Problem.** Searching the world for hillsides held up only by their trees
found four, and every one of them was at 74 or 75 degrees carrying most of a
metre of soil. The mechanic worked -- fell them and twelve years later they go
-- but no such slope carries soil in the first place.

Soil depth was the balance of production against erosion, and erosion was
stream power. On a ridge-top cell the catchment is one cell, so stream power
says the wearing is slow -- which is **true and beside the point. A 74-degree
slope does not wear away, it lets go.**

The missing term was already in the file, unused: the infinite-slope equation
solved for depth instead of for safety.

    z <= c / (gamma * (sin(t)cos(t) - cos^2(t)*tan(phi)))

Below the friction angle that bracket is negative and there is no limit, which
is correct and is not a special case -- friction scales with weight exactly as
the driving stress does, so the slope genuinely does not care how much is on
it. Above the friction angle it can never balance, and the only thing holding
the soil on is cohesion, which does *not* scale with depth. So there is a
ceiling, and it collapses fast: granite holds 0.25 m at 45 degrees and 0.11 m
at 60.

Evaluated bare, without roots, because vegetation comes and goes over centuries
and soil depth is the product of millennia. Roots then decide whether what is
there today stays there today, which is the other function and the other
timescale.

**This is why cliffs are bare**, and it was being asserted by a slope threshold
in the old topsoil model rather than derived.

---

## ## Every layer below the first was a staircase

**Problem.** Found by asking a question nothing had asked before -- how fast
does this world wear away -- and getting an answer a hundredfold too slow, with
no bare rock anywhere and not one unstable slope on the planet.

`sampleSubMap` was **nearest-neighbour**. A child map covers one parent cell
and its rim cells overhang into the parent's neighbours, so the full elevation
difference between two parent cells appeared as a vertical step inside the
child -- and every layer rebuilt it from its own parent, forever. Measured on a
mountain descent: relief was 756 m at the 3 km layer and **still 756 m at the
41 cm layer**. Three quarters of a kilometre of relief across four metres of
ground, with slopes reading 90 degrees at four layers running.

`samplePlanet`, one function above it, already interpolated, and **its comment
says exactly why it had to**: "taking the containing cell's value alone would
give every sub-map a flat floor with a cliff at each region boundary". The
globe-to-region step had been fixed and the seven below it never were.

It hid because it produces a plausible *median*. Most of a child's cells sit
inside one parent cell and are therefore perfectly flat, so the map looks
smooth until something asks about the maximum.

* ~~Copy samplePlanet's inverse-distance weighting.~~ Fixed a third of it.
  Shepard weighting has a flat spot at every node -- the gradient is zero
  exactly at a cell centre -- so the field sits level across each cell and does
  all its climbing near the boundary. The staircase came back as a ramp:
  maximum gradient inside a child map was **50 degrees where its parent's own
  gradient was 8**. Softer, and just as wrong.

* **Barycentric over the triangle of cell centres.** No flat spot and no free
  parameter, and it reproduces a linear field exactly -- which is the whole
  requirement, because over one cell of the layer above terrain is close to
  linear and the detail noise is what is supposed to add the rest.

  Measured: relief 3162 -> 1080 -> 184 -> 23 -> 2.9 -> 0.6 -> 0.1 m down the
  seven layers, falling at every step.

This is the sister project's finding almost word for word: "the same mistake as
nearest-neighbour sampling turning a coastline into a 39 km staircase, and it
was the sampler both times". Three times now.

---

## A bare number cannot be wrong, which is the problem with it

**Problem.** With the staircase gone, **nothing in the world was steeper than
six degrees**. No slope on Earth, no bare rock, denudation a hundredfold too
slow, and not a single unstable hillside.

The detail amplitude was `420 / SHRINK^(0.7*(depth-1))` -- a bare 420 m at the
top divided down. The trouble is not that 420 was wrong. It is that **nothing
could say whether it was wrong**: there was no measurement it could be held
against, so it had passed every suite the project had for its whole life.

**Local relief over a ten-kilometre baseline** is how landscapes are actually
reported, and it is published: a high mountain belt runs 800-1,500 m per 10 km,
rolling hill country 100-250, a shield plain 10-30. Anchor the two ends to
that, scale by the Hurst exponent, and modulate by uplift per cell -- and every
other scale becomes a *prediction* that can be checked:

| span | modelled | real |
|---|---|---|
| 2,900 km | 6,557 m | 4,000-8,000 |
| 300 km | 2,566 | 2,000-3,000 |
| 350 m | 29.6 | 30-100 |
| 4.5 m | 1.5 | 0.5-2 |

The world's own implied Hurst exponent, measured across four decades of scale,
comes back 0.700 -- which is the anchor, recovered from the output.

---

## Shale came out more stable than granite

**Problem.** With the geotechnics wired up, no slope anywhere would fail. A
bare, saturated, thirty-degree shale hillside returned a factor of safety of
1.40. Every response was right in *direction* -- forest above bare, wet below
dry -- and nothing could ever cross one.

Soil cohesion was carrying everything: 10 kPa for shale against a friction term
of 3.5 kPa. Those are **undrained shear strengths of stiff clay**, which
describe a different failure. What governs a shallow landslide is the drained,
and for anything that has moved before, **residual** cohesion -- and residual c'
in clay is near zero.

Worse, at peak values shale measured *more stable than granite*, because at the
metre or so a shallow slide involves, cohesion outweighs friction. That inverts
the best-known ordering in the subject, and the file's own comment three lines
above the table called shale the classic landslide lithology. **The comment was
right and the number was wrong.**

At residual values -- shale 1.0 kPa, granite 0.5 -- shale returns 0.57 wet
where granite returns 0.85, and the felling sequence works: 2.32 under old
forest, 1.54 three years after, 0.66 at fifteen.

**And one test was wrong rather than the code.** A first version asked a
30-degree shale slope to stand dry and fail wet. It fails dry too, and
correctly: tan(24)/tan(30) is 0.77 before any water is involved, so residual
clay cannot hold 30 degrees without roots. The water trigger is demonstrated at
25 degrees, where it is what decides.

---

## ## Rivers stopped at the edge of every map

**Problem.** Reported from the screen: "rivers do not connect". Each sub-map
accumulated flow over its own 91 cells with every cell starting at one unit,
and normalised against its own maximum.

* ~~Match the channels up at the boundary by having each map look at its
  neighbours.~~ Cannot be done. The neighbour would have to look at *its*
  neighbours to know what it is passing on, and the regress crosses the planet.
  This is the same wall `cellsWithin` hit, and it has the same answer:
  **descend, do not walk**.

* **Cascade from the parent.** The parent routed water at its own resolution
  and is generated on the way down anyway. It knows which of its neighbours
  drain into this cell and how much each brings. Water enters the child at the
  lowest cell of the edge it crosses, and the two maps agree on that point
  without consulting each other because elevation is continuous and both sample
  the same function along the same line.

  Measured: one trunk river carried 743 → 735 → 692 → 691 m³/s across four
  layers of descent, and catchment conserved to six figures at every one.

**Two bugs inside the fix, both found by measurement rather than by looking.**

* **Injected water left the map in the same step it entered.** A rim cell is an
  outlet, so the inflow was handed to a cell whose downstream was already -1.
  The trunk river lost two thirds of its discharge on every descent — 1108 →
  385 → and so on — *while the catchment area stayed exactly right*, because
  area was conserved whether or not the water crossed anything. Conservation of
  one quantity is not evidence about another. A rim cell that water arrives at
  is no longer an outlet; below sea level the flag stands, because water
  arriving at the sea really has stopped.

* **The old accumulator let flow die in hollows.** Replaced with a priority
  flood, which fills every depression to the level of its lowest escape before
  routing. Lakes fall out of it as the cells the fill had to raise.

---

## Every hillside in the world was half a floodplain

**Problem.** The moment drainage became an absolute discharge, yields fell from
a median of 330-450 kg/ha to **153 everywhere**, and three suites went red.

The old `drainage` was a rank within its own map: log flow over the map's own
maximum, so **it reached 1.0 somewhere in every map including maps with no
river in them**, and the median tile sat near 0.5. The soil model read that
number twice — once as an alluvial multiplier on topsoil depth, once on
fertility — so every landscape's ordinary hillside was being handed half a
floodplain's worth of enrichment. The medieval yield calibration had been
satisfied by it, which is why nobody had noticed.

* ~~Restore the ranking, or scale the new number to reproduce the old
  distribution.~~ That is re-fitting a term to a bug. The rank does not mean
  anything: it says where a tile sits in an arbitrary 91-cell window.

* ~~Use the topographic wetness index, ln(a/tanβ).~~ It is the standard index
  and it is scale-dependent through `a` — the same hillside measures 8.6 at a
  306 m cell and 6.3 at a 32 m one. On a ladder that changes resolution by
  √91 per layer that is a recalibration at every layer.

* **Ask how much of the tile is floodplain.** Meander belt width is fifteen
  channel widths (Leopold and Wolman), channel width is 2.7·Q^0.5 (Leopold and
  Maddock), so the floodplain a river builds is fixed by its discharge. Divide
  by the tile's own width and the answer is a fraction that means the same
  thing at every layer, and it needs exactly the absolute discharge the
  cascade had just made available. **It could not have been asked before.**

  Measured: a 1 m³/s brook floods 13% of a 306 m parish tile and all of a 32 m
  plot. The Amazon floods both. A hillside floods neither.

**Then the soil model measured correctly against real soils** — Ukrainian
chernozem 579 kg/ha held, the Beauce 667, English midlands 253, Amazon
rainforest 84 — and two of the three red suites turned out to be red for a
different reason (below).

---

## The test helper was choosing wet hillsides

**Problem.** After the floodplain fix the reference settlement's site yield fell
**72%** while the best tile in the world fell only 26%. Two different numbers
means two different problems, and the gap was the finding: the world got a
quarter poorer, and the chooser got much worse.

`groundSiteIn` descended by net primary productivity at every layer and
switched to grain yield only on the last step. **Its own comment said why that
was wrong** — "a wet hillside out-produces a dry field and will not feed
anybody" — without applying the argument to the earlier steps. It survived
because the drainage rank was carrying it: wherever the productivity descent
landed, the tile arrived holding a mid-rank alluvial bonus and yielded well
enough.

Following yield at every layer put the reference settlement back on real
farmland: site yield 554 → 571, and the catchment's carrying capacity 566 →
1,130.

**A knock-on worth recording, because it looks like a regression and is not.**
A forty-year run now founds **one** daughter town where it founded eight. The
trigger is intact — the settlement is labour-limited to about 200 people and
land-limited from about 500 — but its capacity doubled, so the pressure that
makes it spread now arrives after year 40 instead of before it. Eight towns was
what a village on a mediocre hillside did.

---

## The layer a person stands on had one millimetre of relief

**Problem.** Found while chasing a suite that said a ground map had no relief.
Detail amplitude fell as `SHRINK^(depth-1)` — amplitude proportional to the
full first power of the wavelength.

Terrain is self-affine, not self-similar. The measured Hurst exponent for land
surfaces is 0.5 to 0.8, not 1.0, and the error compounds because the ladder
applies it seven times:

| Layer | Cell | At H = 1.0 | At H = 0.7 |
|---|---|---|---|
| 5 plot | 37 m | 5 cm | 76 cm |
| 7 pace | 41 cm | **1 mm** | 3.2 cm |

The suite that caught it was itself half-stale — the new site descent had
landed it on a floodplain, which is genuinely flat — but the underlying number
was wrong on every tile in the world, not just that one.

---

## ## Four wrong answers to where a daughter village goes

**Problem.** Settlements had to spread when their land filled, and every
version of the spacing rule broke something.

* ~~Twice the parent's potential reach.~~ **6.2 km of clearance around a town
  of two thousand** -- wider than the whole area the search could see, so
  expansion was blocked every turn for ninety game-years.

* ~~The founding party's own needs, 1.2 km.~~ **The parent lost seven eighths
  of its production in a single year.** The daughter got its ground and left
  its mother a circle 600 m across. Land goes to whoever is nearest, and a ring
  of children nearest to everything takes everything.

* ~~Parent radius plus daughter radius.~~ Still short. The border between two
  settlements sits at the *midpoint*, so a daughter at the edge of its
  mother's fields takes half of them.

* **Twice the parent radius.** Both keep their land.

**What actually made it workable was not the formula.** It was settlements
learning to farm what they need rather than every hectare they can reach, which
cut the parent's worked area fivefold -- so the rule that had demanded 6.2 km
now asked for 2.6.

**Also fixed here.** `findSite` searched the parent's catchment, which
deadlocked: a town that had filled its seven maps could see no ground but its
own, so it could never place a daughter, and expansion stopped dead at exactly
the moment population pressure was highest. A founding party is not going to a
field -- it is leaving -- so it now searches rings of realm cells out to 37 maps.

---

## A village ploughed five square kilometres it had no use for

**Problem.** A hundred people with land to spare farmed 5.5 km² and grew five
times what they ate, because nothing ever told them to stop. Three separate
symptoms, one cause.

* Population exploded at about 30% a year. Migration is pulled by headroom, and
  headroom was four times the population.
* Every harvest scanned all 69,433 candidate tiles whether it needed them or
  not, and with sixty settlements the economy could not keep up.
* Idle labour was meaningless, so the spreading trigger had nothing to read.

* **Stop when the barn is full.** A settlement now farms toward a target and
  stops. Fixing the economics fixed the speed at the same time, which is
  usually the sign that a model was wrong rather than merely slow.

**The target then had to be right, and took two goes.** A year's eating left no
surplus at all, so nothing was ever traded and no town could feed another. It
is a *bad* year's eating -- medieval yields swung 30-50% about their mean, and a
village that sowed for the average starved every time the weather turned -- plus
the granary shortfall, plus **what it sold last year**. Without that last term a
farming town's population rises until it eats its own surplus and the grain
feeding its neighbour's miners stops dead. Measured at year twelve.

---

## Three wrong triggers for spreading

* ~~Idle hands.~~ **Every village wanted to spread from its first week.** Only
  farming is modelled, so a perfectly healthy settlement reads 30-60% "idle"
  when in truth those hands are building, weaving and carting.

* ~~Land-limited, plus a guard that the town be comfortably fed.~~ **Never
  fired.** The guard was patching the strangled-parent symptom, and it is also
  backwards historically: population pressure is exactly when people leave, and
  a hungry town is better off by twenty mouths the moment the party walks out.
  Colonisation is what hunger looks like when there is somewhere to go.

* **Land-limited, full stop.** The ground would not grow what they set out to
  grow, however many hands they put on it.

**Emigration is the third outcome**, after growing and spreading, and it only
fires when a settlement tried to send a party and had nowhere to send it.
Before it existed, a town whose daughters had taken its land sat at 98% idle
for ever, trying to throw off another party every single week and failing.

---

## A town on poor ground would never specialise

**Problem.** The specialisation rule said: short of food and limited by hands →
farm harder. A town on 69 kg/ha runs out of *hands* long before it runs out of
ground, so it read as labour-limited and was told to farm harder every week
for ever. It never specialised and never could have.

* **Ask whether farming could ever fix it.** If what the fields yield is well
  short of what the people need, more hands on them is not the answer -- and
  the harvest already computes that. Plus a second condition: somebody must
  actually be delivering grain. A town alone in the wilderness must farm,
  however poor the ground, because there is nothing else to eat.

---

## The farming year was derived from the wrong end and came out double

**Problem.** Labour was 52 man-days per held hectare, derived from the virgate:
twelve hectares to a family with two and a half workers giving 250 days each.

* ~~Divide the virgate by a family year.~~ **Roughly 2x too high.** The
  arithmetic is fine and the premise is wrong: it assumes a villein family
  spent all its labour on its own arable. It spent nothing like all of it.
  Week-work on the lord's demesne ran to two or three days in seven, and past
  that there were the beasts, the croft, the woods, building and spinning. The
  virgate tells you what a family *held*, not what holding it cost them.

* **Add it up from the measured task rates instead.** Manorial accounts and
  Walter of Henley record how much ground each job covered in a day, because a
  reeve had to know that to plan a year. Ploughing an acre a day with a team of
  two, harrowing 1.5, sowing 2.5, weeding 0.5, reaping 0.28 with a sickle,
  binding 0.5, carting 1.

  **12.4 man-days to a sown acre with iron, 17.6 with a wooden ard** — against
  the 10-15 historians give. Per held hectare, with the fallow third still
  being ploughed: 22.8 and 34.0.

**And the virgate becomes a check that passes.** 12 ha now costs 274 man-days,
44% of a family's 625, leaving 351 for week-work and everything else. That it
fits is what makes the rest of it trustworthy.

**Knock-on, found immediately.** `radiusForPopulation` floored the search at 64
tiles — about 3 hectares. With labour halved, five people could work
twenty-seven, so every small settlement came out land-limited on an empty
continent. The radius is now derived from what the hands can work rather than
from what the mouths need.

---

## Two towns two kilometres apart each farmed the whole valley

**Problem.** A farming town and a mining town were placed 2.14 km apart to test
trade. Neither was ever short of anything, no grain moved, and the mining town
never specialised.

* ~~Assume the market clearing was broken and look there.~~ It was fine.

* **Both settlements were farming the same land.** Each built its catchment as
  though it were alone on the continent, so the same 35 km² was counted twice
  and both had food to spare. Trade had nothing to do because nobody was short.

* **A tile goes to whichever settlement is nearest it.** A Voronoi partition,
  which is also exactly what village territories were — the boundary ran where
  the walk from one village became longer than the walk from the other, and the
  parish map of almost anywhere still shows it.

---

## A mining town accumulated 1.65 million kg of iron nobody wanted

**Problem.** It specialised forever. A thousand people needing a thousand
kilogrammes a year had built a pile of 1,653,151.

* **There is no price, so it could not see iron getting cheaper.** The
  specialisation rule only asked whether the land was full, never whether
  anybody wanted the output.

* **Unsold stock is the signal.** A town cannot watch a price but it can watch
  the pile in the yard grow while nobody comes for it. A market signal does not
  have to be a price; it has to be a fact the producer can observe.

**Second attempt overshot.** The first version of the glut rule pushed the farm
share up whenever the yard was full and the specialisation rule pushed it down
whenever the land was full, so it flipped between 90% and 100% farming *every
single turn* and settled at neither. Fixed by requiring a demand signal —
either the town wants iron itself or somebody bought some — before it
specialises at all.

---

## Median farmland yielded 41 kg/ha where medieval reality is 330-450

**Problem.** With supply built, settlements starved everywhere. Median grain
yield across a temperate grassland region came out at 41 kg per hectare, eight
to ten times below what medieval evidence records, and one worker on median
land fed 0.4 people while having to feed 2.

Two separate double-counts, both of which looked entirely reasonable in place.

* **`health` started at `fertility`.** The yield formula multiplies both, so
  fertility was squared: 0.35 became 0.12. Health is meant to be what farming
  has taken *out* of a soil, and virgin ground has taken nothing — it starts at
  1. Two plausible numbers multiplied into one wrong one, which is the failure
  mode hardest to see by reading.

* **Net primary productivity appeared twice.** Fertility already carries NPP
  through the organic matter it builds, and the yield formula multiplied by
  `npp/900` again under the name `climateCap`.

  Worse, it was the wrong quantity even once. NPP says what a *landscape*
  grows; it says nothing about whether a *crop* will ripen, and the two come
  apart exactly where it matters — a rainforest hillside has enormous NPP and
  will not make a wheat field. Replaced with `cropSuitability`, from wheat's
  own measured requirements: 500 mm of water and 120 days above 5 degC.

**After both:** median 114, best tiles 447-639 on the good regions, and the
best land at 0.89-1.03 hectares per person against a measured historical
0.5-1.5. Seven of 24 sampled regions have properly arable ground, which is
about the right share for a planet.

**Also fixed here.** The season term was linear, so sub-Arctic tundra with a
three-month summer scored 0.76 on a crop needing 120 days. A season shorter
than the crop needs yields *nothing* — the crop does not ripen — so it is a
threshold, not a proportion.

---

## A settlement with an ample surplus sat at exactly five people for a decade

**Problem.** Good land, ration 2.81, health 1.00, and the population did not
move for 520 turns.

* ~~Assume the growth model was too weak and raise the birth multiplier.~~
  Would have been wrong twice over. The multiplier was already too *high* —
  4x baseline implies 10.8% annual natural increase, where colonial America,
  the fastest a pre-industrial population ever grew from births alone, managed
  3%.

* **Population was an integer and the fraction was rounded away every turn.**
  Five people with a full surplus gain 0.003 people a week. Rounded each turn,
  that is zero forever. *The fractional part is the entire growth at this
  scale* and has to survive the turn boundary — the same reasoning as the
  movement remainder in `derive.ts`, and it should have been applied here from
  the start.

* **And the birth multiplier was then solved rather than chosen**: to reach a
  30-per-thousand net increase against a 32-per-thousand death rate, births
  must run at 62 per thousand, so 1.77x baseline.

Migration was added at the same time, because it is what actually grew medieval
towns — urban death rates exceeded urban birth rates almost everywhere.

---

## A catchment depended on the order it was asked for

**Problem.** Found by a test that was looking for something else.

The catchment cache bucketed the search radius to build a key, then built the
catchment with the *unbucketed* radius. Two populations landing in the same
bucket therefore shared whichever catchment the first one happened to build —
so the same world gave different answers depending on the order it was queried.

* **Quantise the radius itself and use the quantised value.** The catchment is
  then a pure function of the bucket.

This is precisely the class of bug `docs/determinism.md` exists to prevent, and
it is invisible until two machines disagree. Related: `verify_purity.ts` caught
`Math.log` in the same cache-key line. That also sounds harmless and is not — a
bucket computed differently on two machines gives a different radius, a
different catchment, a different harvest and a different population.

---

## Two tests failed against entirely correct behaviour

Recorded because both cost a run and both were the test, not the code.

* ~~`growth decelerates: track[4]-track[3] < track[1]-track[0]`~~ An S-curve's
  *absolute* growth is still rising through its inflection, so years 40-50
  legitimately exceed years 10-20. Self-limitation is now tested through the
  ration instead — feeding more people off the same land must get harder —
  which is true at every point on the curve rather than only after the turn.

* ~~Overload a settlement with `potentialPopulation * 8`.~~ That capacity is
  measured at the *small* settlement's search radius. A larger settlement looks
  further, finds more land, and is fine — the adaptive radius working exactly
  as designed. The overload figure has to be an absolute one.

---

## Every WebSocket client silently refused the server

**Problem.** HTTP served fine, the upgrade returned a well-formed
`101 Switching Protocols` with a plausible base64 `Sec-WebSocket-Accept`, and
every client refused the connection without a word in any log.

* ~~Check the response headers, the ordering, the Connection header, Nagle.~~
  All correct. The response was byte-for-byte the shape the RFC describes.

* **The magic GUID had a character transposed.** It is
  `258EAFA5-E914-47DA-95CA-C5AB0DC85B11`, and it had been written
  `258EAFA5-E914-47DA-95CA-5AB0DC85B11F` -- the C moved off the front of the
  last group and onto the end as an F. Both are 36 characters and both look
  right.

**Why it was slow to find.** A wrong GUID does not produce a malformed
handshake. It produces a perfect handshake with the wrong answer in it, and the
only correct response a client has is to hang up quietly. There is nothing to
read.

Found by hashing the test vector in the RFC itself -- key
`dGhlIHNhbXBsZSBub25jZQ==` must give `s3pPLMBiTxaQ9kYGzzhZRbK+xOo=` -- and
then, when that failed too, by grepping the Node binary for GUID-shaped strings
and testing each one. `verify_protocol.ts` now asserts the vector so it cannot
drift again.

---

## Three files in a row crashed on TypeScript that cannot be erased

**Problem.** `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX: TypeScript parameter property
is not supported in strip-only mode`, at load, in `server/ws.ts`, then
`server/persist.ts`, then `verify/check_app.ts`.

`constructor(private readonly socket: Duplex)` reads like an annotation and is
actually an *assignment the compiler writes for you*. Node's type stripping
never compiles anything -- it replaces types with whitespace -- so there is
nothing to write it.

* ~~Fix each one as it crashed.~~ Three times, each a runtime failure in a file
  that had just been written, each costing a full run to discover.

* **Write a suite that reads the source.** `verify_purity.ts` now rejects
  parameter properties, enums, namespaces and module blocks across every
  directory, along with `Math.random` and the unpinned transcendentals under
  `sim/`, and imports naming a `.js` file that does not exist.

  It immediately found a fourth thing nobody was looking for: `corners()` in
  `sim/geo/hexgrid.ts` used `Math.cos` and `Math.sin`. It returns the corner
  offsets for *drawing* a hexagon and had no business in `sim/` at all. Moved
  to `client/src/render.ts` rather than granting the rule an exception -- the
  exception would have been harmless, and a rule that accumulates them stops
  being a rule.

**Note.** `tsconfig.json` sets `erasableSyntaxOnly`, which would have caught all
three at type-check time. Nothing runs `tsc`, because it needs an npm install
the project otherwise does not. Recorded in known-gaps.

---

## A test failed because it assumed which turn its orders would land on

* ~~Send a claim, wait for one turn, expect the claim to have landed.~~
  **0 changed.** The turn timer starts when the server does. A client
  connecting two seconds into a three-second turn sees a turn resolve before
  its own orders have arrived -- which is correct behaviour, and the test was
  wrong to fail. Poll for the effect, not for a turn number.

---

## Node could not resolve the module graph

**Problem.** `ERR_MODULE_NOT_FOUND` on every import.

* ~~Use the TypeScript convention of importing `./foo.js` for `./foo.ts`.~~
  **Every import failed.** That convention exists for `tsc`'s NodeNext *emit*,
  where the file really will be `.js` by the time anything runs. Node's native
  type stripping does not compile anything, so there is no `.js` and no
  rewriting step — imports have to name the file that actually exists.

* **Import `./foo.ts` directly, with `allowImportingTsExtensions` and
  `noEmit`.** Worked, and paid off twice: the dev server can then strip types
  on the way to the browser and serve the same files, so there is no build step
  anywhere in the project.

---

## Dynamic import of the suites failed on Windows

* ~~`await import(join(here, file))`.~~ **`ERR_UNSUPPORTED_ESM_URL_SCHEME`,
  protocol `c:`.** An absolute Windows path starts with a drive letter, and the
  ESM loader reads `c:` as a URL scheme. Use `pathToFileURL(...).href`.

---

## Heredocs kept truncating source files

Not a code problem, but it cost time twice and is worth recording. Writing
these files through shell heredocs failed on punctuation-dense TypeScript —
bash reported an unexpected EOF and wrote nothing. Use the file-writing tools
for source, and reserve heredocs for short config and markdown.

## The world was laid out by one projection and read back by another

Symptom: descending from a region, land drained away layer by layer -- 86 of
91 cells above water at the region, then 73, then 7, then none. The suites'
reference settlement was placed on open sea 30 m down, `yieldAt` returned
0 kg/ha, ten `verify_supply` checks failed, and `verify_expansion` stopped
finishing at all (>600 s against a previous 16 s) because every one of its
2,088 turns searched for a site that could not exist.

The first three hypotheses were all about terrain, and all wrong:

* ~~The new tectonic mesh produces no farmland~~ -- the world's best sampled
  tile yielded 474 kg/ha, inside the medieval band.
* ~~The descent is drowning because coastal regions are mostly ocean~~ -- the
  regions it walked were 91/91 land at every layer when walked by elevation.
* ~~A systematic downward bias in the detail noise~~ -- the error was not
  systematic. A child map covering a 14 m cell came out 445 m too **high**;
  one covering a 956 m cell came out 754 m too low. Noise with a mean of zero
  cannot do that, and neither can a bias.

What it was: `sampleSubMapRaw` inverted the projection with a pair of dot
products against the tangent-plane axes -- the linearisation the basis stopped
using when it started carrying `lon`/`sinLat`. `toDirection`, which *lays the
map out*, had been converted to the exact projection. `cellContaining` had been
written correct. This third inverse, inside the sampler, was left behind. So
every map was drawn in one coordinate system and read in another.

It hid because both projections are the identity at the map's centre and
diverge with distance from it. The measurement that found it: **sample the map
at its own cell centres.** Barycentric interpolation at a node returns that
node's value exactly, by construction, so any error there is the point having
been looked up somewhere else. Cell 45 -- the centre -- was exact. The mean
error over the other 90 was 247 m and the worst was 822 m.

After the fix that measurement reads 0.000 m worst, land holds at 91/91 down
the ladder, the reference site yields 612 kg/ha and is land-limited at 490
people, and the expansion suite finishes in 27 s.

The general lesson is the one the geometry keeps teaching here: a forward
transform and its inverse are one fact written twice, and converting one of
them is a half-migration that type-checks. There are now two inverses of this
projection in the file and they share a `shortWay` helper, which is not the
same as sharing the transform -- worth collapsing if a third ever appears.

## Relief stopped falling three layers early, and it was the fallback, not the terrain

Symptom: down a mountain descent, relief went 1,508 m, 597, then **325, 326,
324** across maps 1.9 km, 200 m and 21 m wide. Each layer covers one cell of
the one above, so relief has to fall by roughly the factor the cell size does.
Instead it stuck. Three hundred metres across a 200 m map is a 78-degree cliff,
and `verify_geology` failed five checks on it.

The tempting reading is that the detail noise is too strong at depth. It is
not, and the measurement that says so is worth keeping: **compare what a child
INHERITS against what it ends up with.** Sampling the parent at each of the
child's 91 cell centres gave an inherited range of 604 m, then 325, 326, 324 --
the plateau is already there before a single metre of detail is added. The
detail was contributing 1 to 6 m. The ladder was not manufacturing ground; it
was importing it.

What it was: a child centred on a RIM cell overhangs its parent by a fraction
of a cell, so a few of its points fall outside the parent's hexagon.
`fromPixel` returns -1 for those, and `sampleSubMapRaw` answered them with the
parent map's **centre** cell -- the one cell furthest from the point being
asked about. Measured: 3 of 91 samples took that path, and on this mountain the
centre sat 325 m away in elevation. Those three cells set the child's entire
range.

It recurred at every layer because **the distance to the centre does not shrink
when the cells do.** A 21 m map and a 1.9 km map both reach the same wrong cell
and inherit the same 325 m. That is the signature to remember: a quantity that
is identical across three orders of magnitude of scale is not being generated
by anything scale-dependent, so it is not the terrain.

The descent confirmed it from the other side. At layer 5 the steepest cell was
ring 4 rather than ring 5, no sample fell off the map, and relief immediately
dropped from 324 to 81.

Fix: `nearestCell` clamps an outside point to the edge it overhangs instead of
refusing it, and the existing rim machinery -- sibling-map lookup, else a
least-squares plane -- handles it as it already handles every other rim point.
Relief now falls at every layer: 1,508, 597, 120, 28.5, 4.3, 1.1, 0.2, ratios
of 2.5 to 6.6 against the 5.35 the Hurst exponent implies. Steepest slope at
the finest layer went from 78 degrees to 19.

Note for anyone re-reading the old comment: it called the centre fallback
"wrong but bounded", and bounded it was -- by the parent's whole range, which
at these scales is unbounded in every sense that mattered. A bound that does
not tighten as the thing it bounds gets smaller is not a bound on relief.

## A town alone stripped its own fields because its granary was full

Symptom: `verify_trade`'s specialisation check failed -- a settlement alone on
barren ground (169 kg/ha, iron ore under it, no trade partner anywhere) walked
its farm share down to the 0.05 floor and made 335 kg of iron a turn with
nobody to sell it to.

The trace is the whole story. It farms contentedly for ten years at a ration of
1.54 and grows from 60 people to 130. Then, around year twelve, it flips: farm
share 0.05, **ration 0.13**, grain arriving 0. It is not starving yet only
because it is eating a granary it has no way to refill.

`decideFarmShare` already knew the rule and had it written down: *"A town alone
in the wilderness must farm, however poor the ground, because there is nothing
else to eat. Grain arriving is the observable fact that says a different trade
is survivable."* The guard was declared inside the hungry branch, so it
protected only towns already short of food. A town that was **fed** fell through
to the second half of the rule, where a full granary plus wanting iron for its
own ploughs was enough to specialise.

The confusion worth naming: a full granary and somebody feeding you are not the
same fact. The first says you can afford to stop farming for a while; only the
second says you can afford to stop farming.

* ~~Hoist `someoneFeedsUs` out of the hungry branch and require it in both~~ --
  **deadlocked the paired case.** `verify_trade` then failed the opposite two
  checks: the town with a neighbour never specialised either, because a town
  will not buy grain until it stops growing its own, and it will not stop
  growing its own until grain is arriving. Nothing ever moved. Grain arriving is
  the right test for a town that is already hungry, when the answer is known; it
  is circular as a test for *starting*.

The fix: what separates the two cases before any trade has happened is whether
anybody else exists at all. `Report.alone` carries that, and the step down now
requires a partner to exist rather than to have already delivered. Deliberately
"anybody at all" rather than "anybody in reach" -- the market's own distance
limits decide whether a trade happens, and a town whose only neighbour is
unreachable finds out the ordinary way, by watching grain fail to arrive.

Note this was surfaced by the terrain fixes rather than caused by them: the mine
site's yield moved from 219 to 169 kg/ha, which changed when the town crossed
the nine-months-of-food line. The hole had been there the whole time.

## A landslide test that was not asking about a landslide

`verify_geology`'s "clearing a hillside is a decision with a delay" failed:
factor of safety fell from 4.54 to 3.79 over twelve years, a 16% loss where the
assertion wants 20%.

The physics was right. Root cohesion has a 3.5-year half-life, so 9.3% of it
remains after twelve years -- the roots had gone. What changed is that root
cohesion is a fixed number of kilopascals, so the *share* of stability it
represents depends entirely on the slope: on shallow ground friction dominates
and losing the roots barely registers.

The test picked **the first** cell steeper than 0.2 and stopped, so it ran on
whatever gentle slope the scan reached first. Once the relief fixes above made
the terrain honest, that cell was gentler and the loss fell below the threshold.

The wrong fix is to relax the assertion to 0.85. Felling trees is a landslide
question and should be asked of ground where landslides happen, so the search
now takes the **steepest** soil-covered hillside instead of the first
acceptable one. That finds 29.5 degrees, and there the factor of safety falls
from 4.48 to 1.82 -- a 60% loss, and a slope that has come within sight of
actually failing. The assertion is unchanged and now has something to bite on.

This is the stale-assertion category from testing.md, but with the twist worth
remembering: the assertion was fine and the *sample* was stale.

## A compute budget was doing a geographer's job

Re-gridding the world map from 24x8 to 39x14 -- done to halve the storm caps --
made every settlement in the world 57% poorer, and nothing about the terrain
had changed.

Symptom: carrying capacity at the reference site fell from 490 people to 209.
Settlements hit their land limit three times sooner, so a kingdom that threw
seven daughter villages in forty years threw seventy-nine, the first founding
moved from turn 696 to turn 90, and the turn rate collapsed from 110 a second
to 6.8 under the weight of eighty settlements.

The tempting reading is that this is what a finer grid means -- smaller regions,
smaller tiles, smaller villages. It is not, and the measurement that says so is
worth keeping. **Ask what area the catchment actually reached, and compare it
with the disc it asked for:**

    pop   radius   maps          reached      wanted     coverage
     20   1010 m   127 CAPPED    1.73 km2     3.20 km2      54%
     60   1578 m   127 CAPPED    1.73 km2     7.82 km2      22%
    120   2465 m   127 CAPPED    1.73 km2    19.09 km2       9%
    400   3852 m   127 CAPPED    1.73 km2    46.61 km2       4%

The reached figure never moves. `World.CATCHMENT_MAPS` was 127 -- a cap on how
many sub-maps a catchment may gather -- and **a count of maps is a quantity of
work, not a quantity of world.** A ground tile went from 425.7 m2 to 149.7, so
the same 127 maps covered 1.73 km2 instead of 4.92, and every settlement lost
nearly two thirds of its farmland to a change of map resolution.

Worse, at that tile size the cap bound at *every* population, a hamlet of
twenty included. So `limitedBy: 'land'` had quietly stopped meaning the land had
run out and started meaning the search had -- and it reported the same word
either way, which is why this survived a re-grid without anybody noticing.

Fix: state the budget as an AREA, `CATCHMENT_REACH_M2 = 4.92e6`, and derive the
map count from it and the tile size. A finer grid then costs more maps to cover
the same ground instead of silently covering less. Capacity came back to 415.

Two things worth carrying out of this:

* The 4.92 km2 is what the old cap happened to work out to. That is a fine
  figure to inherit -- 492 hectares is about what a village of a few hundred
  works once waste, wood and pasture are counted -- but it is a budget, and the
  comment says so rather than dressing it as a measurement.
* This is the second time in two days that a constant expressed in the wrong
  unit has survived a change of resolution. The other was the mosaic threshold,
  written once in parent-pixels and once in tile-pixels. The pattern: anything
  measured in *cells* is a bug waiting for the grid to change, because the grid
  is exactly the thing cells are not invariant to.

## Three constants in a row that a re-grid quietly invalidated

Re-gridding the world map from 24x8 to 39x14 broke four checks that had nothing
to do with the caps it was done for. Each was the same mistake in a different
costume, and together they are the clearest statement of it this project has:

**a constant expressed in cells, maps, pixels or metres-beside-an-implied-span
is not invariant to the grid, and the grid is the one thing that changes under
it.**

| what it said | unit | what broke |
|---|---|---|
| `CATCHMENT_MAPS = 127` | sub-maps | catchments covered 1.73 km2 instead of 4.92, so every settlement lost 57% of its farmland |
| `maxStep / minStep < 3.5` | ratio fitted to one band | 3.90 on a band reaching 77.6 degrees, which is inherent rather than faulty |
| `smallest > 1` px2 | screen pixels | tiles fell to 0.449 px2 at a viewport sized when regions were 2.6x larger |
| `hi - lo > 0.5` m | metres beside a 232 m span | 0.490 m across a span that had shrunk to 143 m |

Only the first was a bug in the simulation. The other three were checks that
had quietly encoded the old resolution, and the fixes are all the same shape --
say the thing in units the grid cannot move:

* the catchment budget became an AREA, with the map count derived from it;
* the neighbour spread became a PREDICTION from the projection's own arithmetic,
  computed for the outermost row, rather than a ratio somebody liked;
* the tile-degeneracy check got a viewport scaled by the square root of the
  cell-count change, because it measures shape and shape needs pixels;
* the ground-relief check became a FRACTION of what the Hurst exponent predicts
  from the mesh roughness across the map's own span.

The tell for the whole class: a check that fails on a change of resolution while
the thing it describes is physically unchanged. Every one of these four went
from passing to failing without a single line of physics moving.

Worth noting which one was real. `CATCHMENT_MAPS` was doing a geographer's job
with a compute budget, and it reported its own truncation as `limitedBy:
'land'` -- indistinguishable, in the output, from the land genuinely running
out. That is why it survived a re-grid unnoticed while the other three failed
loudly and immediately. A cap that lies about why it stopped is worth more
suspicion than one that simply stops.

## "The constituent hexes are not being drawn", the fourth time

Reported after the world map went from 192 cells to 546. The tiles were being
drawn perfectly and none of them were visible.

The measurement that separated those two possibilities, and the reason it was
worth taking before touching anything: **count fills and strokes separately.**

    window | tile px | fills  | strokes
       520 |    4.26 |  26296 |       4
       900 |    7.37 |  26296 |       4
      1000 |    8.19 |  26296 |   24153

The fills never move. Every tile was being filled at every window size, so the
mosaic gate -- the thing blamed the previous three times -- was fine. What
switched at 1000 px was the *outlines*, and without them 26,296 filled hexagons
of nearly the same colour merge into one flat field. The grid was invisible
while being drawn.

The cause was reusing `GRID_MIN_PX = 8` for two different questions. It guards a
REGION's outline, which is a 1.5 px line at full opacity, and the eight pixels
is an argument about that line swamping a small shape -- the comment says so:
"outlining a 3 px hexagon paints over everything it was supposed to bound". A
TILE's edge is a 0.5 px hairline at 35% alpha and can swamp nothing. Held to the
same eight pixels anyway, it switched off the moment a tile fell from 11.98 px
to 7.37, which is exactly what tripling the cell count does.

Fix: the hairline's weight scales with the tile instead of the tile being
required to reach a weight. `tileEdgeWidth` gives a line one sixteenth of the
tile's width -- which reproduces the old 0.5 px exactly at the 8 px tile it was
written for -- clamped to 0.25..0.6. A line that is always the same fraction of
what it bounds cannot paint over it, so it can be drawn wherever a tile is drawn
at all, and this is back to one threshold rather than two.

The pattern, since this is the fourth report of the same sentence:

* twice the cause was how the tiles were drawn (fixed-size hexagons dropped at
  projected centres; then a tint standing in for the mosaic),
* twice it has been the line deciding whether to draw them -- first
  `MOSAIC_MIN_PX` stated in two different units, now `GRID_MIN_PX` answering two
  different questions.

Both of the latter were resolution-dependent constants, and both surfaced on a
re-grid rather than on a rendering change. When this sentence is reported again,
count fills and strokes first: it says in one line which half of the pipeline to
look at.

## Making the cells the same size, and two ways that did not

The band gave every cell identical AREA and wildly different shape: 1.01:1 at
the equator, 2.56:1 at 50 degrees, 5.60:1 in the outermost row. Asked for cells
that are the same size as each other, the answer is that you cannot have uniform
shape, uniform area and no pentagons at once -- Gauss says a flat hexagonal
lattice does not lie on a sphere without distortion, Euler says twelve pentagons
if you want a closed hexagonal tiling -- so the tiling moved to a geodesic and
took the twelve, two of which hide inside the storms.

The raw geodesic was not good enough on its own. Its pentagons came out **half**
the area of its hexagons, because the subdivision walks the flat icosahedron
face in even steps and then pushes each point out to the sphere: a chord of
fixed length subtends less angle the further it sits from the middle of an edge,
so points bunch towards the corners -- and the corners are exactly where the
twelve pentagons are. Measured: a pentagon's neighbours 7.90 degrees away, a
hexagon's 9.95.

* ~~Lloyd relaxation: move every cell to the centroid of its own corners,
  repeat~~ -- **made it worse.** Area spread 2.264 to 2.509, pentagons 0.513 of
  the mean down to 0.438, over sixty passes. Lloyd's converges to a centroidal
  Voronoi tessellation only if the Voronoi diagram is recomputed each pass; here
  the corners are the dual of a FIXED triangulation, so once the points move the
  corners stop being the cell's own boundary and the iteration optimises a shape
  that is no longer there. It converges confidently to the wrong answer, which
  is worse than not converging.

* ~~Equal-arc subdivision, slerping rows between the wrong pair of edges~~ --
  collapsed points on top of each other. 478 cells instead of 492 and a minimum
  neighbour spacing of zero. The cell count is the check worth keeping: a
  class-I geodesic has exactly 10f^2 + 2 points and any other number means the
  lattice is wrong, so this failed loudly instead of silently.

What worked was equal-arc subdivision with the rows laid out correctly -- row i
running from a point on AB to the matching point on AC, holding i + 1 points.
Points then sit at equal ANGLES along each edge, 9.06 degrees here, and the
corner compression goes with them.

    measure                     band     geodesic
    neighbour spacing spread    3.90      1.207
    hexagon area spread         1.000     1.134
    pentagon, share of mean      --       0.679
    worst cell aspect           5.60:1    near 1
    storm cap radius            12.42     12.02 degrees

The pentagons stay smaller than the hexagons and always will: they are where the
sphere's curvature is concentrated, and that is the bill Euler sends. 0.679 is
what the geometry costs rather than an artefact left in by accident.

Worth keeping from this: **a construction that changes a count is easier to
debug than one that changes a shape.** Both failures above produced plausible
pictures; only one of them changed 492 to 478, and that was the one found in a
minute rather than an hour.

## The 57% relief shortfall was an error in the ruler, not the terrain

Recorded in known-gaps as: the ladder delivers 0.565 of the relief its own Hurst
anchor predicts, constant across six layers, so one amplitude constant is low by
1.8x. The constancy was the evidence -- a fixed ratio across three orders of
magnitude looks exactly like a single wrong multiplier.

It was the ruler. `reliefM` is the elevation spread over a cell **and its six
neighbours**, so the span it describes is about TWO cell widths, 137 km, and the
prediction divided by ONE, 68 km. Relief goes as span^0.7, so the prediction was
too big by (137/68)^0.7 = 1.62 -- almost exactly the 1.8 the "missing" amplitude
was supposed to supply.

Corrected, the ladder tracks its anchor to 0.68, 0.58, 0.52, 0.76, 1.10, 0.91,
0.81 by layer: scatter around 1, worst at the middle layers, and the deep layers
where detail dominates averaging 0.94. There is no missing multiplier.

WHAT SAVED IT WAS A SECOND MEASUREMENT DISAGREEING. Before changing anything the
detail amplitude was swept, and matching the anchor exactly needed a factor of
1.8 -- which produced **70.8-degree cliffs**. Terrain that steep is not terrain,
so either the ladder or the anchor was wrong, and only then did the baseline get
checked. Had the sweep produced something plausible the world would have been
inflated 1.8x to satisfy an arithmetic mistake.

    K      layers 3-7 vs anchor        steepest
    1.0    0.61 0.75 0.86 0.85 0.87    below 70
    1.5    0.61 0.75 0.86 0.85 0.87    67.3 deg
    1.8    0.71 0.88 1.03 1.02 1.04    70.8 deg

Two things worth keeping. The first is that a constant ratio is evidence of a
single wrong factor and says nothing about WHICH side it is on -- the anchor is
as likely to be wrong as the thing being anchored, and the anchor is the one
nobody re-derives. The second is that a fix which has to make the world
physically absurd to satisfy a number is telling you the number is wrong.

What survives is smaller and is measured: the median land slope is 1.1 degrees
against Earth's 2 to 3, while the tail is right at 22.4 degrees for the 99th
percentile and 30.7 at the steepest. Gentle middling ground, not a flat world.

## The world is smooth in the middle, and it is not the mesh's fault

The standing explanation, recorded in known-gaps.md, was that the ladder
inherits the mesh's resolution: detail amplitude is anchored to `reliefM`,
which is the mesh's own elevation spread, so a smooth mesh makes a smooth
world at every scale below it. The prescribed fix was to anchor the amplitude
to a MEASURED local relief instead.

**The premise is wrong, measured.** `LOCAL_RELIEF_MOUNTAIN_M` (900 m per 10 km)
and `LOCAL_RELIEF_PLAIN_M` (18) are the measured law, and the mesh already
matches it at both ends. Converting the mesh's `reliefM` to a ten-kilometre
baseline -- remembering that `reliefM` spans a cell AND its neighbours, so two
cells, 68.4 km -- over 143,489 land cells:

    percentile   mesh relief   as 10 km relief   measured
    5th               86 m            22 m       18 (plain)
    median           208 m            54 m
    95th            1525 m           397 m
    99th            3522 m           917 m       900 (mountain)

Twenty-two against eighteen at the flat end, 917 against 900 at the steep end.
The mesh is not smooth and there is nothing to re-anchor: the anchors and the
mesh already agree. Note also that `LOCAL_RELIEF_MOUNTAIN_M` and
`LOCAL_RELIEF_PLAIN_M` had never been read by any code -- `reliefScale` in
submap.ts computed something from the baseline and threw it away.

### Where the relief actually goes

The ladder delivers about two thirds of the law at every scale, not a
resolution-dependent shortfall. Descending a mountain, comparing the relief
produced across a cell and its neighbours against the law for that span:

    depth   spacing     span    produced   law says   ratio
      1     112.7km   225.3km     1321 m     1906 m    0.693
      2      11.8km    23.6km      382 m      770 m    0.497
      3       1.2km     2.5km       97 m      161 m    0.599
      4        130m      260m     24.9 m     33.5 m    0.743
      5         14m       27m     4.60 m     6.92 m    0.666
      6       1.43m     2.85m     1.01 m     1.43 m    0.709

Over 40 maps of ordinary land at 129 m cells the median ratio is 0.525, and it
is the same for gentle and rolling ground (0.521 and 0.580), so it is a
constant and not a shape effect.

**The cause: `detailAmp` is a noise amplitude and is used as though it were a
relief.** Note first that the amplitude formula is already right -- it divides
by one mesh spacing where `reliefM` spans two, and the target span is two
sub-cells, so the factor of two cancels and `detailAmp` equals the law's
predicted relief exactly. The loss is in what the noise then does with it.
Measured over 34,848 samples of `fbm3` at the ladder's own geometry (cells at
sqrt(3)·cellRad, noise at 0.45/cellRad, five octaves):

    unit-amplitude value range    -0.521 .. 0.528     (not -1 .. 1)
    rms                            0.134
    local relief realised across a cell and its six neighbours,
    per unit of nominal amplitude:
      10th 0.219   median 0.349   mean 0.356   90th 0.503

So an amplitude of L metres realises 0.349·L of local relief. The parent's own
gradient supplies the rest of the measured 0.525.

### ~~Divide detailAmp by the measured 0.349 response~~

The obvious correction, and it is wrong. It lands the direct Earth comparison
beautifully -- over 40 maps at 132 m cells the median slope goes 0.77 to 2.17
degrees against Earth's roughly 2, and the steepest goes to 29.2 against
Earth's 25-to-35-degree mountainsides -- and the whole suite passes with 73
measurements moved and none failing.

**What killed it: the implied Hurst exponent went 0.649 to 0.537**, away from
the anchored 0.70, and the world became LESS self-affine rather than more.
The reason is `belowMesh`, the linear ramp that tapers detail off as a layer's
cells approach the mesh's. Layer 2 straddles it and gained only 27% where
layer 3 gained 146%, so the exponent between those two layers collapsed from
0.635 to 0.339. Multiplying by 2.865 after the ramp does not scale the ramp's
distortion, it magnifies it. `steepest slope down to the plot layer` also went
25.9 to 53.8 degrees, which is the same discontinuity seen as a gradient.

### What the measurements point at instead

The taper is the thing that is wrong, not the amplitude. Independent random
fields add in quadrature, so the parent's contribution should be removed that
way rather than by a linear ramp:

    R_detail = sqrt(max(0, R_target^2 - R_parent^2))

and the parent's contribution at a span below its own resolution is its
gradient times that span, which for a patch of `count` children is a constant
of the geometry:

    R_parent(S) / R_target(S) = count^(-(1-H)/2) = 91^(-0.15) = 0.508

Quadrature with the measured noise response then predicts the ratio the world
actually shows: sqrt(0.508^2 + 0.349^2) = 0.617 against a measured 0.525,
which is the right size. Setting the detail to supply the remainder,
0.861·R_target, would put the total on the law by construction at every layer
INCLUDING the mesh transition, which is exactly where the flat divide broke.

This has not been implemented. It replaces `belowMesh` with a derived quantity
and moves every terrain measurement in the project, including gameplay ones --
the flat-divide experiment took `daughters founded` from 10 to 5 -- so it is a
decision rather than a correction.

### ~~Quadrature taper: detail supplies the shortfall the base does not~~

The successor to the flat divide, and it fails on the same layer for a reason
the flat divide hid. The design: the base's share of the target relief is a
constant of the patch geometry, `(spacing/baseRes)^(1-H)` = 91^-0.15 = 0.508 at
every depth, so detail supplies `sqrt(1 - 0.508^2)` = 0.861 of the target in
quadrature, divided by the measured noise response. `belowMesh` is deleted --
the taper is derived rather than ramped, and it is continuous across a map
boundary for free because it depends on the layer and not on position.

Two of the three indicators landed well. Over 40 maps at 132 m cells the median
slope went 0.77 to 1.87 degrees against Earth's roughly 2, and the steepest
25.84 against Earth's 25-to-35-degree mountainsides. The suite's own `ground
map relief, as a share of what Hurst predicts` went 0.563 to 0.774. The
per-cell ratio against the law went from 0.525 to 1.235 at the median, with the
steep bucket at 1.081. The whole suite passed, 71 moved, none failing.

**What killed it: the implied Hurst exponent went 0.649 to 0.556**, against an
anchored 0.70 and a gate of "back near 0.70", and `steepest slope down to the
plot layer` went 25.9 to 49.8 degrees, which is past any real mountainside.

**But the diagnosis is new, and it is not the taper.** Exponent between each
pair of consecutive layers, whole-map relief, before and after:

    layers   before    after
     2->3     0.634    0.359
     3->4     0.592    0.580
     4->5     0.721    0.728
     5->6     0.666    0.652
     6->7     0.660    0.658

Every layer below the third is unchanged to within noise. The break is entirely
at 2->3, and layer 2 is the reason: its map spans about 11 cells of 11.8 km,
roughly 130 km, while its PARENT's cells are 11.8 x sqrt(91) = 112.7 km. A map
whose whole width is barely wider than one parent cell is measuring its
parent's cell-to-cell steps, not its own ground, so no amount of added detail
moves it -- while layer 3 and everything below responds in full. The ratio
between them is what breaks, and the implied exponent is measured across
exactly that pair.

**The structural cause, which is worth more than the attempt.** The ladder's
first layer has 112.7 km cells and the physics mesh has 34.2 km cells, so the
FIRST SUB-MAP IS COARSER THAN THE MESH IT READS. The mesh's real tectonic
detail between 34 and 112 km is discarded at depth 1 -- correctly, since depth
1 cannot represent it -- and no layer ever puts it back, because depth 2 adds
noise at its own 11.8 km scale rather than at the 34-112 km scale that went
missing. That band is a hole in the world's spectrum, and it sits exactly where
the implied-exponent measurement takes its top reading.

Nothing here is fixed by a better taper. What would fix it is either a ladder
whose first layer is no coarser than the mesh, or a depth-2 sample that reads
the mesh directly for the band its parent could not carry. Both are larger than
this attempt.

Kept from the attempt: `FBM_LOCAL_RELIEF_RESPONSE` in noise.ts and
verify_noise.ts, which measure and police the fact that fbm3 delivers 0.349 of
its nominal amplitude as local relief and spans -0.52 to 0.53 rather than the
[-1, 1] its comment claimed. That measurement is what any future attempt needs
and it is true whether or not the ladder uses it yet.

### The seam was real, and it was not the cause -- both measured

The previous entry blamed the 2->3 exponent collapse on the ladder's first
sub-map being coarser than the physics mesh, and proposed closing that hole.
The hole is real and is now closed. It was **not** the cause, and the
measurement says so flatly: with the seam closed and the same quadrature taper
applied, the implied Hurst read **0.555983** against **0.555966** without it.
Seventeen millionths. Closing it changed that measurement by nothing at all.

Worth stating plainly because the earlier entry sounded confident.

**~~Quadrature taper, second attempt, with the seam closed~~.** Implied Hurst
0.649 -> 0.556, `steepest slope down to the plot layer` 25.9 -> 50.5 degrees,
and three assertions failed rather than none: an idle-settlement check, a root
cohesion check and a specialisation check. Worse than the first attempt, and
killed for the same reason.

**Why it compounds, which is the finding worth keeping.** The overshoot against
the law grows with depth -- 0.844, 1.279, 1.729, 1.591, 1.757 down the ladder --
and that growth IS the loss of self-affinity. The taper is OPEN-LOOP: it
computes what the base *ought* to be carrying, from the mesh's relief scaled by
the Hurst exponent, and never looks at what the base actually has. When a layer
comes out above target, the layer below still adds its full nominal share on
top, and the error accumulates instead of correcting.

A self-correcting version would measure the base's real relief. That is exactly
the per-map measurement submap.ts rejects, for a good reason recorded above it:
two neighbouring maps measure different numbers, add different amounts of
detail, and disagree along the edge they share. So the tension is real and it
is a design choice, not an oversight -- continuity buys an open loop. Any third
attempt has to break that trade rather than tune inside it: a base-relief
measurement that is a continuous FIELD, sampled the way `reliefM` is, would do
it, and nothing else obvious would.

## The first sub-map was coarser than the mesh it read

Kept, separately from the taper it was meant to enable, because it is right on
its own.

`World.subMap` based every layer below the first on the map above it. At depth 2
that is wrong: the first sub-map has 112.7 km cells and the physics mesh has
34.2 km ones, so depth 1 is a downsample and everything the mesh knows between
those two scales -- real mountain belts, rifts, dissected margins, simulated --
was discarded there and never came back, because depth 2 added noise at its own
11.8 km instead. A hole in the world's spectrum.

The rule now is that a layer reads whichever of the parent map and the mesh
out-resolves it, which is the mesh at depths 1 and 2 and the parent below.
Nothing is lost by skipping the parent at depth 2, because a layer coarser than
the mesh adds no detail of its own -- its field IS the downsample. Continuity
improves rather than suffers: two neighbouring depth-2 maps now read one
continuous mesh instead of two different parents.

Measured over 40 maps at 132 m cells, the mesh's structure arriving as it
should -- the middle unchanged, the tail much fatter:

                median   99th    max
    before        0.76    2.62    3.74 degrees
    after         0.76    8.08   11.15

and the implied Hurst exponent went 0.649 to 0.665, toward the anchored 0.70.
72 measurements moved, none failing.

One measurement fell a long way and is redistribution rather than loss: the
sampled ground site's relief went 5.26 m to 1.60 m, because the seam fix
changes which mesh ground each site descends onto and that site now sits on
genuinely smoother mesh. Its assertion, which is bounded an order of magnitude
either side, still passes, and the mountain descent got rougher at every layer
from 2 to 5 over the same change.

**A stale assertion went with it, and it was the test.** `idleness is only a
diagnostic` seated 200 people and asserted the settlement does not spread. It
spread. Not because idleness became a trigger -- because the reference site's
carrying capacity fell from 378 to 233, so 200 people were filling 86% of the
land and the settlement threw off a daughter from LAND PRESSURE, correctly. The
assertion was right and its premise had expired. A flat 200 is the same
grid-dependence this file has recorded three times before, so the test now asks
the ground how many people half fill it and seats that.

## The mosaic drew a tile in one place and opening it put the tile elsewhere

Every cell is drawn out of its own children. Those children were laid out as a
flat hex grid stamped inside the parent's hexagon and turned thirty degrees,
and the thirty was reasoned rather than measured: ninety-one pointy-top hexes
arrange into a flat-top hexagon, so a thirty-degree turn puts the grain of the
small hexes parallel to the big one's edges. That is correct for a hexagon of
hexagons drawn on a page.

It is not correct here, for two reasons that compound. A child map's basis
faces its OWN first neighbour, which is thirty degrees from its parent's only
by accident. And the ground is a sphere, so even the right turn would not make
a flat stamp land on the projected positions.

**Measured, over 455 children of five parent cells: the flat layout was out by
15.97 child widths at worst** -- more than the radius of the map it was drawn
inside. So the layer above showed a tile in one place and opening it put that
tile somewhere else entirely, at every depth, compounding as you descended.

Children are now placed by the same projection as everything else, through the
frame's inverse. The same measurement: **0.000031 child widths**.

~~Placing them per frame~~ was the obvious way and is too slow: a map of 91
cells asks for 91 child maps of 91 cells, so 8,281 placements for one map and
seven maps on screen -- 116,000 spherical projections a frame. Placement is
linear in the drawing size and depends only on (map, frame), so it is computed
once at unit size and multiplied at the point of use. The rebuild then happens
when the player crosses a tile boundary, not sixty times a second.

## The world view redrew an identical picture sixty times a second

The globe is 23,506 filled polygons and about 30 ms of geometry, and the render
loop drew it every frame whether or not anything had changed. A globe sitting
still cost exactly as much as one being dragged.

Two changes, measured on a stub canvas at 1400x900:

    world view, still (tiles drawn)     29.8 ms   23,506 fills
    world view, moving (tint only)       3.6 ms    2,009 fills
    depth 2, +10 neighbours, still       9.6 ms   40,204 fills
    depth 2, +10 neighbours, moving      0.2 ms      437 fills

First, nothing draws unless something changed. A still picture now costs
nothing at all rather than 30 ms a frame.

Second, while the view is MOVING the mosaic is skipped and cells are drawn in
their blended colour. A tile a few pixels across is not distinguishable from
that blend while it is sliding past, and drawing 91 of them per cell is most of
the frame. The detail returns SETTLE_MS after the last input -- a free
parameter, and labelled as one: it wants to be longer than the gap between
mouse events so a steady drag does not flicker between the two pictures, and
short enough that letting go feels immediate. Nothing measures where that is.

Note what was NOT done: raising MOSAIC_MIN_PX. It would have cut the same work
by drawing fewer tiles, and it would have taken the constituent tiles off the
world view altogether at its default zoom -- which is a feature, not a cost.

## The children of adjacent parents were two lattices at twenty-seven degrees

A cell is drawn out of its own children, and the children of one cell never
lined up with the children of the next. The renderer hid it: `COVER` scaled
every tile 10.15% further out than its true position so a cell's 91 tiles
reached its outline instead of leaving a fringe, and the mosaic was clipped to
the parent so the overspill did not show. Two fudges pointing at one fault.

**The fault: a child map was laid out facing its parent's first neighbour.**
That puts the child lattice at 0 degrees to the parent's grain, and it is the
wrong angle. A centred hexagon of 3R^2+3R+1 cells is a fundamental domain of
the sublattice of the triangular lattice generated by the axial vector
(R+1, R) -- checked for R = 1 to 8, every one of them tiles the plane -- so the
PARENT grid is the child grid scaled by sqrt(count) and turned by that vector's
angle, which at R=5 is

    atan2(1.5 x 5, sqrt(3) x 8.5) = 26.996 degrees

Turn the child map by it and one parent's children and the next parent's are
one lattice. Leave it and they are two grids at 27 degrees, which no amount of
covering or clipping can reconcile.

Measured, distance from a child to the nearest child of the ADJOINING parent,
in child spacings, where a lattice neighbour is exactly 1:

                        min     10th    collisions
    facing its parent   0.453   0.537   12
    turned 26.996       0.991   0.999   0

Either sign of the turn works and gives identical numbers -- the two rosette
chiralities are mirror images -- so the positive one is used.

**Nesting, which is the same fact from the other side.** Children of a region
that land inside it, of 91: 83-89 before, and every hexagonal region exactly 91
after. One layer down, where the parent is a hex patch and therefore a true
lattice, the partition is EXACT and is now checked with no tolerance at all.

Two things that are still not exact, and cannot be. At the globe level a
hexagonal region loses a median of 1 child and at worst 10, because the layer
above a region is a Goldberg polyhedron rather than a lattice -- Gauss forbids
better. And the ten pentagons have no five-fold lattice for a rosette to align
to, which is Euler's twelve and not a defect in the layout.

**What came out with it.** `COVER` is deleted: a cell's tiles are not supposed
to fill its outline, they form a rosette that pushes past the edge in six
places and falls short in six others, and the neighbour's rosette fits those
gaps. The clip is deleted for the same reason -- it cut off exactly the
protrusions the neighbour needed -- and the suite's assertion that a clip
exists is inverted, so re-imposing one fails.

Drawing had to become passes rather than cell-by-cell. Filling a cell and then
drawing its tiles before moving to the next painted the NEXT cell's fill over
the last cell's protrusions, and its own tiles never covered that ground
because the ground belongs to the neighbour: every seam came out as a band of
flat parent colour between two mosaics. All the fills, then all the tiles, then
all the edges.

## Layer 2's tiles are tilted, and no orientation trick fixes it

Reported from the game: at the region layer some tiles are visibly turned
against their neighbours, and every layer below renders correctly. Measured, as
the angle between two adjoining maps' lattices reduced mod 60 degrees, which is
the symmetry a hex lattice has:

    layer 2, region to region     median 2.42   90th 9.55   worst 23.13 deg
    layer 3, inside one region    median 0.02   90th 0.05   worst  0.11 deg

The layers below work because a child map takes its orientation from the map
above it, whose cells ARE a lattice, so every child of one map runs the same
way. A region has no such parent: it faces its own first neighbour on the
globe, and the globe's neighbour bearings depart from a 60-degree lattice by up
to 20.45 degrees.

Three replacements were tried and measured. All are struck through.

**~~Orient every region to its icosahedral face~~.** All twenty faces are flat
and each has one east, carried into each region's tangent plane -- which is the
correct gnomonic pushforward, not an approximation. Median improved 2.42 to
1.31 and the WORST got worse, 23.13 to 28.91, so it was measured again split by
where the pair sits:

    both on one face (72.8% of pairs)   median 0.86   worst  5.35 deg
    across a face edge (27.2%)          median 5.36   worst 29.07 deg

It works inside a face and fails at the thirty edges. Turning every face's east
by 30 degrees to align it with an edge rather than a vertex changed nothing,
and could not have: a rotation applied to every face alike cannot change how
two faces relate. The real requirement is that the icosahedron's edge be a
whole number of lattice steps, and the region centres are not lattice points at
all -- which is the regrid, not an orientation.

**~~Fit each region's lattice to all six neighbours~~** rather than facing one,
via the hexatic order parameter -- angles multiplied by six so all six
neighbours land on top of each other, averaged, divided back. The best of the
three: median 1.33, 90th 5.03, worst 12.14. It halves the worst tilt and is
cheap. It does not remove it.

**~~Relax the orientation field over the whole globe~~**, averaging each
region's orientation with its neighbours' in that same six-fold representation,
on the reasoning that the defect would drain to the twelve pentagons where a
60-degree defect is invisible. It does not drain. Over 400 passes the median
sat still and the WORST rose from 12.14 to 28.59: the topological charge does
not spread out, it concentrates into a sharper seam somewhere else.

    passes    median   90th    worst
         0      1.33    5.03   12.14
        10      1.23    4.91   20.00
       100      1.28    5.00   29.90
       400      1.32    5.10   28.59

What all three have in common is that they try to give a lattice orientation to
cells that are not on a lattice. The layers below are not doing something
cleverer -- they are standing on a lattice. Layer 2 can only be made to render
the way they do by giving it one.

### ~~Phase 2 alone: put the world grid's centres on a planar lattice~~

The world grid is a Class-I geodesic whose subdivision points are placed by
EQUAL ARC (slerp). Equal arc gives near-uniform cells and is not a lattice:
the points are not the image of a regular triangular lattice in any face's
plane. The obvious phase-2 move is to place them by equal steps in the face
plane instead, which IS such an image.

Measured, both ways:

                              equal arc   planar lattice
    cell area spread            1.131        1.448
    layer 2 tilt, median         2.42         1.34 deg
    layer 2 tilt, WORST         23.13        23.34 deg

**The worst tilt does not move.** The median halves and the areas get 28% less
uniform, which is the trade this file already recorded once -- the comment in
sphere.ts notes the chord version was tried before and rejected because it
bunches points towards the corners and left pentagons at half a hexagon's area.

Why the worst does not move: a region map still takes its orientation from its
own neighbours' bearings, and near a face corner the gnomonic projection
distorts those by exactly as much as before. Putting the CENTRES on a lattice
does not help while the ORIENTATION is still read off the sphere, and putting
the orientation on a lattice does not help while the centres are not -- both
were tried separately and neither is sufficient.

What would work is both together AND the sub-maps laid out in face-plane
coordinates rather than each in its own tangent plane, so that every cell at
every depth is the image of one planar lattice per face. That is not phase 2;
it is phase 2 and phase 4 together, and it replaces sphere.ts, submap.ts and
patch.ts. The honest estimate is that it is the largest single change the
project has had.


## Plants have no visible size

The map knew how many trees stood on a hectare and could not draw one. Two
things were wrong and only the second was suspected.

### ~~Give each species a drawn silhouette and scale it~~ -- not attempted, and
here is why

A silhouette is a capability typed in: it fixes how thick a trunk is, how many
twigs hang off it and how dense a crown is, and none of those would then respond
to the plant's mass. The whole point of a species sheet is that changing the
mature mass changes the picture. Solving the shape instead costs one file and
gives four numbers that can be checked against a tape.

### The geometry found a part share that had been wrong since it was written

Hazel carried `Twig 0.09` and no `Branch` part at all. Nothing complained: the
shares summed to one, every composition check passed, and a hazel weighed what
a hazel weighs. Then the pipe model divided nine per cent of the plant among a
single year's shoots and handed back a twig **fifteen millimetres thick**, which
is a broom handle.

Most of that mass is older side wood, which is Branch. Split at `Branch 0.062,
Twig 0.028` and the derived twig comes out at **2.6 mm**, against a measured 2
to 5. Oak, which already had both parts, needed no change and came out at
**5.0 mm** against a measured 4 to 8.

The point worth keeping: no test of composition, mass or nutrition could ever
have caught this. It took a second, independent consumer of the same numbers.

### `spreadAt` was taking the site off twice

Found by `a stunted oak is thin as well as short`, which failed at 0.79 where
geometry demands 0.74 -- and would have read **1.00** at saturation.

`spreadAt` was `matureSpreadM * site * cbrt(m / (matureMassKg * site))`. The
mass already carries the site; multiplying by it again counted the same fact
twice, so a poor-site oak had 40% of the mass in a volume 40% as wide -- the
same wood packed into a sixth of the space. `heightM` inherited the same shape
when it was written. The two errors then CANCELLED in the trunk derivation,
because diameter goes as sqrt(volume / length), which is why a stunted oak came
out with a thriving oak's bole and nothing else ever noticed.

Both are now `cbrt(m / matureMassKg)` and nothing else. Measured after:

        mass ratio at 150 years        0.197
        trunk ratio                    0.582   = cbrt(0.197)
        height ratio                   0.582   identical, as it must be
        trunk ratio at saturation      0.737   = cbrt(0.4), the site ratio

### The check that failed for the third time for the same reason

`a stunted oak is thin as well as short` first asserted the trunk ratio against
`cbrt(0.4)` -- the cube root of the SITE -- and got 0.582. That is not the rule
failing. At 150 years the poor tree is at a fifth of the good tree's mass, not
two fifths, because a poor site slows growth as well as capping it.

This is the third time an unsaturated curve has been read as if it were
saturated (see the mass ceiling check in `verify_plant.ts`, which did it at 400
years and again at 4,000). **The habit to break: any ratio taken between two
growth curves with different rates is a ratio of two paces as well as two
ceilings, unless both have finished.** The fix each time is the same -- measure
at saturation for the ceiling, measure the ratio against the actual mass ratio
for everything else, and never let one number stand for both.


## The wood on the screen was not the wood in the model

`stand.ts` places individual plants; the check that matters is whether the
plants you could count and fell weigh what the timber model says stands there.
First measurement: **0.646**. A third of the forest was missing.

### ~~The age distribution is wrong~~ -- it was right, and it was not being drawn

The suspicion was that an exponential age structure is too young to carry the
mass. It is not: `meanAgeFor` solves for the mean age whose distribution has
exactly the anchor mass, and `meanMassOfStand` at that age reads 662.252 kg
against a target of 662.252. The distribution was correct and the sampling from
it was not.

### Gradient noise is not uniform, for the SECOND time in this project

`noise3` is a sum of interpolated gradients, so it is bell-shaped about 0.5
with a standard deviation of 0.130. Ages were drawn through the inverse
exponential, `-mean.ln(1-u)`, which needs a uniform `u`. With a bell-shaped one,
every tree lands near the median and the old trees that carry most of a wood's
mass are simply absent.

The renderer already had this exact bug and already had the fix inlined in
`underCanopy` -- an 81%-cover forest drawing as solid leaf. Two independent
callers falling into the same hole is where a fix stops being local, so the
correction is now `uniform3` in `noise.ts` and both call it.

Measured after:

        drawn wood over one hectare      0.646  ->  0.996
        over a hundred hectares          0.646  ->  0.994
        share of parish tiles with a tree 1.00   ->  0.305 (wanted 0.329)

### Two of the four failures were the test, and saying so

`trees on a parish-layer tile = 3.48` was asserted to be less than one. The
assertion was right about what it wanted and wrong about the arithmetic: 13 m
was picked by guessing rather than by dividing, and a 13 m tile is 146 m2,
which at 238 trees a hectare holds three and a half of them. Four metres gives
14 m2 and a third of a tree.

`the same ground grows the same wood` compared a stand of trees-and-shrubs
against a stand of trees-shrubs-and-vines. Nothing was wrong with the ground.


## Plants visible at one zoom only

Sampling plants on the tile grid works at exactly one layer, because the tile
grid changes size by a factor of 9.5 per layer and a crown does not. Measured:
2,795 plants at layer 5, zero at 6 and 7.

### ~~Gather from a neighbourhood of tiles~~ -- not attempted, and the arithmetic says why

The obvious fix is to let each tile collect stems from the tiles within a crown
radius. At layer 6 a crown is 90 tiles across, so that is a 181x181 = 32,761
tile neighbourhood per drawn tile. It also does not terminate: two layers below
that it is 3,000 tiles across.

### The crown lattice, anchored to the region

Plants are sampled on a square lattice whose cell is CROWN_GRID_M -- derived,
being the widest mature spread in the species list, currently 18 m for the oak.
The number of stems in a cell is then a property of the ground rather than of
the zoom, and the lattice can be walked one cell past the screen edge to catch
what overhangs it.

Anchored to the REGION and not to the map being drawn, because a per-map
lattice would move every tree each time the player descended a step. Drawn once
a frame and not once a map, because two adjoining maps would each claim the
cells along the edge they share and stamp the same trees twice.

Measured, and note that the shallow layers got FASTER, because the per-tile
pass is gone entirely:

                        before        after
    layer 2 drag     16 ms median   10 ms median
    layer 4 drag     16 ms median   10 ms median
    layer 5 drag     20 ms median   17 ms median
    layer 7 drag           --        4 ms median
    plants at layer 6      0            50
    plants at layer 7      0             2

### Then layer 7 stamped 89 full-screen crowns

Physically correct: a two-metre view in a closed wood really does sit under
about 150 crowns, every one of them wider than the screen. Painting them all is
36 screens of fill for a picture indistinguishable from three.

The cap is Beer's law again, which is the third place in this project the same
argument has turned up. Crowns overlap, so after n screens' worth of canopy the
fraction still showing what is behind is exp(-n): one leaves 37%, two 14%,
three 5%. CANOPY_DEPTH is 3 and the rest is paint on paint. Cells are walked
nearest-the-middle-first, so that what gets cut is furthest from what the
player is looking at rather than whichever corner the loop reached last.

    layer 6:  145 plants -> 50 drawn, 95 hidden
    layer 7:   89 plants ->  2 drawn, 87 hidden

### And then the biggest tree on screen was a fiftyfold upscale

A stamp is baked at a fixed size, so at the pace layer an 18 m oak asks for a
crown 14,000 px across from a 256 px image. Baking bigger is not an answer --
the same problem returns one layer down, and a 4,096 px bake of one oak is 64
MB.

Past MAX_STAMP_PX the plant is traced straight from its form instead, branch by
branch, at whatever detail the size deserves. That is about 500 strokes for an
oak and is affordable precisely BECAUSE it only happens when a crown fills the
screen, which means there are two or three of them. Layer 7 drag: 4 ms median.

### Two harness bugs the change exposed, both mine

The tile test was "fills over 500", and a traced oak paints thousands of leaf
discs, so a flat layer 7 reported itself as drawn from its own tiles. It is now
fills minus arcs -- an arc is a leaf or a river, and a bare fill is a tile.

And the arc counter was not being reset per layer, so once it outgrew the fill
count every layer reported FLAT, including the world view, which had just been
reported as tiled two lines earlier.


## The sward reported itself as absent at every layer

The ground texture was written, wired, type-checked and measured at zero swards
laid on every one of the eight layers. That reads exactly like a renderer bug
and was not one.

The headless canvas stub returns null from createPattern -- which is an honest
thing for a stub to do, having no pixels to repeat -- and drawGround takes a
null pattern as "cannot draw" and returns false. So the entire turf path was
switched off in the harness only, and the harness was the only thing looking.

It now hands back a pattern object. Measured immediately after: 159 swards at
layer 5, 8 at layer 6, 5 at layer 7.

The general shape is worth keeping: a stub that returns a plausible failure
value will report a fault in the code under test. The stub's job is to be the
smallest browser that will do, and null is not what a browser does.


## The rot model had the right order and the wrong magnitudes

material.ts checked that oak heartwood outlasts oak sapwood outlasts leaf
litter, and it did. Nothing checked BY HOW MUCH, because nothing turned the
rates into a span of time. The first thing that did -- process.ts, asking how
long a beam lasts -- found:

    leaf litter half-life      3.0 years   against a measured 1
    oak heartwood              3.5 years   against a measured 20
    heartwood over sapwood      2.05x      against a measured 6 to 7

A gatepost was worth no more than the sapwood it should have outlasted.

### ~~Loosen the assertions~~ -- these are anchored quantities, not preferences

Timber durability is classified, published and used to specify buildings. Oak
sapwood is class 5 and oak heartwood is class 2, and the whole reason anyone
cuts heartwood out of a log is the gap between them. A model that says the gap
is twofold is wrong about the thing the material is for.

### Solve the constants from three measured durabilities

Oak leaf litter loses half its mass in its first year at 15 C. Oak sapwood in
ground contact has a half-life near 3 years. Oak heartwood near 20. Three
anchors, three constants.

### ~~Two constants, lignin and tannin~~ -- the fit is unstable, 0.225 vs 0.273

They CAN hit all three anchors, and only with constants so steep that a
percentage point of lignin swings durability by half. The reason is visible in
the numbers: a leaf and a plank have nearly the same lignin fraction of their
dry matter -- 0.225 against 0.273 -- and rot twenty-four times differently, so
lignin is being asked to explain a difference it does not cause.

### Nitrogen as the fourth term

The standard predictor of litter decay is the lignin-to-nitrogen ratio, and a
leaf is thirty times richer in protein than heartwood. With protein in, the
constants come out mild (3.08, 6.0, 4.59, 22.3) and the mechanism is the real
one: lignin slows decay, nitrogen feeds it, tannin poisons it.

    oak heartwood    19.99 years   (anchor 20)
    oak sapwood       2.92 years   (anchor 3)
    leaf litter       1.16 years   (anchor 1.15)

### And the fractions were being read off the wet mass

Found while fixing the above. rotResistance divided by the total INCLUDING
water, so soaking a beam lowered its lignin and tannin fractions and made it
chemically less durable -- while rotRate was separately multiplying by the same
wetness. The water was counted twice, and not slightly: oak heartwood at 30%
moisture came out at 8.9 years against 20 at 12%, purely from the arithmetic.

A wet oak beam rots faster because it is wet, not because it has stopped being
oak. There is now a check that soaking a beam changes nothing about its
chemistry.

## Four smaller faults in the verbs, all found by measurement

**Burning was stepped rather than integrated.** An instantaneous rate times the
span said a 10 kg log was gone in one hour; it takes 2.89. dm/dt = -k.m^(2/3),
so m^(1/3) falls at a constant rate and the closed form is exact. The whole
point of a rate-per-hour design is that a long step is the same answer as many
short ones, and it was not.

**Seasoning took nine years for a firewood round.** Two errors compounding. The
drying distance is HALF the thickness, because water leaves by the nearest
face. And "a year an inch" is the time to ARRIVE, not the time constant -- an
exponential is 95% of the way there after three of those. With both corrected a
24 cm round seasons in about a year, which is what a woodpile does.

**Equilibrium moisture was a straight line.** 0.185h passes through air-dry
correctly and then says saturated air leaves wood at 18.5% water, which is
drier than a bog log has ever been. Replaced with a rational curve through
(0.65, 0.12) -- the figure every timber table is quoted at -- and (1.0, 0.23),
the fibre saturation point.

**Threshing silently dropped what it had no bucket for.** The conservation
check caught it: 4.65 kg accounted for out of a 5.82 kg sheaf. The missing
kilogramme was ROOTS, which a scythe never lifts. Harvest now leaves them
unless asked to dig, which is the difference between reaping wheat and pulling
a carrot, and thresh has an "other" bucket so nothing can vanish again.


## A cow wintered comfortably on straw

She must not. That is the constraint the whole medieval agricultural year is
built around -- the reason for hay meadows, for autumn slaughter, and for the
February in which stock that survived came out of the byre unable to stand.

The first model let her live on it with room to spare, and two things were
missing rather than one.

### Fibre digestibility is not a property of the gut alone

`Digestion.fibre` was a flat number per gut: a rumen got half the cellulose out
of anything. So young grass and cereal straw were equally good fibre, which
makes straw a perfectly reasonable feed and it is not.

What separates them is LIGNIN, physically wrapped around the cellulose where a
rumen cannot reach -- the same fact that makes lignin-rich material rot slowly.
Anchored at both ends: young grass fibre is about 75% available, cereal straw
about 45%, and the lignin share of their fibre is 0.235 and 0.333. Two anchors,
two constants.

The curve then predicts a fallen oak leaf at 33%, which is why leaves are
browse and not fodder. Nothing told it there is such a thing as browse.

### An animal stops eating when it is full, not when it is fed

The second miss, and the larger one. `canLiveOn` asked whether a day's ration
fitted through the gut by VOLUME, which it always does. What actually limits a
ruminant is the fibre that will not ferment sitting in the rumen taking up
room, so the worse the forage the LESS of it can be eaten -- the opposite of
what a hungry animal would choose, and exactly why poor forage starves stock
that have plenty of it in front of them.

### ~~Limit on indigestible dry matter~~ -- compresses the range, 1.5x not 2x

Tried first, because it is the simpler statement. It counts ash and unabsorbed
protein as filling the rumen, and they do not: they pass. Measured, it gave a
grass-to-straw intake ratio of 1.49 where the real one is about 2.08, and the
cow survived on straw by a margin of two per cent.

### Limit on indigestible FIBRE

Which is what nutrition actually predicts intake from. One anchor -- a cow eats
2.5% of her body weight in dry matter of good grass, whose indigestible fibre
is 26% of its dry matter -- and the same constant then predicts straw at 1.36%
of body weight against a measured 1.2%.

    kcal she can get from a full day of straw    9,570
    kcal she needs                              11,627

She starves in a full yard.

## Three other cow figures, two of which were the check being wrong

**Intake, 6 kg of dry matter against an expected 11.** The model was right. The
11 kg everyone quotes is what a productive MODERN cow voluntarily eats; what
the model computes is the maintenance REQUIREMENT of a landrace, which is what
the published maintenance figures give. Need and appetite are different
quantities and are now checked separately.

**Water, 15 litres a day against a measured 40.** The model was wrong, and the
error was conflating water needed with water drunk. Cattle turn over about 4.5
litres per kilogramme of dry matter, and the feed supplies part of it: on
spring grass at 72% water she drinks 9 litres, and on straw she drinks 32. That
gap decides where stock can be kept.

**Dressing percentage, 0.63 against a measured 0.55.** It counted everything a
person will eat. Offal, blood and head are food and are not carcass; a butcher
weighs the beast alive and again on the hook, and the gap is the hide, the gut
fill and everything the hook does not hold.
