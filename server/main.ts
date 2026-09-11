// The server: one world, many players, a turn every two minutes.
//
// It does three jobs. It serves the client -- including stripping the types
// out of the shared `sim/` modules on the way to the browser, so there is no
// build step anywhere in this project. It holds the authoritative world and
// resolves a turn on a timer. And it persists a seed and a delta log, which is
// the entire saved state of a trillion tiles.
//
// What it does NOT do is send anyone a map. See server/protocol.ts.
//
//   node server/main.ts
//   node server/main.ts --port 8080 --seed 1234 --turn-seconds 10
//   node server/main.ts --data ./data/myworld

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize, extname, resolve, sep } from 'node:path';
import { stripTypeScriptTypes } from 'node:module';

import { World } from '../sim/world.ts';
import { resolveTurn, regionFingerprint, type Order } from '../sim/turn.ts';
import { fromKey } from '../sim/geo/address.ts';
import { accept, type WsConnection } from './ws.ts';
import {
  parseClientMessage, encode, PROTOCOL_VERSION,
  type PlayerInfo, type ServerMessage,
} from './protocol.ts';
import { Store, type SavedPlayer } from './persist.ts';

// --- arguments --------------------------------------------------------------

const argv = process.argv.slice(2);
const arg = (name: string, fallback: string): string => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : fallback;
};

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(arg('port', '8787'));
const DATA_DIR = resolve(arg('data', join(ROOT, 'data', 'world')));
const TURN_SECONDS = Number(arg('turn-seconds', '120'));
const HEADLESS_TURNS = Number(arg('turns', '0'));

// --- world ------------------------------------------------------------------

const store = new Store(DATA_DIR);
const existing = store.loadMeta();

const seed = existing?.seed ?? Number(arg('seed', String(Date.now() % 2147483647)));
const world = new World({ seed, radiusM: existing?.radiusM });
world.turn = existing?.turn ?? 0;

const savedDeltas = store.loadDeltas();
world.loadDeltas(savedDeltas);
world.loadPolities(existing?.polities ?? []);

const players: SavedPlayer[] = existing?.players ?? [];
const pending = new Map<number, Order[]>();
const connections = new Map<number, WsConnection>();

console.log(`\n  medieval-strategy server`);
console.log(`  ${world.describe()}`);
console.log(`  loaded ${savedDeltas.length} delta(s) from ${store.directory}`);
console.log(`  one turn = ${TURN_SECONDS}s real, ${7} days in game\n`);

// --- static files, with types stripped on the way out -----------------------

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.ts': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

function serve(req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const requested = url.pathname === '/' ? '/client/index.html' : url.pathname;

  // Resolve, then check the result is still under ROOT. Checking the *input*
  // for ".." is the classic mistake -- there are a dozen ways to write it, and
  // only the resolved path tells the truth about where a request landed.
  const path = resolve(join(ROOT, normalize(requested)));
  if (!path.startsWith(ROOT + sep)) {
    res.writeHead(403).end('outside the project');
    return;
  }
  if (!existsSync(path) || !statSync(path).isFile()) {
    res.writeHead(404).end('not found');
    return;
  }

  const ext = extname(path);
  let body: string | Buffer = readFileSync(path);

  if (ext === '.ts') {
    // The browser cannot run TypeScript, and this project has no build step,
    // so the types come out here. `strip` replaces them with whitespace rather
    // than reformatting, which keeps line numbers identical between the file
    // on disk, the server's own copy, and the browser's stack traces.
    body = stripTypeScriptTypes(body.toString('utf8'), { mode: 'strip' });
  }

  res.writeHead(200, {
    'Content-Type': MIME[ext] ?? 'application/octet-stream',
    'Cache-Control': 'no-cache',
  });
  res.end(body);
}

const http = createServer(serve);

// --- players and connections ------------------------------------------------

let nextConnectionId = 1;

function publicPlayers(): PlayerInfo[] {
  return players.map((p) => ({ id: p.id, name: p.name, seat: p.seat, house: p.house }));
}

function send(conn: WsConnection, msg: ServerMessage): void {
  conn.send(encode(msg));
}

function broadcast(msg: ServerMessage): void {
  const text = encode(msg);
  for (const conn of connections.values()) if (conn.isOpen) conn.send(text);
}

http.on('upgrade', (req, socket) => {
  const id = nextConnectionId++;
  const conn = accept(req, socket, id);
  if (conn === null) return;

  let playerId = -1;

  conn.on({
    onMessage: (raw) => {
      const msg = parseClientMessage(raw);
      if (msg === null) {
        send(conn, { t: 'error', reason: 'unreadable message' });
        return;
      }

      switch (msg.t) {
        case 'hello': {
          if (msg.version !== PROTOCOL_VERSION) {
            send(conn, { t: 'error', reason: `protocol ${PROTOCOL_VERSION} required` });
            conn.close();
            return;
          }
          // Rejoin by name, so a reload does not orphan a settlement. Real
          // identity needs accounts; this is enough to play with.
          let player = players.find((p) => p.name === msg.name);
          if (player === undefined) {
            player = { id: players.length, name: msg.name, seat: null, house: players.length };
            players.push(player);
          }
          playerId = player.id;
          connections.set(playerId, conn);

          send(conn, {
            t: 'welcome',
            version: PROTOCOL_VERSION,
            seed: world.seed,
            radiusM: world.radiusM,
            playerId,
            turn: world.turn,
            turnSeconds: TURN_SECONDS,
            gameDaysPerTurn: 7,
            deltas: world.allDeltas(),
            players: publicPlayers(),
            polities: world.allPolities(),
          });
          console.log(`  + ${player.name} joined as player ${playerId}`);
          break;
        }

        case 'order': {
          if (playerId < 0) { send(conn, { t: 'error', reason: 'say hello first' }); return; }
          const queue = pending.get(playerId) ?? [];
          queue.push({
            player: playerId, target: msg.target, action: msg.action, amount: msg.amount,
          });
          pending.set(playerId, queue);
          send(conn, { t: 'ack', target: msg.target, ok: true });
          break;
        }

        case 'hash': {
          // The determinism check, live. A client that generated a different
          // world from the same seed finds out now, not in a month.
          const mine = regionFingerprint(world, msg.region);
          if (mine !== msg.hash) {
            console.error(`  ! DESYNC region ${msg.region}: server ${mine.toString(16)} client ${msg.hash.toString(16)}`);
            send(conn, { t: 'desync', region: msg.region, serverHash: mine, clientHash: msg.hash });
          }
          break;
        }
      }
    },
    onClose: () => {
      if (playerId >= 0) {
        connections.delete(playerId);
        console.log(`  - player ${playerId} left`);
      }
    },
  });
});

