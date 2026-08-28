# World generation

## The order is the argument

```
plates → elevation → sea level → temperature → rainfall → biome
```

Each step reads only from the steps above it. That is what makes the world look
like somewhere: rainfall is computed *after* relief, so air can be forced up a
slope and arrive dry on the far side, and a desert appears behind a mountain
range because a mountain range is there. Generate rainfall first and you get
noise with a legend.

## Tectonics

Fifteen plates — Earth has seven major and about eight minor. Nuclei are
scattered deterministically from the world seed and grown outward by a
**cost-weighted** flood fill rather than a plain breadth-first one. Plain BFS
gives graph-Voronoi cells whose boundaries are conspicuously straight; the
planet comes out looking like a football. Perturbing each step's cost with
noise makes the seams wander the way real sutures do, at the cost of needing a
heap instead of a queue.

Each plate gets a type (oceanic or continental) and a drift direction in its
own tangent plane, at 1–10 cm/yr — the rate satellite geodesy measures.

Elevation comes from what the plates are doing to each other at their shared
boundaries:

| meeting | result | example |
|---|---|---|
| continent + continent, converging | the crust has nowhere to go but up | Himalaya |
| ocean + continent, converging | trench offshore, cordillera onshore | Andes |
| ocean + ocean, converging | island arc | Japan |
| diverging, on land | the block drops | African rift |
| diverging, at sea | new hot crust is buoyant and stands **proud** | mid-Atlantic ridge |

The last one catches people out. A spreading ridge is three kilometres *above*
the abyssal plain either side of it.

The boundary signal is then smeared inland over four neighbour-averaging
passes, weighted toward each cell's own value so crests survive. A plate
boundary is a line; a mountain range is a hundred kilometres wide.

## Sea level is solved, not chosen

Rather than picking a sea level and hoping the coastlines look plausible, we
take the elevation that leaves exactly **29.2% of the surface above it** —
Earth's measured land fraction. Then each side of the shoreline is stretched
separately so the mean land height (840 m) and mean ocean depth (3,688 m) match
Earth's too.

That is the hypsometric curve pinned at three points instead of one, and it
means no amount of fiddling with noise amplitudes upstream can drown or flood
the world.

Measured: land fraction 29.2%, mean land 837 m, mean ocean −3,688 m.

## Climate

**Temperature** is a cubic in sin²(latitude), fitted to observed zonal means at
0, 30, 45, 60 and 90 degrees, minus the environmental lapse rate of 6.5 °C/km
for altitude.

The textbook sin² model — North's energy-balance approximation — runs about
10 °C too cold in the mid-latitudes, which drags the temperate forest belt
visibly toward the equator. The cubic fixes that. It is a fit to data, not a
physical model, and `known-gaps.md` records that a real energy balance should
replace it.

There is a small elegance here worth noticing: `sinLat` is read straight off the
cell's unit vector, because the y-component of a point on a unit sphere **is**
the sine of its latitude, exactly. The one place a planet really seems to want
a transcendental turns out not to need one.

**Rainfall** is the Hadley circulation seen from outside: air rises at the
equator and dumps its water, sinks dry at thirty degrees making every desert
belt on Earth, rises again at the polar front. Two Gaussian bands over a dry
background. Then three corrections, each visible on a real map:

* **warm air holds more water**, so the same circulation delivers less rain
  where it is cold. This is why the poles are deserts by rainfall.
* **continentality** — rain wrings out of an air mass as it travels inland,
  with a half-life of about 1,900 km.
* **orographic** — air forced up a slope rains; air descending the far side
  does not. The asymmetry between those two is what makes a rain shadow much
  drier than the windward side is wet. Prevailing wind is easterly in the
  tropics, westerly in the mid-latitudes and easterly again at the poles: the
  three-cell structure.

## Classification runs on aridity, not rainfall

Biome comes from Whittaker's classification — real vegetation plotted against
mean annual temperature and precipitation — with the tree line and the ice
limit taken from Köppen, because those are sharper: forest gives way to tundra
where the warmest month averages under 10 °C and to permanent ice under 0 °C.
Those are observed vegetation limits, and they are why the tree line climbs as
you approach the equator without anything in the code mentioning altitude.

The moisture axis is **not** rainfall. It is the UNEP aridity index —
precipitation over potential evapotranspiration, with PET from Holdridge
(58.93 × biotemperature). Biotemperature is the mean of the monthly means with
everything below 0 °C and above 30 °C clamped away, on the reasoning that plants
do no growing outside that range so those months should not count toward the
water they need.

This matters more than it sounds, and it is the single largest correction in
the project's history so far. See `fix-attempts.md`: absolute rainfall
thresholds have **no cold desert in them**. The model was classifying the Gobi,
the Great Basin, the Taklamakan and Patagonia as grassland, costing about a
third of Earth's desert area. Aridity gets it right because it asks how much
water a place has *relative to how fast it loses it* — and 200 mm is a desert
at 25 °C and a wetland at 0 °C.

## Water

Rivers used to stop at the edge of a sub-map. Each map computed flow
accumulation over its own 91 cells, every cell starting at one unit, and
normalised the result against its own biggest channel. Three things were wrong
with that and only the first was visible:

* A river ran to the rim and ended. The map next door started its own rivers
  from nothing, so nothing lined up across a boundary.
* A brook in a flat map painted as boldly as a trunk river in a mountainous
  one, because both were the largest thing in their own map.
* Flow died in any hollow, so the river below a basin lost everything above it.

