// The House: a lineage, and the branching process Galton built to explain why
// they die out.
//
// The demography in hearths.ts is bucket flow -- children, hands and elders as
// fractional counts, no dice, no named people -- because a village is a crowd
// and a crowd averages out. A ruling house is the opposite of a crowd. It is
// one man whose single death decides who rules, and whether his line has a boy
// of the blood left to take the seat is a coin, not an average: a fifth of a
// son is no heir at all. So this is the one model in the simulation that deals
// in named individuals and in coins.
//
// The coins are the project's quantised hash (gen/noise.ts, uniformAt's
// sibling), which is uniform at every probability there is -- so it can deliver
// the rare event a death roll needs, and it is as deterministic as the terrain:
// the same seed kills the same lord in the same year on any machine that runs
// JavaScript. No RNG state crosses a turn.
//
// THE MEASURED CLAIM. Noble houses went extinct in the male line at a rate that
// reads as a paradox beside their fertility: large families, and yet most
// direct male lines failed within a few centuries. Galton and Watson posed this
// exact question in 1874 -- "On the probability of the extinction of families"
// -- about the vanishing of aristocratic surnames, and the answer is that a
// male line is a branching process sitting near criticality. Each lord leaves,
// on average, about ONE son who lives to take the seat; a branching process
// whose mean is one dies out with probability one, only slowly. Nothing in this
// file sets an extinction rate. It falls out of the fertility and the life
// table hearths.ts already measures, run forward -- see verify_house.ts, where
// the rate is read off the model rather than asserted into it.
//
// WHAT IS DERIVED AND WHAT IS A STAND-IN. The birth of a son and the death of
// any member are coins at hearths.ts's measured rates; this file reads those
// rates and invents none. The STAND-IN, labelled, is that a House holds ONE
// seat, so only its reigning lord fathers heirs -- younger sons and brothers
// can inherit but found no line of their own until a cadet branch is endowed
// with its own ground, which is the next increment. That makes this the strict
// single-title primogeniture regime, the one that drove the historical
// extinctions, and it errs toward houses dying sooner than a great dynasty with
// many landed cadet branches would.

import {
  CHILD_MORTALITY, HAND_MORTALITY, ELDER_MORTALITY,
  BIRTHS_PER_MARRIED_WOMAN_YEAR, CHILD_YEARS, HAND_YEARS,
} from './hearths.ts';
import { hash3 } from '../gen/noise.ts';

/**
 * When a male of the line can inherit, bear arms, and -- if he holds the seat
 * -- marry and father heirs: the same fifteen at which the demography's child
 * becomes a hand. A lord younger than this reigns under a regent; he does not
 * father children until he reaches it. Sixty is where the hand becomes an
 * elder, and the lord's household stops bearing.
 */
export const ADULT_AGE = CHILD_YEARS;
export const ELDER_AGE = CHILD_YEARS + HAND_YEARS;

/**
 * The rate at which a reigning lord's household gives him a son, per year.
 *
 * Not a number of this file's own: it is the married woman's birth rate the
 * demography prices from completed family sizes, halved because half of births
 * are sons and only sons carry the seat. A lord is married by definition -- he
 * holds the seat -- and the nobility remarried on widowhood, so his household
 * bears across his whole adult reign at the village married rate. Daughters are
 * not tracked here; they carried alliances, not the male line, and alliances
 * are a later concern.
 */
export const SONS_PER_LORD_YEAR = BIRTHS_PER_MARRIED_WOMAN_YEAR * 0.5;

/** The purposes a coin is drawn for, so births and deaths never share one. */
const COIN_BIRTH = 1;
const COIN_DEATH = 2;
const COIN_NAME = 3;

/**
 * A member of the male line, living.
 *
 * `rank` is the immutable place in the line of succession: the founder is [0],
 * and a lord's k-th son ever born is [...lord.rank, k]. Because k counts every
 * son the lord has fathered -- dead ones included, through `sons` below -- a
 * younger brother's rank never shifts when an elder brother dies, which is what
 * keeps primogeniture stable without retaining the dead. Compared
 * lexicographically, the smallest living rank is the rightful lord, and the
 * ordering is male-preference primogeniture with representation for free: a
 * dead heir's own son outranks the dead heir's younger brother.
 */
export interface Person {
  id: number;
  bornYear: number;
  /** Sons fathered so far, to index the next one's rank. */
  sons: number;
  /** Path of birth-indices from the founder; the line of succession. */
  rank: number[];
}

/** A dynasty: the living males of one male line, and who among them rules. */
export interface House {
  id: number;
  /** The coin seed for this house, from its id and the world seed. */
  salt: number;
  foundedYear: number;
  members: Person[];
  /** The reigning lord's id, or -1 when the line is extinct. */
  lordId: number;
  /** The year the current lord succeeded, for reign lengths. */
  lordSinceYear: number;
  /** The next person id to hand out. */
  nextId: number;
  /** When the male line failed, or null while it holds. */
  extinctYear: number | null;
}

/** What one year did to a house. */
export interface HouseYear {
  /** A son born to the lord this year, or null. */
  bornId: number | null;
  /** Members who died this year. */
  died: number[];
  /** True if the reigning lord was among the dead. */
  lordDied: boolean;
  /** The new lord's id when succession happened this year, else null. */
  succeeded: number | null;
  /** True if the line went extinct this year. */
  extinct: boolean;
}

/** A uniform coin in [0, 1) for a (person, year, purpose) under a house salt. */
function coin(salt: number, year: number, person: number, purpose: number): number {
  // hash3 folds its first three integer arguments under the seed; year and id
  // are small integers and purpose separates a birth roll from a death roll so
  // the two never read the same bit. /2^32 is the uniform the hash guarantees.
  return (hash3(year, person * 8 + purpose, 0, salt) >>> 0) / 4294967296;
}

