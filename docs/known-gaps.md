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

**The model makes about three times as much tundra as Earth would.** Measured
against Earth's land below 65 degrees, which is where this world's land is:
0.085 of the land is tundra or ice here against a derived 0.025. The other
three covers are close -- forest 0.429 against 0.430, grass 0.286 against
0.331, desert 0.183 against 0.214 -- so this is one cover class rather than a
model that is generally cold.

The likely cause is the 57-to-65 degree band. On Earth that is overwhelmingly
taiga, which counts as forest; here more of it classifies as tundra. Refitting
the climate to close the gap would mean fitting to the least certain figure in
the comparison -- the taiga/tundra split at the margin is the softest number in
the whole derivation -- so it is recorded instead.

**No seasons.** Everything is an annual mean, with the seasonal swing inferred
where a classification boundary needs it. A game with two-minute weeks will
eventually want real seasons, and that is a layer-1 concern.

**The world's median land slope is 1.1 degrees against Earth's 2 to 3.** The
tail is right -- 22.4 degrees at the 99th percentile and 30.7 at the steepest,
against Earth's 25-to-35-degree mountainsides -- so this is gentle middling
ground rather than a flat world. Whether it is worth correcting is open; the
honest measurement is here rather than a claim in either direction.

This entry used to say the ladder delivered 57% of the relief its own Hurst
anchor predicts, and that was an error in the measurement rather than in the
terrain. See docs/fix-attempts.md.

**The storms are five-pointed stars rather than discs.** Removing a pentagon
and its ring of five leaves a five-fold symmetric hole, and at this resolution
a 12-degree cap is barely more than one cell across -- so it cannot be round.
The tiling around it is clean and there are no gaps; the shape is simply what
the grid gives.

Rounding it means removing a different set, and at frequency 7 there is no
middle ground: the next cells out sit at 15 to 18 degrees, so taking them makes
a cap of 17 degrees instead of 12. A rounder cap of the right size needs a finer
grid -- frequency 9 would put cells at 7 and 12 degrees and allow it -- at 812
cells against 480, with the economy shifting again for it.

**Cross-boundary adjacency is still not implemented, but area queries are.**
A cell on the rim of a sub-map has fewer than six neighbours and no way to name
the missing one, so rivers still stop at a map edge and nothing can walk across
one. What *does* cross now is `World.cellsWithin` — every cell within a radius
of a point, found by descending rather than walking, so catchments, trade and
settlement all reach past a boundary. Measured: 4,096 cells within 2 km across
60 different parent maps. Adjacency is the remaining half.

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

**`derive.ts` still describes a real-time battle, and 32 of its 37 exports are
dead.** Measured: only `SOLDIER_GRAIN_KG_PER_DAY`, `NAVIGABLE_M3_PER_S`,
`INFANTRY_MARCH_MS`, `STREAM_M3_PER_S` and `EROSION_K_REFERENCE` are imported
anywhere. The other thirty-two -- arrow flight, charge ranges, cavalry gaits,
formation pitch, tick rates, horse forage -- were derived for an RTS and are
reachable only from the file that defines them.

The tick-rate derivation in particular no longer applies: a two-minute turn does
not need 32 Hz. They survive because the anchors under them are sound and a
combat model will want them back, so deleting is a decision rather than a
tidy-up, and it has not been taken. What has been fixed is that the file no
longer claims checks that do not exist -- see verify_derive.ts.

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
