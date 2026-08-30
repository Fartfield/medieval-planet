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

**Tundra and ice sit 2.6 points low** against Earth. Within the suite's
tolerance. Likeliest cause is that the seasonal amplitude model — a single
sin²(latitude) term — is too crude near the poles.

**The moisture-capacity term is linear in temperature.** It stands in for the
Clausius-Clapeyron relation, which is exponential. Replacing it is cheap; it has
not been done because the calibration currently absorbs the difference.

**Rivers are crude and do not cross a sub-map boundary.** Flow accumulation
runs within one map, and a map is 91 cells now — a third of which are rim. A
channel over 91 cells is a rough thing and a river reaching the edge stops
there. Both follow from the adjacency gap above.

**Sinks are not filled.** A basin with no outlet keeps its water, which is
correct — that is a lake, and the Caspian is not a bug — but nothing yet marks
it as one or lets it overflow.

**No seasons.** Everything is an annual mean, with the seasonal swing inferred
where a classification boundary needs it. A game with two-minute weeks will
eventually want real seasons, and that is a layer-1 concern.

**The ladder delivers 57% of the relief its own anchor predicts.** Measured, at
every layer: the Hurst law says a map spanning `S` should carry
`reliefM x (S / 69.5 km)^0.70` of relief, and the ratio of what is produced to
what is predicted came out 0.61, 0.56, 0.55, 0.63, 0.46, 0.58 across spans from
1,900 km down to 24 m.

The constancy is the useful part. Self-affinity is *correct* -- the implied
Hurst exponent is 0.728 against the 0.70 anchor -- so this is a single
amplitude constant being low by about 1.8x, not a scaling error. It is that the
fbm's realised peak-to-peak across a map is smaller than the [-1, 1] its range
suggests, and the amplitude is applied as though it were not.

The visible cost is a world at the smooth end of every band it is checked
against: median land slope about 1.1 degrees where Earth is 2-3. Every anchored
landscape check passes, so this is a calibration rather than a defect, and the
honest fix is to measure the noise's realised range once and divide by it
rather than to pick a multiplier.

## Geometry

**Cells are stretched toward the poles, by up to 2.7 to 1.** The world map is a
wrapped hex band in the Lambert cylindrical equal-area projection, so every cell
has the same *area* but not the same shape: a cell at 52 degrees is nearly three
times as wide as it is tall.

This replaced a worse problem. A closed sphere tiled with hexagons needs exactly
twelve pentagons -- Euler forces it, and no cleverness avoids it -- and at 92
regions those were 13% of the world map. A cylinder has Euler characteristic
zero, so a band that wraps needs none at all, and the map is now hexagons only.
The cost moved from topology to shape, which is the better place for it: a
stretched hexagon still tiles, still has six neighbours, and still subdivides.

The band reaches to 65.05 degrees, just short of the 66.56-degree polar circle.
The caps beyond it are ungridded ice.

**A 2,900 km cell cannot resolve a mountain range.** Uplift smearing is scaled
to a real distance and at this resolution correctly does nothing, so relief at
the world layer is blocky. Everything finer is generated below it.


**Cross-boundary adjacency is still not implemented, but area queries are.**
A cell on the rim of a sub-map has fewer than six neighbours and no way to name
the missing one, so rivers still stop at a map edge and nothing can walk across
one. What *does* cross now is `World.cellsWithin` — every cell within a radius
of a point, found by descending rather than walking, so catchments, trade and
settlement all reach past a boundary. Measured: 4,096 cells within 2 km across
60 different parent maps. Adjacency is the remaining half.

**`cellAt` is a greedy walk with no spatial index.** About 50 steps, which is
fine for a click and would not be fine for a bulk query.

## Simulation

**A catchment spreads to 128 sub-maps and no further.** That is about 1,035
hectares, which supports roughly 1,200 people — a large village or a small
town. Beyond that a settlement is land-limited and throws off daughters, which
is the designed behaviour, but it does mean no single settlement can become a
city. Raising the cap is a cost decision, not a code one.

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

**Expansion is unfair by construction.** Settlements are considered in key
order, so two wanting the same valley in the same week are resolved by whoever
sorts first. A real race would have both parties set out and one arrive second.

**Nothing ever has a bad year.** The insurance a village plants against one is
therefore never spent, so granaries fill to the spoilage ceiling and sit there.
Same root as the missing seasons.

**Houses are a number that colours a border.** No heads of household, no
alliances, no representation on the map beyond the colour.

**Players are identified by name.** Rejoining by name is enough to play with
and not enough for anything else.

**`derive.ts` still describes a real-time battle.** Tick rates, charge speeds,
turn rates and formation spacing were derived for an RTS and survive because
the underlying anchors are sound and supply lines will want the march rates.
The tick-rate derivation in particular no longer applies — a two-minute turn
does not need 32 Hz — and should be revisited rather than deleted.

## Infrastructure

**The mosaic is one layer only, by design, but that is also its limit.** A
region shows its 91 children and nothing finer, so zooming the globe never
reveals more detail — you have to descend. Two layers of mosaic would look
better and cost 91 times as much.

**Mosaic tiles are drawn as squares.** At a few pixels across nobody can tell a
square from a hexagon, and it saves six sides of work on every one of eight
thousand shapes. It would show if the threshold were ever lowered.


**No spatial index on the delta store.** "Which changed tiles are inside this
region" is a prefix scan over string keys today. Fine at small numbers, not
fine at a million.

**Type checking is not wired into `run_all`.** `npm run typecheck` needs an npm
install the project otherwise does not, so nothing runs `tsc`. This is not
free: `erasableSyntaxOnly` in `tsconfig.json` would have caught three separate
parameter-property crashes at type-check time rather than at load.
`verify_purity.ts` now catches that class by reading the source, which is a
worse tool that happens to be available.

**The WebSocket implementation is hand-rolled.** No compression, no
fragmentation on send, no backpressure. Fine for a few players on a LAN;
replace it with `ws` before it faces anything else.

**No spatial index for "which settlements are near this one".** Supply lines
will want one immediately.
