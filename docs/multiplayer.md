# Multiplayer

## The server never sends a map

It sends a seed.

A client has the whole generator — the same `sim/` the server runs — so it
rebuilds the planet, the realm maps and the ground maps locally from that one
number. What actually crosses the wire is the seed, the turn counter, and the
**deltas**: the handful of tiles somebody has changed.

Measured, from `verify/check_app.ts`: a welcome message for a world of
**1,007,675,157,762 tiles is 189 bytes**. The whole saved state of a world with
two players and a settlement seven turns old is **481 bytes** of delta log.

This is why `docs/determinism.md` is as strict as it is. If two machines could
generate the seed differently, this design would be a bug rather than an
optimisation — the client would draw a coastline the server disagreed with, and
nobody would find out until a city was built on it.

## Desync detection

So the client hashes each region as it opens it and sends the fingerprint up.
The server compares it with its own and says so immediately if they differ.

It is the cheapest insurance in the project and it is verified two ways: two
independent clients generate region 166 to the identical fingerprint
`86678241`, and a deliberately wrong hash **is** reported rather than passing
silently. A check that cannot fail is decoration.

The fingerprint quantises elevation to a metre before hashing. That is
deliberate — `Float32` rounding on two different builds could differ in the
last bit for reasons that do not matter, and a desync alarm that cries wolf
gets switched off.

## Turns

Two minutes of real time is one game-week. Turns resolve **simultaneously**:
everyone's orders are collected, sorted into an order that is a property of the
orders rather than of who pressed send first, and applied together.

Nobody gains anything from a better connection. That matters more in a
persistent world than in a match — here the advantage would compound for
months.

Sort key: player, then action, then target, then amount. Never arrival.

## Persistence

Two files.

`world.json` holds the seed, the turn counter and the players. Written with a
write-and-rename, because a rename is atomic and this is the only thing in the
store that cannot be reconstructed.

`deltas.jsonl` is append-only, one line per changed tile per turn. An append
cannot half-succeed in a way that loses what was already there; a crash
mid-write costs the last line, which the reader discards as unparseable. Later
lines win on replay, and a line with no fields is a tombstone.

It compacts when the log grows past four times the live set — so a small world
compacts often and cheaply and a large one is left alone.

## The wire

| | |
|---|---|
| `hello` | name and protocol version |
| `welcome` | seed, radius, player id, turn, turn length, all deltas, players |
| `order` | claim, settle or abandon a ground tile. Queued for the next turn |
| `turn` | turn number, seconds to the next, changed tiles, players |
| `hash` | a client's fingerprint of a region it generated |
| `desync` | sent back only when the fingerprints disagree |

Everything arriving from a client is untrusted. `parseClientMessage` returns
null rather than throwing, because one malformed frame must not be able to stop
a turn loop that is shared by everybody.

## The WebSocket implementation

Hand-rolled, in `server/ws.ts`, about two hundred lines and no dependencies.
`ws` would do it better and is one `npm install` away; it is not here because
the whole project currently runs on a bare Node with nothing installed, and
keeping that true is worth the hundred lines. Swap it without regret the moment
this needs compression, real fragmentation, or to face the open internet.

One warning, recorded because it cost an hour. The RFC 6455 magic GUID is
`258EAFA5-E914-47DA-95CA-C5AB0DC85B11`. Transcribe it wrong by one character
and the handshake **still looks perfect** — the server sends a well-formed 101
with a plausible base64 accept value, and every client silently refuses it with
nothing in any log. `verify_protocol.ts` now pins it against the test vector in
the RFC itself.

## What is not here

**Supply lines.** A settlement eats only what the tile it stands on grows.
Since a ground tile is 506 m² and one person needs about 0.55 ha of good land,
a tile feeds roughly a tenth of a person — so twenty settlers starve, correctly
and immediately. Drawing food from surrounding tiles is the next system and it
is the one that makes "you can sustain whatever you can sustain" mean anything.

**Houses and alliances.** Players have a house number and it colours their
borders. Nothing else uses it yet.

**Accounts.** Players rejoin by name. Good enough to play with, not good enough
for anything else.
