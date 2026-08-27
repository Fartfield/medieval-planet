# Working in this repo

## The one rule

**No capability is typed in.** Every number the world runs on is derived from
something physical and anchored to something measured — an average adult at one
end and a world record at the other; a hauberk on a museum scale; the observed
zonal mean temperature at forty-five degrees; the aridity index the UN uses to
draw the edge of a desert.

`sim/anchors.ts` holds the measurements. `sim/derive.ts` and the generators
solve everything else from them. If you find yourself picking a constant
because it feels right, stop and find what it should be solved from instead.

Where a number genuinely is ours rather than the world's, say so next to it and
write **FREE PARAMETER** in the comment. There are a handful — `COLUMN_DRAG`,
`WARHORSE_STAT`, `FORMATION_PITCH_FACTOR`, `TURN_RATE_TURNS_PER_SEC`, and the
edible fractions in `biome.ts`. If that count grows without an argument
attached, something has gone wrong.

## The second rule

**Nothing is stored that can be generated.** There are a trillion ground tiles.
A tile is a pure function of `(worldSeed, address)`; the database holds only
deltas — what players changed. Any design that wants to write a row per tile is
wrong, however convenient, and will not survive contact with the scale.

## Before changing anything in `sim/`

Read `docs/architecture.md`, then the document for the system you are touching.
The `docs/` files carry the *why* that spans files; the code carries the *why*
of each line. Neither repeats the other.

`docs/determinism.md` is not optional reading before you touch generation. The
rules there are load-bearing and several of them look like pointless
fussiness until you know what they prevent:

* no `Math.random`, ever, anywhere under `sim/`
* no `Math.sin`, `Math.cos`, `Math.exp`, `Math.pow`, `Math.log` — the spec does
  not pin them, so two engines may differ in the last bit. Use `sim/gen/mathx.ts`
  or a baked table from `tools/gen_tables.py`
* `Math.sqrt`, `+`, `-`, `*`, `/` are fine — IEEE 754 pins those exactly
* iteration order must be a property of the data, never of arrival order

## Before attempting a fix, read what has already been tried

`docs/fix-attempts.md` is a ledger, one section per problem, of every attempt
and **the measurement that killed it**. Read the section before touching the
problem. Struck-through entries have been tried; the number beside them is why
they failed, and re-running one hoping for a different answer is the specific
waste this file exists to prevent.

Add to it as you go, not afterwards. An attempt that failed is worth as much as
the one that worked, and it is only worth anything if the measurement is
recorded next to it.

## Verification is measurement

Read `docs/testing.md` before running or writing a suite. Two habits matter:

* **Run `node verify/run_all.ts`.** Every suite and a diff of every baseline
  measurement, in one command. Anything touching geometry, generation or the
  turn loop is risky enough to want it before *and* after. If a measurement
  moved and you meant it, re-anchor with `--anchor` and say so in the commit.
* **A failing check is a question.** About half the failures in a project like
  this are stale assertions encoding old behaviour. Establish which kind you
  have before changing either the code or the test — and when it is the test,
  say so plainly rather than quietly loosening a threshold.

Run the primary user-visible path too, not just the suites. A green suite has
never once proved that the actual thing works.

## Version control

**Every increment is committed.** Not "at the end of a session" and not "when a
feature is finished" — at every point the project works, which is usually
several times an hour. The unit is one coherent change with its verification
passing.

The loop, in order, every time:

1. `node verify/run_all.ts`
2. run the real thing — the server and a client, not just the suites
3. commit, with a message that says what moved and *why it was wrong before*

Do not batch several changes into one commit because they happened in one
sitting. If something is half-finished, commit the part that works and say in
the message what is not done yet — a commit is a save point, not a certificate.

Messages: first line says the finding, not the file. `Cold deserts were being
classified as grassland` over `update biome.ts`. The body carries the
measurement, because the number that justified a change is the thing nobody can
reconstruct later.

## Comments

Comments explain *why*, and they are allowed to be long where the reasoning was
hard-won — the twelve pentagons, the midpoint cache in `sphere.ts`, the
aridity index replacing rainfall thresholds. Do not add comments that restate
the code. Match the surrounding density and voice.

## Things deliberately not done

Listed in `docs/known-gaps.md`. Do not fix them incidentally.
