// The people, as hearths: who is a child, who is a hand, who is old.
//
// (Named HEARTHS and not households because household.ts already exists: a
// parallel session built the household's PHYSICS -- its ration, its fire,
// its larder, its tithe -- the day before this file brought the demography.
// One is what a hearth consumes; this is who sits at it. The two meet in
// the economy and neither owns the other's name.)
//
// The population has been one number since the first settlement -- a blob
// that grew by a rate -- and every labour figure in the economy has divided
// it by two and called half of it workers. This replaces the blob with the
// thing a village actually was: HOUSEHOLDS, each holding children, hands and
// elders as the same fractional, deterministic counts everything else here
// runs on. No dice, no named individuals: bucket flows, in the style the
// whole simulation already speaks.
//
// THE RATES ARE THE MEDIEVAL RECORD'S. Skeletal series and the earliest
// parish registers agree on the shape: a third of children dead before
// fifteen, an adult plateau near one per cent a year, and a cliff past
// sixty. Births come from the hands through three measured factors -- half
// the hands are women, most village women married where land allowed, and a
// married woman bore at a rate the completed-family sizes pin down. Nothing
// here is a growth rate; growth is what happens when the born outnumber the
// dead, and in a good century they did, slowly.
//
// WHY THE FAMINE ECHO IS NOW GENERATIONAL. Hunger multiplies every
// mortality, and the children carry the worst of it -- so a bad year does
// not just kill: it thins a cohort, and fifteen years later the plough
// teams feel the missing hands. That is the shape of every real demographic
// crisis in the record, and no single-number population can express it.

import { WEEKS_PER_YEAR } from './season.ts';

/** One hearth: children not yet of work, working hands, and the old. */
export interface Hearth {
  /** Under fifteen. */
  c: number;
  /** Fifteen to sixty: the hands. */
  h: number;
  /** Past sixty. */
  e: number;
}

/**
 * The mortality of each age, per year, in ordinary times.
 *
 * Measured: about a third of the born were dead by fifteen, which over
 * fifteen bucket-years is near 3.5% a year (the true curve front-loads
 * infancy; a bucket flattens it, and the flattening is the price of not
 * keeping a roster). Adults sat near 1.2%. Past sixty the record thins to
 * about a decade of expectation, which is 8% a year.
 */
export const CHILD_MORTALITY = 0.035;
export const HAND_MORTALITY = 0.012;
export const ELDER_MORTALITY = 0.08;

/**
 * Births per hand per year, from three measured factors: half the hands are
 * women; village marriage where land allowed ran to four in five; and a
 * married woman's completed family -- five to six births across a fertile
 * span inside a working life of forty-five years -- prices her yearly rate
 * near 0.18. The product is a crude birth rate in the high thirties per
 * thousand, which is where every stable medieval series sits.
 */
export const WOMEN_SHARE = 0.5;
export const MARRIED_SHARE = 0.8;
export const BIRTHS_PER_MARRIED_WOMAN_YEAR = 0.18;
export const BIRTHS_PER_HAND_YEAR =
  WOMEN_SHARE * MARRIED_SHARE * BIRTHS_PER_MARRIED_WOMAN_YEAR;

/** Fifteen years a child, forty-five a hand: the aging flows. */
export const CHILD_YEARS = 15;
export const HAND_YEARS = 45;

/**
 * What a pair of hands that are not adult hands is worth in the field.
 *
 * Children herded, gleaned, scared crows and minded from seven -- call the
 * bucket a sixth of a hand across its span. Elders spun, minded and judged:
 * a quarter. Both are the ordinary observations of every account of village
 * work, and both are the reason a village was never only its adults.
 */
export const CHILD_HANDS = 0.15;
export const ELDER_HANDS = 0.25;

/** The village's working strength, in adult-hand equivalents. */
export function effectiveHands(hh: readonly Hearth[]): number {
  let hands = 0;
  for (const x of hh) hands += x.h + CHILD_HANDS * x.c + ELDER_HANDS * x.e;
  return hands;
}

