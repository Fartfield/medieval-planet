// Persistence: a seed, a turn counter, and a log of what changed.
//
// The whole saved state of a world with a trillion tiles is one small JSON
// file and an append-only log of deltas. Nothing else needs saving, because
// nothing else was ever stored -- the terrain is rebuilt from the seed on
// load, identically, which is the promise docs/determinism.md exists to keep.
//
// The log is append-only rather than a rewritten snapshot for the usual
// reason: an append cannot half-succeed in a way that loses what was already
// there. A crash mid-write costs the last line, which the reader discards.

import { appendFileSync, readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { TileDelta } from '../sim/model/tile.ts';

export interface SavedPlayer {
  id: number;
  name: string;
  seat: string | null;
  house: number;
}

export interface WorldMeta {
  seed: number;
  radiusM: number;
  turn: number;
  players: SavedPlayer[];
  createdAt: string;
}

export class Store {
  private readonly metaPath: string;
  private readonly logPath: string;
  private appended = 0;

  private readonly dir: string;

  constructor(dir: string) {
    this.dir = dir;
    mkdirSync(dir, { recursive: true });
    this.metaPath = join(dir, 'world.json');
    this.logPath = join(dir, 'deltas.jsonl');
  }

  get exists(): boolean { return existsSync(this.metaPath); }

  loadMeta(): WorldMeta | null {
    if (!existsSync(this.metaPath)) return null;
    try {
      return JSON.parse(readFileSync(this.metaPath, 'utf8')) as WorldMeta;
    } catch {
      return null;
    }
  }

  saveMeta(meta: WorldMeta): void {
    // Write beside and rename. A rename is atomic on every filesystem this will
    // ever run on, so a crash mid-save leaves the previous world intact rather
    // than a half-written one -- and the meta file is the only thing here that
    // cannot be reconstructed from the log.
    const tmp = `${this.metaPath}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(meta, null, 2)}\n`);
    renameSync(tmp, this.metaPath);
  }

  /**
   * Replay the log. Later lines win, so a tile written many times ends at its
   * last value; a line with no fields is a tombstone and removes the tile.
   *
   * A truncated final line -- the crash case -- fails to parse and is dropped,
   * which is why this does not throw on bad JSON.
   */
  loadDeltas(): TileDelta[] {
    if (!existsSync(this.logPath)) return [];
    const byKey = new Map<string, TileDelta>();
    let dropped = 0;

    for (const line of readFileSync(this.logPath, 'utf8').split('\n')) {
      if (line.length === 0) continue;
      try {
        const d = JSON.parse(line) as TileDelta;
        if (typeof d.key !== 'string') { dropped++; continue; }
        if (isTombstone(d)) byKey.delete(d.key);
        else byKey.set(d.key, d);
      } catch {
        dropped++;
      }
    }
    if (dropped > 0) {
      console.log(`  ${dropped} unreadable line(s) in the delta log, dropped`);
    }
    return [...byKey.values()];
  }

  /** Append this turn's changes. One write, whatever the turn touched. */
  appendDeltas(deltas: TileDelta[]): void {
    if (deltas.length === 0) return;
    appendFileSync(this.logPath, `${deltas.map((d) => JSON.stringify(d)).join('\n')}\n`);
    this.appended += deltas.length;
  }

  /**
   * Rewrite the log as one line per live tile.
   *
   * A tile written every turn for a year is 52 lines of which 51 are dead
   * weight. Compaction is safe to skip and safe to interrupt -- the rename at
   * the end is the only moment anything changes.
   */
  compact(deltas: TileDelta[]): void {
    const tmp = `${this.logPath}.tmp`;
    writeFileSync(tmp, deltas.map((d) => JSON.stringify(d)).join('\n') + (deltas.length ? '\n' : ''));
    renameSync(tmp, this.logPath);
    this.appended = 0;
  }

  get appendsSinceCompaction(): number { return this.appended; }
  get directory(): string { return this.dir; }
}

function isTombstone(d: TileDelta): boolean {
  return d.soilHealth === undefined
    && d.population === undefined
    && d.populationHealth === undefined
    && d.owner === undefined
    && d.depleted === undefined
    && d.cleared === undefined
    && d.grainStock === undefined
    && d.ironStock === undefined
    && d.farmShare === undefined;
}

export { dirname };
