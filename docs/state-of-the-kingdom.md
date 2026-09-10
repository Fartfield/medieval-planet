# The state of the kingdom

A survey, written 2026-09-10, of what this project is and where it stands after
the long run that built the living world on top of the map. It is a map of the
whole for the next session and for anyone -- including a later me -- who has to
hold the shape of it in one head.

## The one rule, restated because everything below obeys it

No capability is typed in. Every number a plant, a beast, a household or a
kingdom can do is derived from something physical and anchored to something
real, and where a number is genuinely ours rather than the world's it is
labelled a free parameter next to itself. The test of the whole is that
figures nobody fitted come out where the record says they should: an oak
weighs 700 kg/m3, a cow gestates 283 days, a hazel coppice cycle is seven
years, a virgate is fifteen hectares, seven spinners keep one weaver, a third
of children die by fifteen. None of those was set; all of them are measured
back out of the models, and the suites hold them there.

**1,827 measurements across 38 suite files, 0 failing.** `node
verify/run_all.ts` runs them and diffs a baseline; `check_app` and
`check_client` drive the real server loop and the real browser client against
a stub canvas, because twice a thing has shipped that every unit suite passed
while the actual program crashed.

## The stack, planet to person

Everything is a pure function of `(worldSeed, address)` plus the player deltas
that persist. A tile is generated, never stored, which is what lets the world
hold 2,995,354,296,480 ground tiles on the head of a seed.

**The planet** (`gen/`, `geo/`). A Class-I icosahedral geodesic grid, frequency
7: 492 cells less 12 storm cells, 10 visible pentagons. Tectonics, hydrology
and a fitted climate model give every cell an elevation, a temperature, a
rainfall and a productivity. Deterministic transcendentals (`mathx`) because a
last-bit difference between two machines would move a coastline in a persistent
world. The sub-map ladder descends eight layers, region to pace, each a hexagon
of hexagons, by the rosette turn that makes parent and child one lattice.

**The ground** (`rock`, `soil`, `season`, `biome`, `resources`). Rock type,
erosion and soil depth; the orbital season that turns axial tilt into day
length, insolation and a week-by-week temperature; the biome and its net
primary production; the game on it and the timber in it.

**What grows** (`material`, `plant`, `species`, `form`, `flora`, `stand`).
Materials are a recipe of nine constituents from which density, fuel, food,
strength and rot all follow. A plant is a pure function of species, age, site
and week -- seven species now (oak, hazel, bramble, wheat, carrot, grass,
flax), each a sheet of measured chemistry and phenology. `form` solves a
plant's SHAPE from its mass by the pipe model and Leonardo's rule; `flora` and
`stand` say how many stand on a hectare and exactly which, so the wood you
count is the wood the model has.

**What happens to it** (`process`, `craft`). One rule per verb, each reading
composition rather than a special case: burn, rot, dry, thresh, eat. Then the
crafts -- tanning, hewing, and the textile trades from fleece and flax to
cloth -- as further verbs on the same piles.

**The beasts** (`animal`, `cattle`, `sheep`, `beastform`, `husbandry`, `herd`,
`village_herd`). An animal is solved from one number, its body mass, through
allometry: Kleiber's law for what it eats, the quarter-power clock for how long
it lives and gestates, the fill limit for what poor forage does to it. Cattle
and sheep are two sheets on that machinery. A village herd eats its own
pasture week by week, makes hay, is culled at Michaelmas, gives milk and meat
and hides and wool, and starves in a hard winter -- distress-slaughtered to the
last beast before its people fail.

**The people** (`household`, `hearths`, `settlement`, `economy`, `expansion`,
`labour`, `supply`, `trade`, `fields`, `stead`). A household's physics -- its
ration, its hearth-fire against the winter its latitude gives, its larder, its
tithe and rent. A settlement's demography as hearths of children, hands and
elders on a measured life table, with the generational famine echo, the
dependency ratio driving the labour the economy spends, and marriage gated by
the land through the holding -- the preventive check that levels a village off
at fewer christenings rather than more burials. The economy that ties it all
together each week: produce, trade, eat, decide; the assart that makes a
founding's first year hungry; the wild larder it crosses that year on.

