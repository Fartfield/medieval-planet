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
