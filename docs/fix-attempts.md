# Fix attempts

One section per problem. Every attempt, and **the measurement that killed it**.

Read the section before touching the problem. Struck-through entries have been
tried; the number beside them is why they failed. Re-running one hoping for a
different answer is the specific waste this file exists to prevent.

Note explicitly when an attempt failed for a reason that has since changed,
because those are the ones worth revisiting.

---

## Biome distribution did not match Earth

**Problem.** The first generator produced 0.2% desert against Earth's 19% of
land, and 44.6% forest against 31%. A planet with no deserts on it.

* ~~Fit the zonal precipitation profile to observed zonal means.~~ **0.2%
  desert.** The published zonal mean at 30° is around 600 mm, and fitting to it
  gave a planet with essentially no arid land. The mistake was subtle: that
  600 mm is almost entirely *ocean*. The land sitting at 30° is the Sahara,
  Arabia, the Atacama, the Kalahari and the Australian interior. The model only
  ever evaluates precipitation over land, so the land profile is the honest
  target and the all-surface figure is the wrong one.

* ~~Refit the profile against land: raise the ITCZ peak, narrow both bands,
  drop the background from 200 mm to 70, strengthen continentality.~~ **4.1%
  desert, 44.6% forest.** Better but still nowhere near. Sweeping four
  parameters over sixteen combinations could not get desert above 8% without
  destroying the forest fraction — which is the signature of a problem that is
  not in the parameters at all.

* **Classify on the aridity index rather than on rainfall.** **Worked: total
  absolute error 0.266 → 0.068.** Absolute rainfall thresholds have no cold
  desert in them. Everything temperate and dry was becoming grassland, so the
  Gobi, the Great Basin, the Taklamakan and Patagonia — about a third of
  Earth's desert area — were all classified wrong. The UNEP aridity index is
  precipitation over potential evapotranspiration, so it asks how much water a
  place has relative to how fast it loses it. 200 mm is a desert at 25 °C and a
  wetland at 0 °C, and no single rainfall number can say that.

  Final: forest 32.0% (Earth 31), grass 27.9% (25), desert 19.3% (19),
  tundra and ice 17.4% (20).

**Still open.** Tundra and ice sit 2.6 points low. Not chased yet; it is within
the tolerance the suite asserts and the likeliest cause is that the seasonal
amplitude model is too crude near the poles.

---

## A rainforest was more fertile than a prairie

**Problem.** The first soil model derived fertility from productivity, less
what leaching carried away. It produced tropical rainforest 0.280 against
temperate grassland 0.275 -- backwards, and enough to make "settle in the
jungle" the correct opening move forever.

* ~~Fertility from net primary productivity, penalised by leaching.~~
  **Rainforest 0.280, grassland 0.275.** Leaching is real and necessary, but on
  its own it cannot overcome the raw productivity gap: a rainforest fixes three
  times what a prairie does, and a leaching penalty of 0.31 against 1.00 leaves
  it still ahead. Raising the leaching exponent to compensate drove taiga to
  0.002, which is not poor soil, it is no soil.

* **Add the two mechanisms that were missing.** **Worked.** Grassland 0.972,
  savanna 0.541, temperate forest 0.403, taiga 0.146, rainforest 0.128, tundra
  0.078, desert 0.031 -- Earth's ordering exactly, with the rainforest holding
  the *highest* productivity in the set at 2,466 g/m2/yr.

  * *Where the production goes.* Grasses put three quarters of what they make
    into roots that die back annually and become humus in place. A tree puts it
    into a trunk that stands two centuries. Root-to-shoot allocation is
    measured, and it is the dominant term.
  * *How fast it rots.* Q10 of 2 -- decomposition doubles per 10 degC. This is
    why boreal soils hold a third of the soil carbon on the planet.

**Also fixed here.** `leachingFraction` returned 1.0 on permanently frozen
ground, because potential evapotranspiration is zero there and the formula read
zero PET as infinite surplus -- declaring the Arctic the most heavily leached
soil on Earth. Frozen ground has no liquid water moving through it and leaches
nothing. Guarded.

**Also fixed here.** A short growing season cannot mineralise what the soil
holds, however much it holds -- tundra peat is nutrient-rich and useless.
Fertility now scales with biotemperature.

---

## Tin was commoner than copper

**Problem.** Tin is deliberately clustered into provinces, because on Earth it
comes out of granite intrusions and those come in provinces -- which is what
made the tin trade worth crossing Europe for. The multiplier was written as
`1 + 6 * province`.

* ~~Multiply tin's frequency by `1 + 6 * province`.~~ **Tin 0.32% against
  copper 0.30% worldwide**, where crustal abundance says copper should be about
  three times commoner. A term that is always at least 1 does not cluster a
  metal, it creates more of it.

