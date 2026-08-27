# Testing

## The one command

```
node verify/run_all.ts
```

Every suite, and a diff of every measurement, in one run. Anything touching
geometry, generation or the turn loop is risky enough to want this before *and*
after.

```
node verify/run_all.ts --anchor    accept the current numbers as the baseline
node verify/calibrate_climate.ts   sweep the climate model against Earth
```

## A check is a measurement, not a verdict

Every `check` records its actual value into `verify/_baseline.json`, and
`run_all` diffs the whole set run to run. That turns "did anything change?"
from a question you have to think about into one line of output — and it
catches the changes nobody wrote a test for, which are most of them.

A refactor that quietly moves the mean land elevation by 40 m passes every
assertion and shows up immediately in the diff. That is the point.

`measure(name, value)` records without asserting. Use it for anything you want
watched but cannot state a correct value for.

## A failing check is a question

About half the failures in a project like this are stale assertions describing
behaviour that was deliberately changed. Work out which kind you have before
editing either side.

* **The code is wrong.** Fix it. The test did its job.
* **The test is wrong.** Fix it, and say so plainly in the commit message —
  "this assertion encoded the old rainfall thresholds" — rather than quietly
  widening a tolerance until it goes green. A loosened threshold with no
  explanation is a test that will not catch the next one either.

## Re-anchoring

`--anchor` is **not** a way to make a red run green. It is what you do after
deciding a measurement moved for a reason. The commit message is expected to
say which measurement moved and why.

A silent re-anchor throws away the only record of what the world used to look
like, and the baseline is the most valuable file in `verify/`.

## What the baseline actually proves

`verify/_baseline.json` records the exact value of every measurement to six
significant figures. Six is deliberate: enough to catch a real change, loose
enough that the last-bit noise of a float sum does not report a moved
measurement on every run.

Its most important job is one this machine cannot do alone. The suites here run
on one engine, so they cannot prove the cross-engine reproducibility that
`docs/determinism.md` demands. **A clean baseline diff on a different CPU, a
different OS and a different Node version is the real evidence** — run it there
before trusting a world to survive a migration.

## Run the real thing

A green suite has never once proved that the actual game works. Start the
server and connect a client before believing a change landed.

Two crashes shipped in this project's predecessor that every suite passed, both
because nothing drove the real app.

## Writing a suite

Name the file `verify_something.ts` in `verify/` and it is picked up
automatically. Use `suite()` to group, `check()` to assert with a tolerance,
`assert()` for booleans, and `measure()` for numbers you only want watched.

A tolerance of exactly `0` means identical, which is what the determinism
checks want — there, near enough is precisely not good enough.
