// The real thing, driven end to end.
//
// Every other suite runs the simulation in-process. This one starts the actual
// server as a child process, connects two actual WebSocket clients, has them
// build the world from the seed the way the browser does, issue orders, and
// watch a turn resolve -- then kills the server, restarts it, and checks the
// world came back.
//
// It exists because a green suite has never once proved that the thing works.
// The predecessor to this project shipped two crashes that every unit suite
// passed, both because nothing drove the real app.
//
// Named check_ rather than verify_ so run_all does not pick it up: it needs a
// free port and about thirty seconds, which is the wrong shape for a suite you
// run before and after every edit. Run it before every commit instead.
//
//   node verify/check_app.ts

import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { rmSync, existsSync, readFileSync } from 'node:fs';
import { World } from '../sim/world.ts';
import { regionFingerprint } from '../sim/turn.ts';
import { toKey } from '../sim/geo/address.ts';
import { CELL_COUNT } from '../sim/geo/sphere.ts';
import { Biome } from '../sim/model/biome.ts';
import type { ServerMessage, WelcomeMessage, TurnMessage } from '../server/protocol.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'data', 'apptest');
const PORT = 8799;
const SEED = 20260826;
const TURN_SECONDS = 3;

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `   ${detail}` : ''}`);
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function startServer(): ChildProcess {
  const child = spawn(process.execPath, [
    join(ROOT, 'server', 'main.ts'),
    '--data', DATA, '--seed', String(SEED),
    '--port', String(PORT), '--turn-seconds', String(TURN_SECONDS),
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout?.on('data', () => {});
  child.stderr?.on('data', (b: Buffer) => process.stderr.write(`    server: ${b}`));
  return child;
}

/** A client that behaves the way the browser one does. */
class TestClient {
  socket: WebSocket;
  welcome: WelcomeMessage | null = null;
  turns: TurnMessage[] = [];
  desyncs = 0;
  world: World | null = null;

  readonly name: string;

  constructor(name: string) {
    this.name = name;
    this.socket = new WebSocket(`ws://localhost:${PORT}`);
    this.socket.addEventListener('open', () => {
      this.socket.send(JSON.stringify({ t: 'hello', version: 1, name }));
    });
    this.socket.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data as string) as ServerMessage;
      if (msg.t === 'welcome') {
        this.welcome = msg;
        // Exactly what the browser does: build the whole world from the seed.
        this.world = new World({ seed: msg.seed, radiusM: msg.radiusM });
        this.world.turn = msg.turn;
        this.world.loadDeltas(msg.deltas);
      } else if (msg.t === 'turn') {
        this.turns.push(msg);
        if (this.world !== null) {
          this.world.turn = msg.turn;
          for (const d of msg.changed) {
            const empty = d.owner === undefined && d.population === undefined
              && d.populationHealth === undefined;
            this.world.setDelta(keyToAddress(d.key), empty
              ? { owner: undefined, population: undefined, populationHealth: undefined }
              : d);
          }
        }
      } else if (msg.t === 'desync') {
        this.desyncs++;
      }
    });
  }

  send(obj: unknown): void { this.socket.send(JSON.stringify(obj)); }
  close(): void { this.socket.close(); }

  async waitForWelcome(ms = 15000): Promise<boolean> {
    const until = Date.now() + ms;
    while (this.welcome === null && Date.now() < until) await sleep(50);
    return this.welcome !== null;
  }

  async waitForTurn(n: number, ms = 20000): Promise<boolean> {
    const until = Date.now() + ms;
    while (this.turns.length < n && Date.now() < until) await sleep(50);
    return this.turns.length >= n;
  }
}

function keyToAddress(key: string): number[] {
  return key.split('.').map((p) => parseInt(p, 36));
}

// ---------------------------------------------------------------------------

console.log('\n  end to end: a real server, two real clients\n');

rmSync(DATA, { recursive: true, force: true });
let server = startServer();
await sleep(2500);

const alice = new TestClient('alice');
const bob = new TestClient('bob');

check('alice connects and is welcomed', await alice.waitForWelcome());
check('bob connects and is welcomed', await bob.waitForWelcome());

if (alice.welcome === null || bob.welcome === null) {
  server.kill();
  process.exit(1);
}

check('both are given the same seed', alice.welcome.seed === bob.welcome.seed,
  `${alice.welcome.seed}`);
check('they are different players', alice.welcome.playerId !== bob.welcome.playerId,
  `${alice.welcome.playerId} vs ${bob.welcome.playerId}`);
check('a fresh world has no deltas', alice.welcome.deltas.length === 0);

// The claim the whole architecture rests on: the wire carried a seed, not a
// map, and both clients built the same trillion-tile world from it.
const aliceWorld = alice.world!;
const bobWorld = bob.world!;
check('the wire carried no map', JSON.stringify(alice.welcome).length < 4096,
  `${JSON.stringify(alice.welcome).length} bytes of welcome`);
check('both built the same tile count',
  aliceWorld.totalCellsAt(2) === bobWorld.totalCellsAt(2),
  aliceWorld.totalCellsAt(2).toLocaleString('en'));

// Pick a land region both can reach, and fingerprint it on both.
let region = 0;
for (let c = 0; c < CELL_COUNT; c++) {
  if (aliceWorld.planet.elevationM[c] > 200
    && aliceWorld.planet.biome[c] === Biome.TemperateForest) { region = c; break; }
}
const aliceHash = regionFingerprint(aliceWorld, region);
const bobHash = regionFingerprint(bobWorld, region);
check('two independent clients generate an identical region',
  aliceHash === bobHash, `region ${region} = ${aliceHash.toString(16)}`);

