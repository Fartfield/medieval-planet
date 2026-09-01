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

**The world is still smoother than Earth in the middle of the distribution.**
Doubling the physics mesh to 34 km cells fixed the aliasing that caused most of
it -- the finest relief octave used to sit at exactly one cell and contributed
almost nothing -- and bought a third more slope everywhere. Measured over 5,460
samples following the highest ground:

                median   99th    max
    68 km mesh  0.64     12.76   19.89 degrees
    34 km mesh  0.86     19.87   30.18

The steep ground is now right: 30 degrees at the steepest against Earth's 25-to-
35-degree mountainsides. The middle is still gentle -- about 0.9 degrees at a
129 m cell against Earth's roughly 2 at 90 m.

Doubling again would cost another factor of four in build time, currently 10.5
seconds a world, for a diminishing return. The other lever is anchoring the
ladder's detail amplitude to a MEASURED local relief instead of to the mesh's
own spread, so the fine scales stop inheriting the mesh's resolution at all.
That is a redesign rather than a constant, and it has not been done.

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
