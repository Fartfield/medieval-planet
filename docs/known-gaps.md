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

**There are no rivers.** Drainage is the obvious next thing at layer 1, and it
matters enormously — floodplains are where cities go. Nothing below layer 0
generates at all yet.

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

**There is no economy yet.** No population, no food, no buildings, no supply.
`anchors.ts` and `derive.ts` already carry the numbers those will need — grain
per soldier-day, march rates, forage — from the battle-scale work that preceded
the redesign, and they are the right numbers, but nothing consumes them.

**`derive.ts` still describes a real-time battle.** Tick rates, charge speeds,
turn rates and formation spacing were derived for an RTS and survive because
the underlying anchors are sound and supply lines will want the march rates.
The tick-rate derivation in particular no longer applies — a two-minute turn
does not need 32 Hz — and should be revisited rather than deleted.

**No cross-region pathing, no supply lines, no houses, no alliances.** All of
it downstream of the economy.

## Infrastructure

**No spatial index on the delta store.** "Which changed tiles are inside this
region" is a prefix scan over string keys today. Fine at small numbers, not
fine at a million.

**Type checking is not wired into `run_all`.** `npm run typecheck` exists and
needs `npm install` first; the suites run without it. They should not.