/**
 * Effective hands per head at the stable pyramid -- the dependency ratio a
 * settled village sits at, computed once from the fixed point.
 *
 * This is the REFERENCE the economy's labour was always implicitly calibrated
 * to: every holding size, task rate and specialisation figure was fitted with
 * a village assumed to be at its settled age structure. Dividing a village's
 * own hands-per-head by this makes the labour factor exactly one for such a
 * village -- so nothing an established settlement does changes -- and lets the
 * ratio bite only where the pyramid is genuinely skewed: a founding thick with
 * small children, a village hollowed of hands by an old famine.
 */
let stableHandsCache = 0;
export function stableHandsPerPerson(): number {
  if (stableHandsCache === 0) {
    const sh = stableShares();
    stableHandsCache = sh.h + CHILD_HANDS * sh.c + ELDER_HANDS * sh.e;
  }
  return stableHandsCache;
}

/**
 * How this village's working strength compares to a settled one's, per head.
 *
 * One at the stable pyramid, above it for a labour-rich founding of young
 * families, below it for a village heavy with children or elders. The economy
 * multiplies its population-derived labour by this and nothing else changes
 * for the settled case.
 */
export function labourFactor(hh: readonly Hearth[]): number {
  const pop = populationOf(hh);
  if (pop <= 0) return 1;
  return (effectiveHands(hh) / pop) / stableHandsPerPerson();
}

export function populationOf(hh: readonly Hearth[]): number {
  let n = 0;
  for (const x of hh) n += x.c + x.h + x.e;
  return n;
}

/**
 * THE STABLE PYRAMID: the age structure these rates settle into, found by
 * running them rather than assumed. Cached after the first call, because it
 * is a fixed point of the model and every established settlement synthesises
 * from it.
 */
let stableCache: { c: number; h: number; e: number } | null = null;

export function stableShares(): { c: number; h: number; e: number } {
  if (stableCache !== null) return stableCache;
  let c = 0.3;
  let h = 0.55;
  let e = 0.15;
  for (let y = 0; y < 400; y++) {
    const births = h * BIRTHS_PER_HAND_YEAR;
    const cToH = c / CHILD_YEARS;
    const hToE = h / HAND_YEARS;
    c += births - cToH - c * CHILD_MORTALITY;
    h += cToH - hToE - h * HAND_MORTALITY;
    e += hToE - e * ELDER_MORTALITY;
    const n = c + h + e;
    c /= n;
    h /= n;
    e /= n;
  }
  stableCache = { c, h, e };
  return stableCache;
}

/**
 * A settlement's hearths, synthesised from a bare population count.
 *
 * The ESTABLISHED convention again: a settlement seeded without a roster has
 * been there for generations, so its people stand in the stable pyramid,
 * five to a hearth. A founding party is younger than that -- working
 * families with their children and almost nobody old -- and gets its own
 * shape, which is why a new village booms and then, forty years on, faces
 * its first real crop of elders together.
 */
export function synthesiseHearths(
  population: number, founding = false,
): Hearth[] {
  if (population <= 0) return [];
  const shape = founding
    ? { c: 0.35, h: 0.60, e: 0.05 }
    : stableShares();
  const hearths = Math.max(1, Math.round(population / 5));
  const per = population / hearths;
  const out: Hearth[] = [];
  for (let i = 0; i < hearths; i++) {
    out.push({
      c: Math.round(per * shape.c * 1000) / 1000,
      h: Math.round(per * shape.h * 1000) / 1000,
      e: Math.round(per * shape.e * 1000) / 1000,
    });
  }
  return out;
}

/** What one week of living did. */
export interface DemographyWeek {
  hearths: Hearth[];
  born: number;
  died: number;
}