// And tell the server, which compares against its own.
alice.send({ t: 'hash', region, hash: aliceHash });
bob.send({ t: 'hash', region, hash: bobHash });
await sleep(600);
check('the server agrees with both of them', alice.desyncs === 0 && bob.desyncs === 0);

// A deliberately wrong hash must be caught, or the check is decoration.
bob.send({ t: 'hash', region: region + 1, hash: 0xdeadbeef });
await sleep(600);
check('a wrong fingerprint IS reported as a desync', bob.desyncs === 1,
  `${bob.desyncs} reported`);

// --- orders ----------------------------------------------------------------

const aliceTile = [region, 4959, 4959];
const bobTile = [region, 4959, 5000];
const aliceKey = toKey(aliceTile);
const bobKey = toKey(bobTile);

alice.send({ t: 'order', action: 'claim', target: aliceKey });
bob.send({ t: 'order', action: 'claim', target: bobKey });
// And a contested claim, which must go to exactly one of them.
bob.send({ t: 'order', action: 'claim', target: aliceKey });

check('alice sees a turn resolve', await alice.waitForTurn(1));
check('bob sees the same turn', await bob.waitForTurn(1));

// Wait for the claim to land, rather than assuming it lands on the first turn
// anyone happens to observe. The turn timer starts when the server does, so a
// client connecting two seconds in may see a turn resolve before its own
// orders have arrived -- which is correct behaviour and was, for one run, a
// failing test. Poll for the effect instead of guessing the turn number.
async function ownerOf(client: TestClient, address: number[], ms = 20000): Promise<number> {
  const until = Date.now() + ms;
  for (;;) {
    const owner = client.world!.tile(address).owner;
    if (owner >= 0 || Date.now() > until) return owner;
    await sleep(100);
  }
}

const aliceOwns = await ownerOf(alice, aliceTile);
const bobSeesAliceTile = await ownerOf(bob, aliceTile);
check('a contested tile went to exactly one player', aliceOwns >= 0, `owner ${aliceOwns}`);
check('both clients agree who owns it', aliceOwns === bobSeesAliceTile,
  `alice says ${aliceOwns}, bob says ${bobSeesAliceTile}`);
check('the uncontested claim also landed',
  (await ownerOf(bob, bobTile)) >= 0);
check('a turn carried changed tiles',
  alice.turns.some((t) => t.changed.length > 0),
  `${alice.turns.reduce((n, t) => n + t.changed.length, 0)} changes across ${alice.turns.length} turn(s)`);

// --- settling and eating ---------------------------------------------------

const settler = aliceOwns === alice.welcome.playerId ? alice : bob;
const settleFrom = settler.turns.length;
settler.send({ t: 'order', action: 'settle', target: aliceKey, amount: 20 });
check('a settlement resolves', await settler.waitForTurn(settleFrom + 2));

const settled = settler.world!.tile(aliceTile);
check('people are on the tile', settled.population > 0, `${settled.population} people`);
check('the tile reads as modified', settled.modified);
check('generated fields are untouched by the delta',
  settled.biome === aliceWorld.subMap([region, 4959]).biome[4959]);

// Let a few turns of hunger run. One 506 m2 tile cannot feed twenty people --
// it feeds about a tenth of one -- so they must be starving, and that is the
// correct answer rather than a bug. Supply from neighbouring tiles is the
// system that fixes it, and it is not written yet.
await settler.waitForTurn(settleFrom + 5);
const hungry = settler.world!.tile(aliceTile);
check('a tile that cannot feed its people starves them',
  hungry.populationHealth < 1 || hungry.population < settled.population,
  `health ${hungry.populationHealth.toFixed(2)}, ${hungry.population} left`);

// --- persistence -----------------------------------------------------------

alice.close();
bob.close();
server.kill('SIGINT');
await sleep(1500);

check('a world file was written', existsSync(join(DATA, 'world.json')));
const meta = JSON.parse(readFileSync(join(DATA, 'world.json'), 'utf8'));
check('the seed was saved', meta.seed === SEED);
check('the turn counter was saved', meta.turn >= 5, `turn ${meta.turn}`);
check('the players were saved', meta.players.length === 2);

const savedBytes = existsSync(join(DATA, 'deltas.jsonl'))
  ? readFileSync(join(DATA, 'deltas.jsonl')).length : 0;
check('the whole saved world is tiny', savedBytes < 20000, `${savedBytes} bytes of deltas`);

server = startServer();
await sleep(2500);
const carol = new TestClient('carol');
check('a client connects to the reloaded world', await carol.waitForWelcome());

if (carol.welcome !== null) {
  check('the reloaded world has the same seed', carol.welcome.seed === SEED);
  check('the turn counter survived', carol.welcome.turn >= 5, `turn ${carol.welcome.turn}`);
  check('the settlement survived the restart', carol.welcome.deltas.length > 0,
    `${carol.welcome.deltas.length} deltas restored`);
  const restored = carol.world!.tile(aliceTile);
  check('the claimed tile is still claimed', restored.owner >= 0, `owner ${restored.owner}`);
  // And the terrain under it is the same terrain, rebuilt rather than stored.
  check('the terrain regenerated identically after a restart',
    regionFingerprint(carol.world!, region) === aliceHash);
}

carol.close();
server.kill('SIGINT');
await sleep(800);
rmSync(DATA, { recursive: true, force: true });

console.log(`\n  ${failures === 0 ? 'all checks passed' : `${failures} FAILING`}\n`);
process.exit(failures > 0 ? 1 : 0);