// --- the turn loop ----------------------------------------------------------

function runTurn(): void {
  const orders: Order[] = [];
  for (const queue of pending.values()) orders.push(...queue);
  pending.clear();

  const result = resolveTurn(world, orders, players.length);

  // Anyone who settled has a seat now.
  for (const delta of result.changed) {
    if (delta.owner !== undefined && delta.population) {
      const p = players.find((q) => q.id === delta.owner);
      if (p !== undefined && p.seat === null) p.seat = delta.key;
    }
  }

  store.appendDeltas(result.changed);
  store.saveMeta({
    seed: world.seed,
    radiusM: world.radiusM,
    turn: world.turn,
    players,
    polities: world.allPolities(),
    createdAt: existing?.createdAt ?? new Date().toISOString(),
  });

  // Compact once the log has grown well past the live set. Comparing against
  // the live count rather than a fixed number means a small world compacts
  // often and cheaply, and a big one leaves it alone.
  if (store.appendsSinceCompaction > Math.max(500, world.deltaCount * 4)) {
    store.compact(world.allDeltas());
    console.log(`  compacted the delta log to ${world.deltaCount} live tile(s)`);
  }

  let people = 0;
  for (const d of world.allDeltas()) people += d.population ?? 0;

  const grew = result.foundings.length > 0
    ? `, ${result.foundings.length} village(s) founded`
      + (result.foundings.some((f) => f.broke)
        ? ` (${result.foundings.filter((f) => f.broke).length} beyond reach, now independent)` : '')
    : '';
  const war = result.battles.length > 0
    ? `, ${result.battles.length} raid(s)`
      + (result.battles.some((b) => b.conqueredBy !== null)
        ? ` (${result.battles.filter((b) => b.conqueredBy !== null).length} conquered)` : '')
    : '';
  const trade = result.tradeRoutes > 0
    ? `, ${Math.round(result.grainShippedKg).toLocaleString('en')} kg grain and `
      + `${Math.round(result.ironShippedKg).toLocaleString('en')} kg iron over `
      + `${result.tradeRoutes} route(s)`
    : '';
  const court = result.successions.length > 0
    ? `, ${result.successions.length} succession(s)`
      + (result.successions.some((s) => s.kind === 'extinct')
        ? ` (${result.successions.filter((s) => s.kind === 'extinct').length} line(s) failed)` : '')
    : '';
  console.log(
    `  turn ${world.turn}: ${orders.length} order(s), `
    + `${result.rejected.length} rejected, ${result.changed.length} tile(s) changed, `
    + `${world.deltaCount} live, ${Math.round(people).toLocaleString('en')} people`
    + `, ${world.polities.size} kingdom(s)${grew}${war}${trade}${court}`,
  );
  for (const r of result.rejected.slice(0, 5)) {
    console.log(`      rejected ${r.order.action} ${r.order.target}: ${r.reason}`);
  }

  broadcast({
    t: 'turn',
    turn: world.turn,
    nextIn: TURN_SECONDS,
    changed: result.changed,
    players: publicPlayers(),
    polities: world.allPolities(),
    raids: result.battles.length > 0
      ? result.battles.map((b) => ({
        attacker: b.attacker, defender: b.defender,
        attackerWon: b.attackerWon, conquered: b.conqueredBy !== null,
        defenderDead: Math.round(b.defenderDead),
      }))
      : undefined,
    successions: result.successions.length > 0
      ? result.successions.map((s) => ({
        polity: s.polity, kind: s.kind,
        priorName: s.priorName, lordName: s.lordName,
      }))
      : undefined,
  });
}

// --- start ------------------------------------------------------------------

if (HEADLESS_TURNS > 0) {
  // Drive the loop without a socket in sight, for the suites and for anyone
  // who wants to know what a hundred turns does to a settlement.
  console.log(`  running ${HEADLESS_TURNS} turn(s) headless\n`);
  for (let i = 0; i < HEADLESS_TURNS; i++) runTurn();
  console.log(`\n  ${world.describe()}\n`);
  process.exit(0);
}

http.listen(PORT, () => {
  console.log(`  http://localhost:${PORT}\n`);
});

setInterval(runTurn, TURN_SECONDS * 1000);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    console.log('\n  saving and shutting down');
    store.saveMeta({
      seed: world.seed,
      radiusM: world.radiusM,
      turn: world.turn,
      players,
      polities: world.allPolities(),
      createdAt: existing?.createdAt ?? new Date().toISOString(),
    });
    store.compact(world.allDeltas());
    process.exit(0);
  });
}

export { world, runTurn, fromKey };