/**
 * One week of births, deaths and aging across the hearths.
 *
 * The economy hands in its two dials, both inherited from the blob it
 * replaces so the calibrated behaviour carries over. `birthBoost` is the
 * health-and-surplus multiplier -- demographically it IS early marriage,
 * which is exactly what land surplus bought -- capped historically at the
 * colonial-America ceiling upstream. `hungerDeathsWeek` is the absolute
 * starvation toll the ration implies this week, and the hearths distribute
 * it the way the burial registers say: the children carry half again the
 * adults' share, which is what makes a famine echo for a generation.
 */
export function hearthsWeek(
  hh: readonly Hearth[], birthBoost: number, hungerDeathsWeek: number,
  marriage = 1,
): DemographyWeek {
  const W = WEEKS_PER_YEAR;
  const total = populationOf(hh);
  // Distribute the hunger toll: weight children 1.5, hands 1, elders 1.25.
  const weightSum = hh.reduce(
    (a, x) => a + 1.5 * x.c + x.h + 1.25 * x.e, 0);
  const toll = Math.max(0, Math.min(hungerDeathsWeek, total * 0.5));
  let born = 0;
  let died = 0;
  const out: Hearth[] = [];
  for (const x of hh) {
    const births =
      (x.h * BIRTHS_PER_HAND_YEAR * Math.max(0, birthBoost) * Math.max(0, marriage)) / W;
    const cDie = (x.c * CHILD_MORTALITY) / W
      + (weightSum > 0 ? (toll * 1.5 * x.c) / weightSum : 0);
    const hDie = (x.h * HAND_MORTALITY) / W
      + (weightSum > 0 ? (toll * x.h) / weightSum : 0);
    const eDie = (x.e * ELDER_MORTALITY) / W
      + (weightSum > 0 ? (toll * 1.25 * x.e) / weightSum : 0);
    const cGrow = x.c / CHILD_YEARS / W;
    const hAge = x.h / HAND_YEARS / W;
    born += births;
    died += cDie + hDie + eDie;
    out.push({
      c: Math.max(0, x.c + births - cDie - cGrow),
      h: Math.max(0, x.h + cGrow - hDie - hAge),
      e: Math.max(0, x.e + hAge - eDie),
    });
  }
  return { hearths: out, born, died };
}

/**
 * Put people INTO the hearths -- migrants arriving -- as the young families
 * migrants were, spread across the existing hearths.
 */
export function addPeople(hh: readonly Hearth[], count: number): Hearth[] {
  if (count <= 0) return hh.map((x) => ({ ...x }));
  const shape = { c: 0.35, h: 0.60, e: 0.05 };
  const n = Math.max(1, hh.length);
  return hh.map((x) => ({
    c: x.c + (count * shape.c) / n,
    h: x.h + (count * shape.h) / n,
    e: x.e + (count * shape.e) / n,
  }));
}

/**
 * MARRIAGE, AND WHY IT IS THE ENGINE OF THE WHOLE PERIOD.
 *
 * A medieval European did not marry when they came of age; they married when
 * they could get a HOLDING, and a village had only so many. This is the
 * preventive check Malthus named and the thing that made pre-industrial Europe
 * something other than a boom-and-bust of famines: when land filled, marriage
 * was delayed, unmarried adults stayed as servants and labourers in other
 * hearths, and the birth rate FELL -- so the population levelled off without
 * anybody having to starve to level it.
 *
 * The bucket model expresses this without naming a bride. Land supports a
 * number of holdings; each holding is a hearth; and the share of a village's
 * fertile hands that can actually marry is the holdings it has room for over
 * the hearths it already has. When there is land for more households than
 * exist, marriage is prompt and fertility is at its full biological rate; when
 * the land is full, the factor falls and with it the births -- the smooth
 * plateau the parish registers show, not the sawtooth of repeated collapse.
 */
export function marriageFactor(landHouseholds: number, hearths: number): number {
  if (hearths <= 0) return 1;
  // Room for new households lifts marriage; a full land suppresses it. The
  // curve is gentle -- a village a little short of land does not stop marrying
  // outright, it marries later and less -- so the approach to the ceiling is a
  // glide, which is what "preventive" means.
  return Math.max(0.15, Math.min(1, landHouseholds / hearths));
}

