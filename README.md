# medieval-strategy

*Working folder name. Rename it the moment the game has a real one.*

A persistent hex planet, played a week at a time.

**In one line:** an Earth-sized world of a trillion tiles, generated rather
than stored, where you begin as a frontiersman with four attendants and build
whatever your supply lines can feed — with no population cap and no army cap,
shared with every other player, resolving two-minute turns of one game-week
each.

## What is here now

The world exists and can be looked at. The economy does not exist yet.

| | |
|---|---|
| the globe | 10,242 regions on a true icosahedral sphere, with the twelve pentagons a sphere cannot avoid |
| generation | plate tectonics → elevation → climate → biome, cascading top-down, reproducible forever from one seed |
| calibration | land cover matches Earth's to within 2.6 points across forest, grassland, desert and tundra |
| verification | 109 measurements, diffed run to run |

## Where to start reading

| | |
|---|---|
| [docs/architecture.md](docs/architecture.md) | the layers, the scale ladder, and why nothing is stored |
| [docs/world-generation.md](docs/world-generation.md) | how a planet is built, and what it was calibrated against |
| [docs/determinism.md](docs/determinism.md) | why there is a fixed-point layer and no `Math.sin` anywhere |
| [docs/testing.md](docs/testing.md) | how to run the suites and how to read a moved measurement |
| [docs/fix-attempts.md](docs/fix-attempts.md) | what has already been tried, and the measurement that killed it |
| [docs/known-gaps.md](docs/known-gaps.md) | what is deliberately not done yet |

## Running it

Needs Node 22.18 or newer — it runs the TypeScript directly, so there is no
build step and no `npm install` for anything but the type checker.

```
node verify/run_all.ts          # 109 measurements, diffed against the baseline
node verify/run_all.ts --anchor # accept the current numbers as the new baseline
node verify/calibrate_climate.ts# sweep the climate model against Earth
```

## The scale

| Layer | Cells | Across | Area | What it is |
|---|---|---|---|---|
| Region | 10,242 | 277 km | 49,800 km² | the world map |
| Realm | ×9,919 | 2.8 km | 4.98 km² | kingdom borders are drawn here |
| Ground | ×9,919 | 28 m | 506 m² | biome, soil, ore, flora, fauna, people |
| Plot | ×9,919 | 28 cm | 0.05 m² | building interiors |

**1.008 trillion ground tiles.** None of them are stored. A tile is a pure
function of the world seed and its address, computed the instant somebody
looks at it; the database holds only the tiles a player has changed. An
untouched tile costs zero bytes, which is the only reason a trillion of them
is possible.
