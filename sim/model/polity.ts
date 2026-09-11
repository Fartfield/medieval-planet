// Kingdoms, which nobody designs.
//
// A polity here is barely a thing at all: an id, a name, a capital and a
// colour. It has no rules of its own, no government, no policy. Everything a
// player would call politics is going to fall out of two facts that already
// exist -- settlements spread when they have more hands than work, and they
// stop when they run into somebody else.
//
// WHY KINGDOMS HAVE A SIZE
//
// The one property a polity does have is a reach, and it is derived rather
// than chosen. A feudal levy owed forty days of service in the year. An army
// has to march out, do something, and march back inside that, so at a column's
// pace of 0.91 m/s over an eight-hour marching day, and giving three eighths
// of the forty days to each leg, the radius of effective authority is about
// 350 km.
//
// That is not a game balance number. It is what forty days and a walking pace
// multiply out to, and it is why medieval kingdoms were the size they were --
// why the Angevin empire was a strain and Wessex was not, why a rebellion four
// hundred miles from the capital usually won. A settlement founded beyond it
// cannot be held, so it stops being yours.

import * as A from '../anchors.ts';
import { INFANTRY_MARCH_MS } from '../derive.ts';
import { foundHouse, type House } from './house.ts';

export interface Polity {
  id: number;
  name: string;
  /** Address key of the seat. Reach is measured from here. */
  capital: string;
  /** Colour index. Players and NPC kingdoms share the same wheel. */
  house: number;
  /** A player polity is one somebody is steering. The rest run themselves. */
  player: number | null;
  /** Turn it was founded, for the chronicle. */
  founded: number;
  /** Who it pays tribute to, if anybody. Set by conflict, not by spreading. */
  tributaryTo: number | null;
  /**
   * The ruling dynasty: the male line that holds the seat, its lords succeeding
   * and, when a line fails, a new house rising in its place. See house.ts. The
   * realm (this polity, its name and colour) outlives any one dynasty.
   */
  lineage: House;
}

/**
 * The age at which a founder takes his seat.
 *
 * A FREE PARAMETER, labelled: the demography gives no age for a man come into
 * his own, so this is a judgement -- old enough to have proven himself and hold
 * a following, young enough to sire a line. Thirty is the age a landed man
 * married and established in the record, near enough.
 */
export const FOUNDER_AGE = 30;

/**
 * How far a polity's authority reaches from its capital, in metres.
 *
 * Forty days of service, three eighths of them marching out, at the column
 * pace the supply model derived from what a man can carry and how fast he
 * walks under it. Nothing here was chosen.
 */
export const AUTHORITY_REACH_M =
  A.FEUDAL_SERVICE_DAYS * A.CAMPAIGN_MARCH_SHARE
  * A.MARCH_HOURS_PER_DAY * 3600 * INFANTRY_MARCH_MS;

/** The same, in km, because every human discussion of it is in km. */
export const AUTHORITY_REACH_KM = AUTHORITY_REACH_M / 1000;

/**
 * Names. Not generated from a grammar, because a kingdom's name should be
 * stable for the life of a world and a grammar invites somebody to improve it
 * later and rename everybody's homeland.
 */
const STEMS: readonly string[] = [
  'Aeth', 'Bryn', 'Cael', 'Dun', 'Eorl', 'Fen', 'Gar', 'Hald', 'Ing', 'Jarl',
  'Kel', 'Lind', 'Mar', 'Nor', 'Oss', 'Pel', 'Quen', 'Rath', 'Sel', 'Thorn',
  'Ulf', 'Vald', 'Wyn', 'Yr',
];

const TAILS: readonly string[] = [
  'mark', 'garth', 'holt', 'wold', 'stead', 'thorpe', 'burh', 'ferth',
  'land', 'reach', 'fell', 'mere', 'dale', 'ridge', 'hollow', 'weald',
];

/** A stable name for a polity id. Same id, same name, forever. */
export function nameFor(id: number, seed: number): string {
  // Mixed rather than indexed directly, so that ids 0, 1, 2 do not produce
  // three names beginning with the same letter.
  let h = (id * 0x9e3779b9 + seed) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  const stem = STEMS[h % STEMS.length];
  const tail = TAILS[(h >>> 8) % TAILS.length];
  return stem + tail;
}

export function createPolity(
  id: number,
  capital: string,
  turn: number,
  seed: number,
  player: number | null = null,
): Polity {
  return {
    id,
    name: nameFor(id, seed),
    capital,
    house: id,
    player,
    founded: turn,
    tributaryTo: null,
    lineage: foundHouse(id, seed, Math.floor(turn / A.TURNS_PER_YEAR), FOUNDER_AGE),
  };
}

/** Is this settlement close enough to its capital to be held? */
export function withinReach(distanceM: number): boolean {
  return distanceM <= AUTHORITY_REACH_M;
}