/**
 * Form and dissolve households.
 *
 * FORMATION: where the land has room for more hearths than stand, new couples
 * split off from the crowded old ones -- the toft next door, a new assart's
 * cottage -- and the village's count of hearths climbs toward what the land
 * will bear. DISSOLUTION: a hearth worn down to no working hands, only the old
 * and the orphaned, cannot stand alone; it is taken in by another, which is
 * inheritance at the bucket's grain -- the survivors and whatever they held
 * pass to the hearth that absorbs them.
 *
 * The number of hearths is therefore not population over five; it is a state
 * that lags the land, which is why a land-full village becomes one of larger,
 * multi-generation households and a village with room becomes one of many
 * small ones. Both are in the record, and which one a place is is the whole
 * texture of its society.
 */
export function rehouse(hh: readonly Hearth[], landHouseholds: number): Hearth[] {
  // Dissolve the hands-less: fold any hearth with almost no working hands into
  // the fullest one that has them, carrying its people over.
  let out = hh.map((x) => ({ ...x }));
  const HANDLESS = 0.5;
  const alive = out.filter((x) => x.h >= HANDLESS);
  const dead = out.filter((x) => x.h < HANDLESS && (x.c + x.h + x.e) > 0.01);
  if (alive.length > 0 && dead.length > 0) {
    // Spread the absorbed across the standing hearths, eldest-heavy hearths
    // taking the orphans as the record shows kin did.
    let ac = 0; let ah = 0; let ae = 0;
    for (const d of dead) { ac += d.c; ah += d.h; ae += d.e; }
    const per = alive.length;
    out = alive.map((x) => ({
      c: x.c + ac / per, h: x.h + ah / per, e: x.e + ae / per,
    }));
  } else if (alive.length === 0) {
    out = out.filter((x) => (x.c + x.h + x.e) > 0.01);
  }

  // Form: while the land has room and a standing hearth is crowded enough to
  // spare a couple, split one off. Bounded per call so growth is a rate.
  const target = Math.max(1, Math.round(landHouseholds));
  let formed = 0;
  const MAX_FORM = Math.max(1, Math.ceil(out.length * 0.02));
  while (out.length < target && formed < MAX_FORM) {
    // The most crowded hearth donates a couple and their first child.
    out.sort((a, b) => (b.h + b.c + b.e) - (a.h + a.c + a.e));
    const donor = out[0];
    if (donor.h < 2.2) break; // needs two hands to spare and keep two
    donor.h -= 2; donor.c -= Math.min(donor.c, 1);
    out.push({ c: Math.min(1, Math.max(0, 1)), h: 2, e: 0 });
    formed++;
  }
  return out;
}

/**
 * Take people OUT of the hearths -- a daughter founding, deaths the economy
 * decided -- proportionally across every bucket of every hearth. Returns
 * what was actually removed, which can be less than asked if the village is
 * smaller than the ask.
 */
export function drawPeople(
  hh: readonly Hearth[], count: number,
): { hearths: Hearth[]; taken: number } {
  const total = populationOf(hh);
  if (total <= 0 || count <= 0) {
    return { hearths: hh.map((x) => ({ ...x })), taken: 0 };
  }
  const share = Math.min(1, count / total);
  const out = hh.map((x) => ({
    c: x.c * (1 - share),
    h: x.h * (1 - share),
    e: x.e * (1 - share),
  }));
  return { hearths: out, taken: total * share };
}

/** Round every bucket for the delta, and drop hearths that have died out. */
export function settleHearths(hh: readonly Hearth[]): Hearth[] {
  return hh
    .map((x) => ({
      c: Math.round(x.c * 1000) / 1000,
      h: Math.round(x.h * 1000) / 1000,
      e: Math.round(x.e * 1000) / 1000,
    }))
    .filter((x) => x.c + x.h + x.e > 0.01);
}
