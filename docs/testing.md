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

## The type checker runs as a suite

`verify_types.ts` shells out to `tsc --noEmit` and fails the run on any error,
so a type is a constraint again rather than a comment that looks like one. It
needs the dev dependencies present:

```
npm install
```

Without them the suite fails on "typescript is installed" rather than quietly
passing -- a suite that skips is indistinguishable from one that succeeds, and
that is exactly how this check came to be missing for so long.

## Run the real thing

```
node verify/check_app.ts
```

Starts the actual server as a child process, connects two actual WebSocket
clients, has them build the world from the seed the way the browser does, issue
orders and watch turns resolve — then kills the server, restarts it, and checks
the world came back.

Named `check_` rather than `verify_` so `run_all` does not pick it up: it needs
a free port and about thirty seconds, which is the wrong shape for something
you run before and after every edit. **Run it before every commit.**

A green suite has never once proved that the actual game works. Two crashes
shipped in this project's predecessor that every suite passed, both because
nothing drove the real app — and the WebSocket handshake bug recorded in
`fix-attempts.md` was invisible to all 204 in-process measurements.

There is no browser here, so `verify_render.ts` stands in for one: a stub 2D
context that records what it was asked to draw. It cannot tell you the map
looks right. It catches NaN coordinates, which is the failure mode that
matters — canvas silently skips a shape containing one, so a broken projection
does not throw and does not warn, it just quietly draws nothing.

## Writing a suite

Name the file `verify_something.ts` in `verify/` and it is picked up
automatically. Use `suite()` to group, `check()` to assert with a tolerance,
`assert()` for booleans, and `measure()` for numbers you only want watched.

A tolerance of exactly `0` means identical, which is what the determinism
checks want — there, near enough is precisely not good enough.

## Looking at the renderer

`node tools/preview.ts` runs the real renderer against a software rasteriser
and writes a PNG. `--sub 4` draws a sub-map instead of the globe, `--zoom`,
`--seed`, `--width`, `--height` and `--out` do what they say.

It exists because the renderer is the one part of this project where every
measurement can pass and the output still be visibly wrong. The suite checks
what the renderer was *asked* to draw -- how many shapes, whether any
coordinate is NaN, whether the arithmetic is exact -- and none of that notices
that the hexagons do not fit together. When tiles on the globe turned out not
to tessellate at all, the suite was entirely green and one image was enough.

No antialiasing, deliberately: a jagged edge in the output is a jagged edge in
the geometry rather than a smoothing artefact hiding one.
