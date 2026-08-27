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
