// The real-time battle, derived and not yet wired to anything.
//
// NOTHING IMPORTS THIS FILE. That is the point of it existing separately, and
// it is a statement to check rather than trust: `grep -rn "derive_battle"` over
// the tree should find this file, verify_derive.ts counting its free
// parameters, and nothing else.
//
// WHY IT WAS SPLIT OUT
//
// These twenty-six numbers were solved for a game with a 32 Hz tick, where a
// charging warhorse had to be stopped before it crossed the width of the man in
// front of it. The game that exists is a two-minute turn on a hex planet. None
// of this is read, and while it lived in derive.ts that file's first line --
// "every number the game runs on" -- vouched for it.
//
// Deleting it was the other option and it is the worse one. Every value here is
// solved from a measured anchor the same way the live ones are: a hauberk
// weighs what a hauberk weighs, a chronographed arrow flies at the speed it was
// clocked at, a gallop is a gallop. The derivation is not what went stale --
// the game around it changed. When a combat model lands, this is the file it
// starts from, and the reasoning in these comments is the part that would have
// been expensive to lose.
//
// ONE NUMBER HERE IS KNOWN TO BE WRONG FOR THE GAME THAT EXISTS, and it is
// worth naming rather than leaving to be rediscovered. TICK_HZ is solved from
// the collision requirement of a real-time charge. A turn-based battle resolved
// once per two minutes has no such requirement, so whoever wires this up should
// expect to re-derive the tick from what the new model actually has to notice,
// not to inherit 32 Hz because it is sitting here.
//
// FREE PARAMETERS 3, 4 and 5 are below. The numbering runs across this file and
// derive.ts together, because five free parameters is a property of the
// derivation layer and not of either half of it.

import { fromFloat, SCALE } from './fixed.ts';
import * as A from './anchors.ts';
import {
  loadFactor, INFANTRY_LOAD_FACTOR, INFANTRY_MARCH_MS, SOLDIER_GRAIN_KG_PER_DAY,
} from './derive.ts';

// ---------------------------------------------------------------------------
// The stat curve
// ---------------------------------------------------------------------------

/**
 * A capability at a given stat, interpolated between three anchored points:
 * stat 1 is the floor of still being able to do the thing, stat 10 is an
 * average adult, stat 20 is the human record.
 *
 * Piecewise linear rather than smooth because a smooth curve would need a
 * shape parameter, and there is nothing to measure that would settle it.
 */
export function statCurve(stat: number, floor: number, average: number, record: number): number {
  const s = stat < A.STAT_FLOOR ? A.STAT_FLOOR : stat > A.STAT_RECORD ? A.STAT_RECORD : stat;
  if (s <= A.STAT_AVERAGE) {
    const t = (s - A.STAT_FLOOR) / (A.STAT_AVERAGE - A.STAT_FLOOR);
    return floor + (average - floor) * t;
  }
  const t = (s - A.STAT_AVERAGE) / (A.STAT_RECORD - A.STAT_AVERAGE);
  return average + (record - average) * t;
}

/**
 * The stat-1 floor as a fraction of the stat-10 average.
 *
 * Measured for gait and only for gait: 0.6 m/s is the clinical threshold for
 * losing community ambulation, against a 1.40 m/s preferred speed. Applying
 * the same ratio to sprinting, to draw weight, to anything else, is an
 * ASSUMPTION -- it says the distance from "barely functioning" to "average" is
 * proportionally similar across physical capabilities. It is stated here once
 * rather than hidden in each call site so that it can be attacked in one place.
 */
export const FLOOR_FRACTION = A.WALK_FRAIL_THRESHOLD / A.WALK_PREFERRED;

/** Convenience: a curve pinned only at average and record, floor implied. */
function curve(stat: number, average: number, record: number): number {
  return statCurve(stat, average * FLOOR_FRACTION, average, record);
}

/** The mounted man plus what he wears, kg. His pack rides on the horse. */
export const RIDER_MASS =
  A.BODY_MASS + A.MAIL_HAUBERK + A.HELM + A.SHIELD + A.ARMS;

export const HORSE_LOAD_FACTOR = loadFactor(A.HORSE_MASS, RIDER_MASS);

