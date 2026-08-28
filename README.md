# medieval-strategy

*Working folder name. Rename it the moment the game has a real one.*

A persistent hex planet, played a week at a time.

**In one line:** an Earth-sized world of a trillion tiles, generated rather
than stored, where you begin as a frontiersman with four attendants and build
whatever your supply lines can feed — with no population cap and no army cap,
shared with every other player, resolving two-minute turns of one game-week
each.

## What is here now

A world you can look at, share, settle, trade across, and watch fill up.

| | |
|---|---|
| the globe | 92 regions on a true icosahedral sphere, with the twelve pentagons a sphere cannot avoid |
| the ladder | eight layers, each a 10×10 hexagon of hexagons, from a 2,922 km region down to a 41 cm pace |
| generation | plate tectonics to elevation to climate to biome, cascading top-down, reproducible forever from one seed |
| the lower layers | realm and ground maps, rivers from flow accumulation, soil, ore, timber and game per tile |
| supply | settlements work the land they can reach; hauling food costs food, and water is 42.7× cheaper than road |
| trade | grain and iron move between towns, so a town that cannot feed itself can live on somebody else's surplus |
| specialisation | a town on barren ore stays a hamlet alone and becomes an ironworks with a neighbour — same tile, same seed |
| spreading | a town that fills its land throws off daughters, and stops where it meets somebody. Borders are residue |
| kingdoms | bounded at 393 km, which is what forty days of feudal service and a walking pace multiply out to |
| multiplayer | a turn server, two clients sharing one world, live desync detection, persistence |
| verification | 409 measurements diffed run to run, plus an end-to-end run of the real thing |

Calibration, none of it tuned to hit its target: land cover within 2.6 points of
Earth's; water:road transport cost 42.7 against Diocletian's 40; best farmland
at 0.89–1.03 ha per person against a measured historical 0.5–1.5; 12.4 man-days
to a sown acre against a historical 10–15; one ironworker keeping 285 people in
tools against a manorial record of a smith per few hundred.

**Not here yet:** conflict between kingdoms, NPC kingdoms that exist before you
arrive, roads, crafts beyond iron, and the frontiersman himself. See
[docs/known-gaps.md](docs/known-gaps.md).

## Where to start reading

| | |
|---|---|
| [docs/architecture.md](docs/architecture.md) | the layers, the scale ladder, and why nothing is stored |
| [docs/world-generation.md](docs/world-generation.md) | how a planet is built, and what it was calibrated against |
| [docs/determinism.md](docs/determinism.md) | why there is a fixed-point layer and no `Math.sin` anywhere |
| [docs/supply.md](docs/supply.md) | how food gets from where it grows to where it is eaten |
| [docs/trade.md](docs/trade.md) | how towns specialise, and the medieval farming year task by task |
| [docs/kingdoms.md](docs/kingdoms.md) | how towns spread, and why nobody designs a border |
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

node verify/run_all.ts           # 409 measurements, diffed against the baseline
node verify/run_all.ts --anchor  # accept the current numbers as the new baseline
node verify/check_app.ts         # a real server and two real clients, end to end
node verify/calibrate_climate.ts # sweep the climate model against Earth
```

Drag to turn the globe, click a region, double-click or press Enter to descend.
Escape goes back up. Claim a ground tile, settle it, and the fields it works are
drawn in gold — the ring pattern is von Thünen's, and nothing in the code
mentions a ring.

Then settle a second town on bad ground with ore under it, and watch it stop
farming. Leave the first one running and it will fill its land, throw off
daughter villages, and stop when it runs into the second.

## The scale

Every layer is a "10 by 10" hexagon of hexagons — 91 cells, the nearest
hexagonal number to a hundred. The globe is a Goldberg polyhedron of frequency
3: 92 cells, 80 hexagons and the 12 pentagons a sphere cannot avoid.

| Layer | Area | Across | Cells in the world |
|---|---|---|---|
| region | 5,544,179 km² | 2,922 km | 92 |
| march | 60,925 km² | 306 km | 8,372 |
| shire | 670 km² | 32 km | 761,852 |
| hundred | 7.36 km² | 3.4 km | 69.3 M |
| parish | 8.09 ha | 353 m | 6.31 G |
| **plot** | **888 m²** | **37 m** | **574 G** |
| yard | 9.76 m² | 3.9 m | 52.2 T |
| pace | 0.107 m² | 41 cm | 4.75 P |

**574 billion plots**, and 4.75 quadrillion cells at the finest layer, where one
hex is about where a person stands. None of them are stored. A tile is a pure
function of the world seed and its address, computed the instant somebody looks
at it; the database holds only the tiles a player has changed.

Opening a tile costs eight generator calls of 91 cells each — **2 ms**, faster
than the four calls of 9,919 cells it replaced.

## What crosses the wire

A welcome message for a world of 1,007,675,157,762 tiles is **189 bytes**. The
whole saved state of a two-player world seven turns old is **481 bytes**.

The server sends a seed; the client builds the planet itself from the same
`sim/` code. Both then hash what they generated and compare, so a disagreement
surfaces in a second rather than a month. See
[docs/multiplayer.md](docs/multiplayer.md).