## What is on the screen

The client draws the globe and the eight-layer ladder down to individual
tiles, tinted and blended by biome and relief. On the deep layers it draws the
living world: trees branch by branch on a crown lattice anchored to the region,
grass as a baked ground texture, cattle clumped on their commons, longhouses on
a green with folk at shoulder-scale, and ridge-and-furrow strips that grow as a
village breaks its ground and turn gold as the wheat senesces. The settlement
panel reads the granary, the herd, the flock, the hay, the wool and cloth, the
age pyramid, the next harvest and the wild's condition.

## Where the code has outrun the gap notes

`known-gaps.md` still lists some things that have since been built. For the
record, these are DONE and their entries are stale: population is no longer "a
single number with no occupations" (it is an age pyramid driving labour);
crafts exist (tannery, saw pit, textile); timber is consumed by household
firewood, not only ironworking; the harvest arrives in a window, not averaged
across the year; the wild larder is eaten. The gap notes should be pruned to
match on the next pass.

## What is genuinely still open, worst first

**The middle of the world is too smooth.** The detail-amplitude calculation is
open-loop -- it computes what relief a layer ought to add and never measures
what the base already carries -- so error accumulates down the ladder and
self-affinity is lost. Three fixes are struck through in `fix-attempts.md`. The
real fix is a base-relief measurement that is a continuous field, sampled the
way `reliefM` is, so it does not disagree along a map's shared edges. This is
the largest single open problem and it is a world-generation one.

**Cross-region tile alignment.** A region's neighbours are children of the
globe, which is not a lattice, so their tiles arrive turned by up to 23 degrees.
Mitigated by drawing no neighbours at the region layer; the true fix is a full
ISEA regrid of `sphere`, `submap` and `patch` together, the largest single
change the project could have.

**No seasons in the climate, only an annual mean.** Everything downstream that
wants a real winter infers it from the season model's derived swing. A game of
two-minute weeks will eventually want true interannual weather -- and with it,
the bad year that nothing currently ever has, so granaries fill to the ceiling
and sit there.

**Trade moves only grain, iron, cloth and wool.** Timber, stone, salt and clay
are generated and not traded. No roads, no terrain cost, no river topology, no
backhaul, no prices -- transport is denominated in the cargo itself, which
holds only until a third good competes for the same hands.

**Migration comes from and goes to nowhere.** People arrive at a surplus and
leave a dead end, both at 8% a year, to and from an unmodelled elsewhere. It is
symmetric so the world does not drift, but it does not conserve people exactly,
and it should -- migration between real settlements.

**No conflict, no Houses beyond a border colour, no NPC kingdoms before you
arrive, no frontiersman-and-attendants.** These are whole systems the design
opens with and the world has not yet grown into. The pieces for conflict are
present -- spare hands, iron, grain to keep men in the field.

## The road to a playable kingdom

The physical and economic simulation is deep and, within its scope, honest: a
village founds, breaks its ground, farms and herds and hunts and spins through
a real year, grows and marries and ages and can starve, trades its surplus, and
throws daughters when it fills. What stands between that and a game is mostly
the human and political layer, not more physics:

1. **Conflict and Houses** -- the next system with its pieces already on the
   shelf, and the thing that makes a map of kingdoms a game rather than a
   simulation running beside itself.
2. **Real migration and NPC kingdoms** -- so the world is populated before the
   player arrives and people move between real places.
3. **Seasons and the bad year** -- so the store and the famine have their true
   shape, and the insurance a village plants is sometimes spent.
4. **The smoothness fix and the ISEA regrid** -- the two deep
   world-generation debts, worth paying before the map is final.

Everything above (1) is built and verified. The doctrine held the whole way:
nothing in the list of what works was typed in, and the measurements are the
proof.