// ---------------------------------------------------------------------------
// FREE PARAMETER 3: the warhorse's place on the gallop curve
// ---------------------------------------------------------------------------
/**
 * A destrier is not a thoroughbred and not a hack. Putting it at stat 13 says
 * it is meaningfully better than an ordinary riding horse and nowhere near a
 * sprint-bred racehorse. Nothing measures where on that line a medieval
 * warhorse sat; the skeletal record gives size, not speed.
 */
export const WARHORSE_STAT = 13;

/** A charge: all-out, loaded, held for SPRINT_DURATION and then spent. */
export const INFANTRY_CHARGE_MS =
  curve(A.STAT_AVERAGE, A.SPRINT_AVERAGE, A.SPRINT_RECORD) * INFANTRY_LOAD_FACTOR;

/** Distance a charge covers before the men in it are blown. */
export const CHARGE_RANGE_M = INFANTRY_CHARGE_MS * A.SPRINT_DURATION;

/** Mounted gaits, all under the weight of an armoured man. */
export const CAVALRY_WALK_MS = A.HORSE_WALK * HORSE_LOAD_FACTOR;
export const CAVALRY_TROT_MS = A.HORSE_TROT * HORSE_LOAD_FACTOR;
export const CAVALRY_CANTER_MS = A.HORSE_CANTER * HORSE_LOAD_FACTOR;
export const CAVALRY_CHARGE_MS =
  curve(WARHORSE_STAT, A.HORSE_GALLOP_AVERAGE, A.HORSE_GALLOP_RECORD) * HORSE_LOAD_FACTOR;

/** A day's march: eight hours at the column pace. Not used by the tick loop;
 *  kept because it is the number that tells you whether the rest is sane. */
export const DAY_MARCH_M = INFANTRY_MARCH_MS * 8 * 3600;

// ---------------------------------------------------------------------------
// The tick rate, solved rather than picked
// ---------------------------------------------------------------------------

/**
 * A tick must be short enough that the fastest thing in the game cannot cross
 * the smallest thing it has to notice. The fastest thing is a charging
 * warhorse; the smallest is the width of the man it is about to ride down.
 *
 * That gives a floor of CAVALRY_CHARGE_MS / SHOULDER_WIDTH ticks per second.
 * Round up to a power of two so that a tick is an exact binary fraction of a
 * second and the turn boundaries below land on integers.
 */
export const TICK_FLOOR_HZ = CAVALRY_CHARGE_MS / A.SHOULDER_WIDTH;
export const TICK_HZ = nextPowerOfTwo(TICK_FLOOR_HZ);
export const TICK_SECONDS = 1 / TICK_HZ;

function nextPowerOfTwo(v: number): number {
  let p = 1;
  while (p < v) p *= 2;
  return p;
}

/**
 * Speed as fixed-point units of distance per *second*, not per tick.
 *
 * Per-tick would be the obvious form and it is the wrong one. At 32 Hz a
 * marching man covers 116.4 fixed units per tick; rounding that to 116 makes
 * him 0.34% slow, and because the same rounded step is added every tick the
 * error does not cancel -- it accumulates to 89 m over a day's march, and to a
 * visibly late arrival over a battlefield.
 *
 * Storing per-second and integrating with a remainder (see step.ts) makes the
 * motion exact rational arithmetic instead: 32 ticks of a 3724-per-second
 * speed advance exactly 3724 units, with the leftover carried rather than
 * discarded. It costs one integer per unit per axis and removes the drift
 * entirely rather than shrinking it.
 */
export function perSecond(metresPerSecond: number): number {
  return Math.round(metresPerSecond * SCALE);
}

/** Duration in ticks, rounded up so nothing ever completes early. */
export function ticks(seconds: number): number {
  return Math.ceil(seconds * TICK_HZ);
}

/**
 * Ballistic range at the optimal 45 degrees, m: v^2 / g in a vacuum, which is
 * a ceiling rather than a range anyone shot at. Drag takes a real heavy war
 * arrow well below it. Aimed range -- the distance at which a man can expect
 * to hit a man -- is a different derivation and is not done yet; see
 * docs/known-gaps.md.
 */
export const ARROW_MAX_RANGE_M = A.WAR_ARROW_SPEED ** 2 / A.GRAVITY;
export const BOLT_MAX_RANGE_M = A.BOLT_SPEED ** 2 / A.GRAVITY;