### Cascade, do not consult

A map cannot ask its neighbours what they are sending it. They would have to
ask theirs, and the regress crosses the planet. It asks its **parent**, which
routed water at its own resolution and is generated on the way down anyway.
The parent knows which of its neighbours drain into this cell and how much each
carries. That is the entire boundary condition, and it is already in hand.

Water enters at **the lowest cell of the edge it crosses**. Nothing coordinates
the two maps on that point; they agree because elevation is a continuous
function of position on the sphere and both are sampling the same function
along the same line. The river leaves one map through its valley and enters the
next through the same valley.

### Absolute, so a river is the same river everywhere

Catchment is carried in square metres and discharge in cubic metres a second,
all the way down. That gives a conservation law to test against rather than a
picture to squint at: what leaves a map through its rim equals what entered it
plus what fell on it. It holds to six figures at every layer.

Following one trunk river down the ladder:

| Layer | Cell | Entering | Leaving |
|---|---|---|---|
| 1 march | 265 km | — | 1,108 m³/s |
| 2 shire | 27.8 km | 385 | 743 |
| 3 hundred | 2.9 km | 735 | 692 |
| 4 parish | 306 m | 692 | 691 |
| 5 plot | 32 m | 691 | 691 |

The same river, at every scale, arriving at the tile a person stands on.

### Runoff, not area

Discharge accumulates **runoff**, by Turc-Pike:

    AET = P / sqrt(1 + (P/PET)²),   runoff = P − AET

so a channel crossing ground that yields nothing gains nothing. A desert river
shrinks as it goes, which is the Nile below its last tributary, and no rule
says so — it falls out of accumulating the right quantity.

### Lakes are a by-product

Depressions are filled by priority flood before routing, because water does not
stop in a hollow: it fills it and goes over the lip. The level each cell fills
to *is* the level a lake would stand at, so lakes are what the fill leaves
behind rather than a feature anyone placed.

### What this does not claim

Flow accumulation on a 2,922 km cell is not a river. It is a divide structure —
which way a continent tilts — and that is all a sub-map needs from it. The
catchment number is right at every layer; the channel's *position* only starts
meaning something once cells are narrower than a valley.

## Rivers decide where the soil is

Navigability is solved rather than chosen. Leopold and Maddock measured twenty
river systems in 1953 and found width, depth and velocity each scale as a fixed
power of discharge, with the three exponents summing to one because their
product is the discharge itself. Inverting the depth law at a laden barge's
draught:

    d = 0.27·Q^0.40  →  Q = (0.9/0.27)^2.5 = 20.3 m³/s

The Thames at Teddington runs 66 m³/s and carried barges for a thousand years.
The Wey at 5 m³/s needed locks cut before it would. Twenty is the line between
them and nobody put it there.

The width half of the same relations gives the floodplain. Leopold and Wolman
found meander geometry locked to channel width — the belt a channel sweeps, and
therefore the floodplain it builds, is fifteen widths. Compare that with the
tile's own width and the answer is **the fraction of the tile that is valley
floor**: one on a plot beside a great river, a few per cent on a parish crossed
by a brook.

That fraction is what the soil model reads. It used to read a normalised
drainage rank instead, and the difference is the subject of a long entry in
`fix-attempts.md`: the rank reached 1.0 somewhere in every map, *including maps
with no river in them*, so every landscape's median tile was being treated as
half a floodplain. Absolute discharge broke that accidental calibration by
being honest about how little water a hillside carries.

## Relief follows a measured exponent

Terrain is self-affine, not self-similar: halve the horizontal scale and the
relief falls by rather less than half. The Hurst exponent for real land
surfaces measures 0.5 to 0.8, and detail amplitude had been falling as the full
first power of the wavelength — an exponent of 1.0, smoother than any real
landscape.

Applied seven times over, that left the finest layer with **one millimetre of
texture on a 41 cm tile**, and the plot a person stands on with five
centimetres across thirty-seven metres. At 0.7 they are 3.2 cm and 76 cm.

One exponent across seven orders of magnitude is an approximation and worth
saying so — different processes shape a mountain range and a ploughed field —
but a measured approximation beats an unmeasured one.

## Productivity

Net primary productivity comes from the **Miami model** (Lieth, 1975), an
empirical fit of observed plant growth against temperature and rainfall across
every biome on Earth. Growth is the lesser of what heat allows and what water
allows, which is why a hot desert and a cold bog are both barren for opposite
reasons.

This one number carries most of the economy: how much a field yields, how fast
a wood regrows, how many deer a forest can feed.

What a *person* can eat of it is a separate fraction, and it is the reason the
great early civilisations sat on floodplains rather than in the most fertile-
looking green on the map. A rainforest out-produces a wheat field several times
over and feeds almost nobody, because the productivity is locked in hardwood
and canopy. Those fractions are free parameters and are labelled as such.

## Calibration

The fit target is **land cover**, not rainfall — because land cover is what the
game consumes and what a player can look at and call wrong.

`verify/calibrate_climate.ts` sweeps the climate parameters and scores the
resulting cover against Earth's observed fractions. Current best fit:

| | model | Earth |
|---|---|---|
| forest | 32.0% | 31% |
| grassland | 27.9% | 25% |
| desert | 19.3% | 19% |
| tundra and ice | 17.4% | 20% |

Total absolute error 0.068, from 0.266 before the classification moved onto the
aridity index.

Run the sweep when a climate anchor changes, read the best row, put those values
in `anchors.ts`, and re-anchor the baseline.
