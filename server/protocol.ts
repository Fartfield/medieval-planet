// The wire.
//
// THE THING WORTH NOTICING
//
// The server never sends a map. It sends a seed.
//
// A client has the whole generator -- the same `sim/` the server runs -- so it
// rebuilds the planet, the realm maps and the ground maps locally from that one
// number. What actually crosses the wire is the seed, the turn counter, and the
// deltas: the handful of tiles somebody has changed. A world with a trillion
// tiles and ten thousand players is a few hundred kilobytes on the wire, and
// most of that is player names.
//
// This is the entire reason `docs/determinism.md` is as strict as it is. If two
// machines could generate the seed differently, this design would be a bug
// rather than an optimisation -- the client would draw a coastline the server
// disagreed with and nobody would find out until a city was built on it. So the
// client reports a hash of what it generated, the server compares it with its
// own, and a mismatch is reported the moment it happens rather than a month
// later. `verifyHash` below is the cheapest insurance in the project.

import type { TileDelta } from '../sim/model/tile.ts';
import type { Polity } from '../sim/model/polity.ts';

export const PROTOCOL_VERSION = 1;

// --- client to server -------------------------------------------------------

export interface HelloMessage {
  t: 'hello';
  version: number;
  name: string;
}

/** A claim on a tile, or people put on it. Queued, applied at turn end. */
export interface OrderMessage {
  t: 'order';
  /** Address as a key string, from geo/address.ts. */
  target: string;
  action: 'claim' | 'settle' | 'abandon';
  /** For settle: how many people. */
  amount?: number;
}

/**
 * The client's fingerprint of a region it generated, for desync detection.
 * Sent unprompted whenever a client opens a region it has not checked before.
 */
export interface HashMessage {
  t: 'hash';
  region: number;
  hash: number;
}

export type ClientMessage = HelloMessage | OrderMessage | HashMessage;

// --- server to client -------------------------------------------------------

export interface WelcomeMessage {
  t: 'welcome';
  version: number;
  /** Everything needed to rebuild the world. This is the whole map, in a word. */
  seed: number;
  radiusM: number;
  playerId: number;
  turn: number;
  /** Seconds of real time per turn, and what one turn represents in game. */
  turnSeconds: number;
  gameDaysPerTurn: number;
  /** Every tile anybody has changed. Small, because almost nobody has. */
  deltas: TileDelta[];
  players: PlayerInfo[];
  /** Kingdoms. The only thing about the world that is not in the seed. */
  polities: Polity[];
}

export interface PlayerInfo {
  id: number;
  name: string;
  /** Where they are, as an address key, or null before they have settled. */
  seat: string | null;
  house: number;
}

/** One raid, as the client needs it: who, who won, and what it cost. */
export interface RaidReport {
  /** Address key of the raider and the raided. */
  attacker: string;
  defender: string;
  attackerWon: boolean;
  /** Defender's ground changed hands. */
  conquered: boolean;
  /** Men the defender lost, for the chronicle. */
  defenderDead: number;
}

/** One change of lord, as the chronicle needs it. */
export interface SuccessionReport {
  /** The realm whose seat changed hands. */
  polity: number;
  /** A succession within the line, or the line itself failing. */
  kind: 'succeeded' | 'extinct';
  /** The lord who died. */
  priorName: string;
  /** The heir, or the founder of the new house when a line failed. */
  lordName: string;
  /** True when the lord fell in battle rather than died in his bed. */
  inWar: boolean;
}

/** End of turn. Carries only what changed. */
export interface TurnMessage {
  t: 'turn';
  turn: number;
  /** Real-time seconds until the next one resolves. */
  nextIn: number;
  changed: TileDelta[];
  players: PlayerInfo[];
  polities: Polity[];
  /** Raids fought this turn, for the map and the chronicle. Absent if none. */
  raids?: RaidReport[];
  /** Lords who died or lines that failed this turn, for the chronicle. */
  successions?: SuccessionReport[];
}

export interface AckMessage {
  t: 'ack';
  target: string;
  ok: boolean;
  reason?: string;
}

export interface DesyncMessage {
  t: 'desync';
  region: number;
  serverHash: number;
  clientHash: number;
}

export interface ErrorMessage {
  t: 'error';
  reason: string;
}

export type ServerMessage =
  | WelcomeMessage | TurnMessage | AckMessage | DesyncMessage | ErrorMessage;

// --- parsing ----------------------------------------------------------------

/**
 * Decode a message from a client.
 *
 * Everything arriving here is untrusted. Returning null rather than throwing
 * keeps a malformed message from a single client out of the server's turn loop,
 * which is a shared resource -- one bad frame must not stop the world.
 */
export function parseClientMessage(raw: string): ClientMessage | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const m = value as Record<string, unknown>;

  switch (m.t) {
    case 'hello':
      if (typeof m.name !== 'string' || typeof m.version !== 'number') return null;
      // Names are shown to other players, so bound the length here rather than
      // trusting a client not to send a megabyte of it.
      return { t: 'hello', version: m.version, name: m.name.slice(0, 32) };

    case 'order': {
      if (typeof m.target !== 'string') return null;
      if (m.action !== 'claim' && m.action !== 'settle' && m.action !== 'abandon') return null;
      const amount = typeof m.amount === 'number' && Number.isFinite(m.amount)
        ? Math.max(0, Math.floor(m.amount))
        : undefined;
      return { t: 'order', target: m.target.slice(0, 64), action: m.action, amount };
    }

    case 'hash':
      if (typeof m.region !== 'number' || typeof m.hash !== 'number') return null;
      return { t: 'hash', region: m.region | 0, hash: m.hash >>> 0 };

    default:
      return null;
  }
}

export function encode(msg: ServerMessage): string {
  return JSON.stringify(msg);
}