/** Time of flight to maximum range, s, and the same in ticks. */
// Math.sqrt is IEEE-pinned; Math.SQRT1_2 is only "implementation-approximated"
// by the spec, so it is computed rather than read even here at authoring time.
export const ARROW_MAX_FLIGHT_S =
  (2 * A.WAR_ARROW_SPEED * Math.sqrt(0.5)) / A.GRAVITY;

/** Seconds between aimed shots. */
export const ARCHER_RELOAD_S = 60 / A.ARCHER_RATE_PER_MIN;

/** Dry forage a horse eats per day, kg. */
export const HORSE_FORAGE_KG_PER_DAY = A.HORSE_MASS * A.HORSE_FORAGE_FRACTION;

/** Water, litres per day. */
export const SOLDIER_WATER_L_PER_DAY = A.MAN_WATER_PER_DAY;
export const HORSE_WATER_L_PER_DAY = A.HORSE_WATER_PER_DAY;

// ---------------------------------------------------------------------------
// FREE PARAMETER 4: formation spacing
// ---------------------------------------------------------------------------
/**
 * How much room a man needs beyond his own shoulders to march without
 * treading on the man beside him. A close-order shield wall is shoulder to
 * shoulder and cannot be less; an open order is roughly double. 1.25 shoulder
 * widths is ours, for the ordinary line: tight enough to lock shields,
 * loose enough to walk.
 */
export const FORMATION_PITCH_FACTOR = 1.25;

export const FORMATION_PITCH_M = A.SHOULDER_WIDTH * FORMATION_PITCH_FACTOR;

/** Body radius for collision, m: half a shoulder width. */
export const BODY_RADIUS_M = A.SHOULDER_WIDTH / 2;

// ---------------------------------------------------------------------------
// FREE PARAMETER 5: how fast a man turns on the spot
// ---------------------------------------------------------------------------
/**
 * A standing man can spin about as fast as he likes; a man in a formation
 * turns at the pace of the formation, and a man at a walk turns as tightly as
 * his own stride allows. One full turn per second at a standstill is ours --
 * it is not far off what a person does and nobody has measured it under load.
 */
export const TURN_RATE_TURNS_PER_SEC = 1.0;

// ---------------------------------------------------------------------------
// The frozen integer form: this is what the simulation reads
// ---------------------------------------------------------------------------

export const SIM = Object.freeze({
  tickHz: TICK_HZ,

  /** Distance per second, fixed-point. step.ts divides by tickHz with carry. */
  infantryMarch: perSecond(INFANTRY_MARCH_MS),
  infantryCharge: perSecond(INFANTRY_CHARGE_MS),
  cavalryWalk: perSecond(CAVALRY_WALK_MS),
  cavalryTrot: perSecond(CAVALRY_TROT_MS),
  cavalryCanter: perSecond(CAVALRY_CANTER_MS),
  cavalryCharge: perSecond(CAVALRY_CHARGE_MS),
  arrowSpeed: perSecond(A.WAR_ARROW_SPEED),
  boltSpeed: perSecond(A.BOLT_SPEED),

  /** Angle units per second. */
  turnRate: Math.round(TURN_RATE_TURNS_PER_SEC * 1024),

  /** Distances, fixed-point. */
  bodyRadius: fromFloat(BODY_RADIUS_M),
  formationPitch: fromFloat(FORMATION_PITCH_M),
  arrowMaxRange: fromFloat(ARROW_MAX_RANGE_M),
  boltMaxRange: fromFloat(BOLT_MAX_RANGE_M),
  chargeRange: fromFloat(CHARGE_RANGE_M),

  /** Durations, in ticks. */
  archerReload: ticks(ARCHER_RELOAD_S),
  chargeDuration: ticks(A.SPRINT_DURATION),

  /** Consumption per day, in grams and centilitres, so they stay integers. */
  soldierGrainG: Math.round(SOLDIER_GRAIN_KG_PER_DAY * 1000),
  horseForageG: Math.round(HORSE_FORAGE_KG_PER_DAY * 1000),
  soldierWaterCl: Math.round(SOLDIER_WATER_L_PER_DAY * 100),
  horseWaterCl: Math.round(HORSE_WATER_L_PER_DAY * 100),
});

export type SimConstants = typeof SIM;