* **Centre the multiplier on 1 rather than adding to it**: `0.10 + 2.70 *
  province`. Same 28-fold contrast between a province and the ground around it,
  global frequency back where abundance put it. Same correction applied to the
  placer-gold term, which had the same shape.

**Note for later.** The first version of the test that caught this sampled a
single ground map and was *wrong to fail* -- a map inside a tin province should
show more tin than copper. Metal rarity is a global claim and has to be sampled
globally. The test now walks 24 regions.

---

## A sub-map spacing test failed against correct code

* ~~Assert realm cell spacing is 2,780 m.~~ **Got 2,408 m.** The code was
  right. A hexagon has two widths: vertex-to-vertex is 2r, and flat-to-flat --
  which is also the centre-to-centre distance between neighbours -- is
  sqrt(3)*r, about 13% less. The docs quote "2.8 km across", meaning vertex to
  vertex; `spacingM` is the centre-to-centre figure the slope calculation
  needs. Both are now measured, and the test says which is which.

---

## Median farmland yielded 41 kg/ha where medieval reality is 330-450

**Problem.** With supply built, settlements starved everywhere. Median grain
yield across a temperate grassland region came out at 41 kg per hectare, eight
to ten times below what medieval evidence records, and one worker on median
land fed 0.4 people while having to feed 2.

Two separate double-counts, both of which looked entirely reasonable in place.

* **`health` started at `fertility`.** The yield formula multiplies both, so
  fertility was squared: 0.35 became 0.12. Health is meant to be what farming
  has taken *out* of a soil, and virgin ground has taken nothing — it starts at
  1. Two plausible numbers multiplied into one wrong one, which is the failure
  mode hardest to see by reading.

* **Net primary productivity appeared twice.** Fertility already carries NPP
  through the organic matter it builds, and the yield formula multiplied by
  `npp/900` again under the name `climateCap`.

  Worse, it was the wrong quantity even once. NPP says what a *landscape*
  grows; it says nothing about whether a *crop* will ripen, and the two come
  apart exactly where it matters — a rainforest hillside has enormous NPP and
  will not make a wheat field. Replaced with `cropSuitability`, from wheat's
  own measured requirements: 500 mm of water and 120 days above 5 degC.

**After both:** median 114, best tiles 447-639 on the good regions, and the
best land at 0.89-1.03 hectares per person against a measured historical
0.5-1.5. Seven of 24 sampled regions have properly arable ground, which is
about the right share for a planet.

**Also fixed here.** The season term was linear, so sub-Arctic tundra with a
three-month summer scored 0.76 on a crop needing 120 days. A season shorter
than the crop needs yields *nothing* — the crop does not ripen — so it is a
threshold, not a proportion.

---

## A settlement with an ample surplus sat at exactly five people for a decade

**Problem.** Good land, ration 2.81, health 1.00, and the population did not
move for 520 turns.

* ~~Assume the growth model was too weak and raise the birth multiplier.~~
  Would have been wrong twice over. The multiplier was already too *high* —
  4x baseline implies 10.8% annual natural increase, where colonial America,
  the fastest a pre-industrial population ever grew from births alone, managed
  3%.

* **Population was an integer and the fraction was rounded away every turn.**
  Five people with a full surplus gain 0.003 people a week. Rounded each turn,
  that is zero forever. *The fractional part is the entire growth at this
  scale* and has to survive the turn boundary — the same reasoning as the
  movement remainder in `derive.ts`, and it should have been applied here from
  the start.

* **And the birth multiplier was then solved rather than chosen**: to reach a
  30-per-thousand net increase against a 32-per-thousand death rate, births
  must run at 62 per thousand, so 1.77x baseline.

Migration was added at the same time, because it is what actually grew medieval
towns — urban death rates exceeded urban birth rates almost everywhere.

---

## A catchment depended on the order it was asked for

**Problem.** Found by a test that was looking for something else.

The catchment cache bucketed the search radius to build a key, then built the
catchment with the *unbucketed* radius. Two populations landing in the same
bucket therefore shared whichever catchment the first one happened to build —
so the same world gave different answers depending on the order it was queried.

* **Quantise the radius itself and use the quantised value.** The catchment is
  then a pure function of the bucket.

This is precisely the class of bug `docs/determinism.md` exists to prevent, and
it is invisible until two machines disagree. Related: `verify_purity.ts` caught
`Math.log` in the same cache-key line. That also sounds harmless and is not — a
bucket computed differently on two machines gives a different radius, a
different catchment, a different harvest and a different population.

---

## Two tests failed against entirely correct behaviour

Recorded because both cost a run and both were the test, not the code.

* ~~`growth decelerates: track[4]-track[3] < track[1]-track[0]`~~ An S-curve's
  *absolute* growth is still rising through its inflection, so years 40-50
  legitimately exceed years 10-20. Self-limitation is now tested through the
  ration instead — feeding more people off the same land must get harder —
  which is true at every point on the curve rather than only after the turn.