/** The yearly death probability of a member of this age, from the life table. */
export function mortalityAt(age: number): number {
  if (age < ADULT_AGE) return CHILD_MORTALITY;
  if (age < ELDER_AGE) return HAND_MORTALITY;
  return ELDER_MORTALITY;
}

/** Lexicographic order on ranks: smaller is more senior in the succession. */
function rankLess(a: number[], b: number[]): boolean {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] !== b[i]) return a[i] < b[i];
  }
  return a.length < b.length;
}

/** The rightful lord among the living: the most senior by primogeniture. */
function seniorLiving(members: readonly Person[]): Person | null {
  let best: Person | null = null;
  for (const p of members) {
    if (best === null || rankLess(p.rank, best.rank)) best = p;
  }
  return best;
}

/**
 * The living males in the order they would inherit -- the reigning lord first,
 * then the heir, then the rest of the line. This is male-preference
 * primogeniture with representation: a dead heir's son stands in his father's
 * place, ahead of the father's younger brothers, because his rank carries his
 * father's. The heir presumptive is the second entry, when there is one.
 */
export function successionLine(house: House): number[] {
  return [...house.members]
    .sort((a, b) => (rankLess(a.rank, b.rank) ? -1 : rankLess(b.rank, a.rank) ? 1 : 0))
    .map((p) => p.id);
}

/**
 * Found a house with a single living founder already of an age to rule.
 *
 * The salt is mixed from the house id and the world seed so two houses born in
 * the same year live different lives, and so the same world replays identically.
 */
export function foundHouse(
  id: number, worldSeed: number, foundedYear: number, founderAge: number,
): House {
  const salt = hash3(id, 0, 0, worldSeed) >>> 0;
  const founder: Person = {
    id: 0,
    bornYear: foundedYear - Math.round(founderAge),
    sons: 0,
    rank: [0],
  };
  return {
    id,
    salt,
    foundedYear,
    members: [founder],
    lordId: 0,
    lordSinceYear: foundedYear,
    nextId: 1,
    extinctYear: null,
  };
}

/**
 * Live one year: the lord may father a son, every member faces the life table,
 * and if the lord falls the seat passes to the senior survivor -- or, if there
 * is none, the line is extinct.
 *
 * Mutates the house in place (it is a bounded, per-house record the caller
 * owns) and returns what happened, for the chronicle.
 */
export function houseYear(house: House, year: number): HouseYear {
  const out: HouseYear = {
    bornId: null, died: [], lordDied: false, succeeded: null, extinct: false,
  };
  if (house.extinctYear !== null) return out;

  // BIRTHS. Only the reigning lord fathers heirs (the single seat), and only
  // while he is of age and not past the household's bearing years.
  const lord = house.members.find((p) => p.id === house.lordId) ?? null;
  if (lord !== null) {
    const lordAge = year - lord.bornYear;
    if (lordAge >= ADULT_AGE && lordAge < ELDER_AGE
        && coin(house.salt, year, lord.id, COIN_BIRTH) < SONS_PER_LORD_YEAR) {
      const son: Person = {
        id: house.nextId,
        bornYear: year,
        sons: 0,
        rank: [...lord.rank, lord.sons],
      };
      lord.sons++;
      house.nextId++;
      house.members.push(son);
      out.bornId = son.id;
    }
  }

  // DEATHS. Each living member against the mortality of his age.
  const survivors: Person[] = [];
  for (const p of house.members) {
    const age = year - p.bornYear;
    if (coin(house.salt, year, p.id, COIN_DEATH) < mortalityAt(age)) {
      out.died.push(p.id);
      if (p.id === house.lordId) out.lordDied = true;
    } else {
      survivors.push(p);
    }
  }
  house.members = survivors;

  // SUCCESSION. If the seat fell vacant, the senior living male takes it; if
  // none lives, the male line is extinct this year.
  if (out.lordDied) {
    const heir = seniorLiving(house.members);
    if (heir === null) {
      house.lordId = -1;
      house.extinctYear = year;
      out.extinct = true;
    } else {
      house.lordId = heir.id;
      house.lordSinceYear = year;
      out.succeeded = heir.id;
    }
  }
  return out;
}

/** Age of the reigning lord in years, or null if the line is extinct. */
export function lordAge(house: House, year: number): number | null {
  const lord = house.members.find((p) => p.id === house.lordId);
  return lord === undefined ? null : year - lord.bornYear;
}

/** How many of the blood are alive: the lord and those who could inherit. */
export function livingMembers(house: House): number {
  return house.members.length;
}

/**
 * Given names, a small fixed set so a lord's name is stable for the life of a
 * world. Indexed by a coin on the person's id, like the polity's place-names --
 * a grammar would invite someone to improve it and rename every king.
 */
const GIVEN_NAMES: readonly string[] = [
  'Aelfred', 'Baldric', 'Cnut', 'Drogo', 'Edmund', 'Fulk', 'Godwin', 'Harald',
  'Ivar', 'Leofric', 'Morcar', 'Osric', 'Penda', 'Raedwald', 'Sigurd', 'Torht',
  'Ulfric', 'Wulfstan', 'Aethelstan', 'Beorn', 'Ceadda', 'Eadric', 'Hereward',
  'Offa',
];

/** The given name of a person in a house -- stable for the world's life. */
export function personName(house: House, personId: number): string {
  const i = Math.floor(coin(house.salt, 0, personId, COIN_NAME) * GIVEN_NAMES.length);
  return GIVEN_NAMES[Math.min(GIVEN_NAMES.length - 1, i)];
}

/** The reigning lord's name, or null if the line is extinct. */
export function lordName(house: House): string | null {
  return house.lordId < 0 ? null : personName(house, house.lordId);
}
