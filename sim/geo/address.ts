// Addressing a tile out of a trillion.
//
// An address is the path taken to reach a cell: which of the 10,242 globe
// cells, then which of the 9,919 cells inside that, and so on for as many
// layers as the world has. `[4821]` is a region, `[4821, 3307]` a realm,
// `[4821, 3307, 9912]` a patch of ground about 28 m across.
//
// The path IS the identity. There is no id table, no allocation, no database
// row that has to exist before a tile does -- which is the only reason a
// trillion of them is possible. Everything about a tile is a pure function of
// its address and the world seed, and the store below holds only the tiles
// somebody changed.

export const LAYER_NAMES = ['region', 'realm', 'ground', 'plot'] as const;
export type LayerName = (typeof LAYER_NAMES)[number];

/** How deep the world goes. Ground is where the game is played; plot is for
 *  building interiors and costs nothing until something is built. */
export const MAX_DEPTH = 4;

export type Address = readonly number[];

export const Layer = {
  Region: 0,
  Realm: 1,
  Ground: 2,
  Plot: 3,
} as const;

export function depthOf(a: Address): number {
  return a.length;
}

export function layerName(a: Address): LayerName {
  return LAYER_NAMES[a.length - 1] ?? 'plot';
}

export function parent(a: Address): Address {
  return a.slice(0, -1);
}

export function child(a: Address, index: number): Address {
  return [...a, index];
}

export function equals(a: Address, b: Address): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * The storage key: base-36 components joined by dots, e.g. "3o9.2j7.7lg".
 *
 * A string rather than a packed integer, because the packed form runs out.
 * Region and realm indices need 14 bits each, so a ground address is 42 bits
 * and fits a JS safe integer -- but a plot address is 56 and does not, and
 * discovering that at the layer where buildings live would be a bad afternoon.
 * Base 36 keeps a ground key to eleven characters, which is small enough that
 * a million dirty tiles is eleven megabytes of key.
 */
export function toKey(a: Address): string {
  let s = '';
  for (let i = 0; i < a.length; i++) {
    if (i > 0) s += '.';
    s += a[i].toString(36);
  }
  return s;
}

export function fromKey(key: string): Address {
  if (key === '') return [];
  const parts = key.split('.');
  const out = new Array<number>(parts.length);
  for (let i = 0; i < parts.length; i++) {
    const v = parseInt(parts[i], 36);
    if (!Number.isInteger(v) || v < 0) throw new Error(`bad address key: ${key}`);
    out[i] = v;
  }
  return out;
}

/**
 * A 32-bit seed unique to this address, derived from the world seed.
 *
 * Every generator draws from this rather than from a shared stream, which is
 * what makes generation order-independent: a tile produces the same rock
 * whether it is the first thing a player looks at or the ten-millionth. A
 * single global stream would make the world depend on browsing history.
 */
export function addressSeed(worldSeed: number, a: Address, salt: number): number {
  let h = (worldSeed ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ salt, 0x85ebca6b) >>> 0;
  for (let i = 0; i < a.length; i++) {
    h = Math.imul(h ^ (a[i] + 0x9e3779b9 + (i << 6)), 0xc2b2ae35) >>> 0;
    h = (h ^ (h >>> 13)) >>> 0;
  }
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  return (h ^ (h >>> 13)) >>> 0;
}

/**
 * Salts, so that two different questions about the same address draw from
 * different streams. Named rather than written inline because a stray digit in
 * a hex literal is silent -- it just produces a different world.
 */
export const SALT = {
  submap: 0x5b1,
  ore: 0x02e,
  settlement: 0x53e,
} as const;

/** How many cells a layer holds, for bounds checks and for the UI. */
export function capacityAt(depth: number, regionCount: number, subCount: number): number {
  return depth === 0 ? regionCount : subCount;
}

/** Total cells at a depth, as an exact-ish figure for display. */
export function totalAt(depth: number, regionCount: number, subCount: number): number {
  return regionCount * subCount ** depth;
}
