# medieval-strategy

*Working folder name. Rename it the moment the game has a real one.*

A persistent hex planet, played a week at a time.

**In one line:** an Earth-sized world of a trillion tiles, generated rather
than stored, where you begin as a frontiersman with four attendants and build
whatever your supply lines can feed — with no population cap and no army cap,
shared with every other player, resolving two-minute turns of one game-week
each.

## What is here now

A world you can look at, share, settle, and starve in.

| | |
|---|---|
| the globe | 10,242 regions on a true icosahedral sphere, with the twelve pentagons a sphere cannot avoid |
| generation | plate tectonics to elevation to climate to biome, cascading top-down, reproducible forever from one seed |
| the lower layers | realm and ground maps, rivers from flow accumulation, soil, ore, timber and game per tile |
| supply | settlements work the land they can reach; hauling food costs food, and water is 42.7× cheaper than road |
| growth | no population cap — a settlement grows until it runs out of hands, land or food |
| multiplayer | a turn server, two clients sharing one world, live desync detection, persistence |
| verification | 301 measurements diffed run to run, plus an end-to-end run of the real thing |

Calibration, none of it tuned to hit its target: land cover within 2.6 points of
Earth's across forest, grassland, desert and tundra; water:road transport cost
42.7 against Diocletian's 40; best farmland at 0.89–1.03 ha per person against a
measured historical 0.5–1.5.

**Not here yet:** trade between settlements, roads, crafts, and the
frontiersman himself. See [docs/known-gaps.md](docs/known-gaps.md).

## Where to start reading

| | |
|---|---|
| [docs/architecture.md](docs/architecture.md) | the layers, the scale ladder, and why nothing is stored |
| [docs/world-generation.md](docs/world-generation.md) | how a planet is built, and what it was calibrated against |
| [docs/determinism.md](docs/determinism.md) | why there is a fixed-point layer and no `Math.sin` anywhere |
| [docs/supply.md](docs/supply.md) | how food gets from where it grows to where it is eaten |
| [docs/multiplayer.md](docs/multiplayer.md) | the turn server, the wire, and why it never sends a map |
| [docs/testing.md](docs/testing.md) | how to run the suites and how to read a moved measurement |
| [docs/fix-attempts.md](docs/fix-attempts.md) | what has already been tried, and the measurement that killed it |
| [docs/known-gaps.md](docs/known-gaps.md) | what is deliberately not done yet |

## Running it

Needs Node 22.18 or newer — it runs the TypeScript directly, so there is no
build step and no `npm install` for anything but the type checker.

```
node server/main.ts              # then open http://localhost:8787
node server/main.ts --turn-seconds 10 --seed 1234
node server/main.ts --turns 50   # headless, no socket in sight

node verify/run_all.ts           # 301 measurements, diffed against the baseline
node verify/run_all.ts --anchor  # accept the current numbers as the new baseline
node verify/check_app.ts         # a real server and two real clients, end to end
node verify/calibrate_climate.ts # sweep the climate model against Earth
```

Drag to turn the globe, click a region, double-click or press Enter to descend.
Escape goes back up. Claim a ground tile, settle it, and the fields it works are
drawn in gold — the ring pattern is von Thünen's, and nothing in the code
mentions a ring. Site it on a river and watch how much further it can reach.

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

## What crosses the wire

A welcome message for a world of 1,007,675,157,762 tiles is **189 bytes**. The
whole saved state of a two-player world seven turns old is **481 bytes**.

The server sends a seed; the client builds the planet itself from the same
`sim/` code. Both then hash what they generated and compare, so a disagreement
surfaces in a second rather than a month. See
[docs/multiplayer.md](docs/multiplayer.md).
