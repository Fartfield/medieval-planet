# Determinism

## What the requirement actually is

It is not "keep two clients in step." The server is authoritative, so it could
simply tell everyone what happened.

It is this: **a persistent world can never be regenerated differently.**

The world is stored as a seed plus a set of deltas. Everything a player has not
touched is recomputed from that seed each time it is looked at — next week,
after a server restart, after a Node upgrade, after a move to different
hardware, after the renderer is rewritten. If the recomputation ever differs,
the world quietly changes underneath people who built things on it. A player's
city ends up in a lake. There is no error message and no way back.

That is a strictly stronger requirement than a normal game's world generation
faces, and it rules out several things people reach for by habit.

## The rules

**`Math.random` is banned under `sim/`.** It is seeded per process and is not
reproducible even twice in the same process. Use `sim/rng.ts`, which is
xorshift128 over exact 32-bit integer operations.

**There is no global RNG, on purpose.** A global stream gets drawn from a
different number of times on a client that also renders a hit spark, and then
the two disagree. Every stream is explicitly seeded from the thing it belongs
to — see `addressSeed` — and explicitly threaded. This is why a tile produces
the same rock whether it is the first thing anyone looks at or the ten
millionth: generation does not depend on browsing history.

**The transcendentals are banned.** `Math.sin`, `Math.cos`, `Math.exp`,
`Math.pow`, `Math.log` and `Math.atan` are specified by ECMAScript as
"implementation-approximated". Conforming engines may differ in the last bit,
and V8, SpiderMonkey and JavaScriptCore have all shipped different results for
the same input. One bit at the wrong moment moves a coastline.

The replacements:

| instead of | use | how it works |
|---|---|---|
| `Math.sin`, `Math.cos` | `sim/angle.ts` | baked quarter-wave table, integer angles |
| `Math.atan2` | `sim/angle.ts` | baked arctan table, octant reduction |
| `Math.exp` | `mathx.dexp` | range reduction plus a fixed 16-term Taylor series |
| `Math.log` | `mathx.dlog` | exact exponent split plus an atanh series |
| `Math.pow` | `mathx.dpow` | binary exponentiation for integers, `dexp∘dlog` otherwise |
| `Math.E`, `Math.SQRT1_2` | literals | the constants themselves are only approximated |

The tables are baked by `tools/gen_tables.py` and checked in as integer
literals. They are *data*, computed once by CPython, not code that runs at load
time — so no floating-point transcendental is ever evaluated at run time on any
machine.

**`+`, `-`, `*`, `/` and `Math.sqrt` are fine.** IEEE 754 pins those to a
correctly-rounded result that every conforming engine must reproduce exactly.
This is why `derive.ts` may do its arithmetic in floating point at load time,
and why the planet generator may use floats throughout: it touches nothing but
those five operations.

**Iteration order must be a property of the data.** Never of arrival order,
never of a `Map`'s insertion order where insertion depended on the network.
Float addition is not associative, so summing the same values in two orders
gives two answers. This is the subtlest of the rules and the one that bites
latest.

## The fixed-point layer

`sim/fixed.ts` provides exact integer arithmetic at 1/4096 of a metre. It is
used for the economy and for anything positional, where floats would accumulate
drift over the thousands of turns a persistent world runs for.

The scale is solved, not chosen, against two constraints:

* **the ceiling.** A JS number holds integers exactly to 2^53. If both operands
  of a multiply stay under 2^26 raw, the product is at most 2^52 — still exact —
  and the divide by `SCALE` that follows needs at most 52 significant bits.
  2^26 raw at this scale is 16,384 m, so the arithmetic is provably exact
  anywhere inside a 16 km square.
* **the floor.** Rounding a per-tick step does not cancel; it accumulates
  linearly. At 1/4096 a walking step rounds to 179 units against a true 179.2,
  an error of 0.1%. At 1/1024 it would be 0.4%.

Movement then avoids the accumulation entirely by storing speeds **per second**
and integrating with a remainder — 32 ticks of a 3,724-per-second speed advance
exactly 3,724 units, with the leftover carried rather than discarded. One extra
integer per axis, and the drift is gone rather than merely small.

## What proves it

`verify_math.ts` checks agreement with the library functions to 1e-13, and
`verify_climate.ts` checks that the same seed rebuilds a bit-identical planet.

Neither of those proves cross-engine agreement, because they run on one engine.
The real evidence is the **baseline**: `verify/_baseline.json` records the exact
value of all 109 measurements. A run on any other machine that diffs clean is
the proof. Run it on a different CPU, a different OS, and a different Node
version before trusting a world to survive a migration.