* ~~Overload a settlement with `potentialPopulation * 8`.~~ That capacity is
  measured at the *small* settlement's search radius. A larger settlement looks
  further, finds more land, and is fine — the adaptive radius working exactly
  as designed. The overload figure has to be an absolute one.

---

## Every WebSocket client silently refused the server

**Problem.** HTTP served fine, the upgrade returned a well-formed
`101 Switching Protocols` with a plausible base64 `Sec-WebSocket-Accept`, and
every client refused the connection without a word in any log.

* ~~Check the response headers, the ordering, the Connection header, Nagle.~~
  All correct. The response was byte-for-byte the shape the RFC describes.

* **The magic GUID had a character transposed.** It is
  `258EAFA5-E914-47DA-95CA-C5AB0DC85B11`, and it had been written
  `258EAFA5-E914-47DA-95CA-5AB0DC85B11F` -- the C moved off the front of the
  last group and onto the end as an F. Both are 36 characters and both look
  right.

**Why it was slow to find.** A wrong GUID does not produce a malformed
handshake. It produces a perfect handshake with the wrong answer in it, and the
only correct response a client has is to hang up quietly. There is nothing to
read.

Found by hashing the test vector in the RFC itself -- key
`dGhlIHNhbXBsZSBub25jZQ==` must give `s3pPLMBiTxaQ9kYGzzhZRbK+xOo=` -- and
then, when that failed too, by grepping the Node binary for GUID-shaped strings
and testing each one. `verify_protocol.ts` now asserts the vector so it cannot
drift again.

---

## Three files in a row crashed on TypeScript that cannot be erased

**Problem.** `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX: TypeScript parameter property
is not supported in strip-only mode`, at load, in `server/ws.ts`, then
`server/persist.ts`, then `verify/check_app.ts`.

`constructor(private readonly socket: Duplex)` reads like an annotation and is
actually an *assignment the compiler writes for you*. Node's type stripping
never compiles anything -- it replaces types with whitespace -- so there is
nothing to write it.

* ~~Fix each one as it crashed.~~ Three times, each a runtime failure in a file
  that had just been written, each costing a full run to discover.

* **Write a suite that reads the source.** `verify_purity.ts` now rejects
  parameter properties, enums, namespaces and module blocks across every
  directory, along with `Math.random` and the unpinned transcendentals under
  `sim/`, and imports naming a `.js` file that does not exist.

  It immediately found a fourth thing nobody was looking for: `corners()` in
  `sim/geo/hexgrid.ts` used `Math.cos` and `Math.sin`. It returns the corner
  offsets for *drawing* a hexagon and had no business in `sim/` at all. Moved
  to `client/src/render.ts` rather than granting the rule an exception -- the
  exception would have been harmless, and a rule that accumulates them stops
  being a rule.

**Note.** `tsconfig.json` sets `erasableSyntaxOnly`, which would have caught all
three at type-check time. Nothing runs `tsc`, because it needs an npm install
the project otherwise does not. Recorded in known-gaps.

---

## A test failed because it assumed which turn its orders would land on

* ~~Send a claim, wait for one turn, expect the claim to have landed.~~
  **0 changed.** The turn timer starts when the server does. A client
  connecting two seconds into a three-second turn sees a turn resolve before
  its own orders have arrived -- which is correct behaviour, and the test was
  wrong to fail. Poll for the effect, not for a turn number.

---

## Node could not resolve the module graph

**Problem.** `ERR_MODULE_NOT_FOUND` on every import.

* ~~Use the TypeScript convention of importing `./foo.js` for `./foo.ts`.~~
  **Every import failed.** That convention exists for `tsc`'s NodeNext *emit*,
  where the file really will be `.js` by the time anything runs. Node's native
  type stripping does not compile anything, so there is no `.js` and no
  rewriting step — imports have to name the file that actually exists.

* **Import `./foo.ts` directly, with `allowImportingTsExtensions` and
  `noEmit`.** Worked, and paid off twice: the dev server can then strip types
  on the way to the browser and serve the same files, so there is no build step
  anywhere in the project.

---

## Dynamic import of the suites failed on Windows

* ~~`await import(join(here, file))`.~~ **`ERR_UNSUPPORTED_ESM_URL_SCHEME`,
  protocol `c:`.** An absolute Windows path starts with a drive letter, and the
  ESM loader reads `c:` as a URL scheme. Use `pathToFileURL(...).href`.

---

## Heredocs kept truncating source files

Not a code problem, but it cost time twice and is worth recording. Writing
these files through shell heredocs failed on punctuation-dense TypeScript —
bash reported an unexpected EOF and wrote nothing. Use the file-writing tools
for source, and reserve heredocs for short config and markdown.
