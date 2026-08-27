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

**Rivers exist but do not cross a sub-map boundary.** Flow accumulation runs
within one sub-map, so a river reaching the rim stops there instead of
continuing into the next. Same root cause as the adjacency gap below.

**Sinks are not filled.** A basin with no outlet keeps its water, which is
correct — that is a lake, and the Caspian is not a bug — but nothing yet marks
it as one or lets it overflow.

**No seasons.** Everything is an annual mean, with the seasonal swing inferred
where a classification boundary needs it. A game with two-minute weeks will
eventually want real seasons, and that is a layer-1 concern.

## Geometry

**Cross-boundary adjacency is not implemented.** A cell on the rim of a sub-map
has fewer than six neighbours, and its true neighbour lies in the adjacent
parent's sub-map. Within-map adjacency works; crossing a boundary does not.
This is genuinely hard on a sphere — the twelve pentagons mean sub-map
orientation cannot be globally consistent — and it is the largest unsolved
geometric problem in the project. It has to be solved before supply lines can
cross a region border.

**`cellAt` is a greedy walk with no spatial index.** About 50 steps, which is
fine for a click and would not be fine for a bulk query.

## Simulation

**A catchment spreads to seven sub-maps and no further.** The home ground map
plus its six neighbours: 35 km², enough for roughly three thousand people.
Going further is a cost problem rather than a code one — each map is 75 ms to
generate and 400 kB to hold, and a radius covering the full 25 km commute limit
would want three hundred. A settlement that outgrows seven maps is the signal
to build the incremental version. See [supply.md](supply.md).

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

**Migration comes from nowhere.** People arrive at a settlement with a surplus
at 8% of its unfilled capacity per year, from an unmodelled elsewhere. That
rate is a free parameter and should be replaced by migration between real
settlements the moment there are several.

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

**No frontiersman and no attendants.** The player is an owner id on a tile.
The character with four assignable attendants that the design opens with is not
built.

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
