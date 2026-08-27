// Measured reality. Nothing in this file is a design choice.
//
// Every number here is something someone went and measured in the world: a
// gait laboratory, a race track, a surviving hauberk on a museum scale, a
// chronograph in front of a replica warbow. Game numbers are not written down
// anywhere in this project -- they are solved from these, in derive.ts.
//
// The rule for adding to this file: if you cannot say who measured it and what
// they measured, it does not belong here. Put it in derive.ts as a labelled
// free parameter instead, where it will be visible as one.
//
// Units are SI throughout and float, because this file is read at authoring
// time only. Everything crossing into the simulation goes through derive.ts,
// which snaps to the integer grid once and never looks back.

// ---------------------------------------------------------------------------
// The stat contract
// ---------------------------------------------------------------------------
// Carried over from medieval3d, where it earned its keep: a stat of 10 is an
// average healthy adult, a stat of 20 is the human world record, and a stat of
// 1 is the floor of what still counts as functioning. Every capability curve
// is pinned at those two ends and interpolated between, so no capability is
// ever "chosen" -- it is read off a line between a person and a record.

export const STAT_AVERAGE = 10;
export const STAT_RECORD = 20;
export const STAT_FLOOR = 1;

// ---------------------------------------------------------------------------
// The reference body
// ---------------------------------------------------------------------------

/** Mass of the reference adult male, kg. WHO/anthropometric reference figure. */
export const BODY_MASS = 70.0;

/** Standing height of the reference adult male, m. */
export const BODY_HEIGHT = 1.75;

/** Shoulder width, m. Sets how tightly a formation can pack. */
export const SHOULDER_WIDTH = 0.45;

// ---------------------------------------------------------------------------
// Locomotion
// ---------------------------------------------------------------------------

/**
 * Preferred walking speed on level ground, m/s. Gait studies cluster tightly
 * at 1.3-1.45 across populations; this is the middle of that band. It is a
 * preferred speed, not a maximum -- people select it because it minimises
 * metabolic cost per metre, which is exactly the quantity a marching column
 * is also minimising.
 */
export const WALK_PREFERRED = 1.40;

/**
 * Gait speed below which a person has lost community ambulation, m/s. The
 * frailty literature uses 0.6 as the threshold: slower than this and you
 * cannot cross a road on the lights. This is the stat-1 end of the walking
 * curve -- the floor of what still counts as walking, measured rather than
 * guessed. derive.ts takes the ratio it implies (0.43 of average) and applies
 * it to other capabilities, which is an assumption and is labelled as one.
 */
export const WALK_FRAIL_THRESHOLD = 0.6;

/**
 * 100 m sprint, world record average speed, m/s. Bolt, Berlin 2009, 9.58 s
 * over 100 m. This is the stat-20 end of the sprint curve. (Peak speed within
 * that run was about 12.4 m/s; the average is the honest anchor for a run of
 * that length, and a charge is a run of about that length.)
 */
export const SPRINT_RECORD = 100.0 / 9.58;

/**
 * 100 m sprint, untrained healthy adult male, m/s. Physical-education norm
 * tables put an average adult male around 15 s for 100 m. Stat-10 end.
 */
export const SPRINT_AVERAGE = 100.0 / 15.0;

/**
 * How long an all-out sprint can be held before the anaerobic system is spent
 * and speed collapses, s. Track physiology: peak speed is held for a few
 * seconds and 400 m runners are visibly decelerating by 300 m.
 */
export const SPRINT_DURATION = 20.0;

// ---------------------------------------------------------------------------
// What a soldier carries
// ---------------------------------------------------------------------------
// Masses from surviving pieces and from reconstructions weighed against them.

/** Riveted mail hauberk, knee length, kg. Surviving examples run 9-11. */
export const MAIL_HAUBERK = 10.0;

/** Open-faced helm, kg. */
export const HELM = 2.0;

/** Round or kite shield, limewood with hide facing, kg. */
export const SHIELD = 4.0;

/** Spear, sword and belt, kg. */
export const ARMS = 3.0;

/** Pack: three days of grain, bedroll, cook pot, stakes, kg. */
export const PACK = 8.0;

/** A line infantryman under full campaign load, kg. */
export const INFANTRY_LOAD = MAIL_HAUBERK + HELM + SHIELD + ARMS + PACK;

// ---------------------------------------------------------------------------
// Horses
// ---------------------------------------------------------------------------

/** Mass of a warhorse, kg. Medieval horses were smaller than modern hunters. */
export const HORSE_MASS = 500.0;

/** Horse gait speeds, m/s. Equine locomotion measurements. */
export const HORSE_WALK = 1.6;
export const HORSE_TROT = 3.5;
export const HORSE_CANTER = 5.5;

/**
 * Racehorse peak, m/s. Winning Brew, 2008, 402 m in 19.32 s. The stat-20 end
 * of the gallop curve, and a thoroughbred sprinting unburdened -- a warhorse
 * under an armoured man is derived down from here, not up from nothing.
 */
export const HORSE_GALLOP_RECORD = 402.0 / 19.32;

/**
 * Full gallop of an ordinary riding horse, m/s. Equine gait measurements put
 * a sound but unremarkable horse at 12-14. Stat-10 end of the gallop curve;
 * HORSE_GALLOP_RECORD is the stat-20 end, and a warhorse sits between them.
 */
export const HORSE_GALLOP_AVERAGE = 13.0;

/** How far a horse can hold a gallop before it must be pulled up, m. */
export const HORSE_GALLOP_RANGE = 3000.0;

// ---------------------------------------------------------------------------
// Missiles
// ---------------------------------------------------------------------------

/**
 * English warbow draw weight, N. The Mary Rose bows measure 150-160 lbf when
 * reconstructed to their original dimensions; 150 lbf is 667 N.
 */
export const WARBOW_DRAW_FORCE = 667.0;

/** Draw length of a warbow shot to the ear, m. */
export const WARBOW_DRAW_LENGTH = 0.76;

/** Heavy war arrow, kg. Mary Rose arrows run 60-95 g. */
export const WAR_ARROW_MASS = 0.080;

/**
 * Measured muzzle velocity of a heavy war arrow from a warbow, m/s.
 * Chronographed replica tests land at 50-60. Kept as its own anchor rather
 * than derived from the draw, because bow efficiency is the thing being
 * measured here -- derive.ts checks the two against each other.
 */
export const WAR_ARROW_SPEED = 55.0;

/** Brace height of a warbow, m -- the string-to-belly distance at rest. The
 * powerstroke is the draw length less this, and the force at brace is a
 * quarter of peak, which together give the area under the force-draw curve. */
export const WARBOW_BRACE_HEIGHT = 0.15;
export const WARBOW_BRACE_FORCE_FRACTION = 0.25;

/** Crossbow bolt mass, kg, and measured speed from a windlass-spanned bow. */
export const BOLT_MASS = 0.060;
export const BOLT_SPEED = 45.0;

/** Aimed shots per minute a trained archer sustains before the arm gives. */
export const ARCHER_RATE_PER_MIN = 8.0;

// ---------------------------------------------------------------------------
// Consumption
// ---------------------------------------------------------------------------

/**
 * Daily energy requirement of a soldier on campaign, kcal. Military field
 * studies of infantry on sustained operations report 4000-4800; 3000 is what
 * the same man needs in garrison. Campaign figure used.
 */
export const SOLDIER_KCAL_PER_DAY = 4200.0;

/** Energy density of wheat, kcal/kg. */
export const WHEAT_KCAL_PER_KG = 3390.0;

/** Share of a campaign ration that is grain rather than meat, cheese or ale. */
export const GRAIN_SHARE_OF_RATION = 0.70;

/** Dry forage a horse eats daily, as a fraction of its body mass. */
export const HORSE_FORAGE_FRACTION = 0.022;

/** Water, L/day, for a man and for a horse working. */
export const MAN_WATER_PER_DAY = 3.0;
export const HORSE_WATER_PER_DAY = 35.0;

// ---------------------------------------------------------------------------
// Physical constants
// ---------------------------------------------------------------------------

/** Standard gravity, m/s^2. */
export const GRAVITY = 9.80665;

/** Seconds in a day, for anything expressed per-day. */
export const SECONDS_PER_DAY = 86400.0;

// ---------------------------------------------------------------------------
// The planet
// ---------------------------------------------------------------------------
// Earth, measured. Another planet would swap this block and nothing else.

/** Mean radius, m. */
export const EARTH_RADIUS_M = 6371000.0;

/** Land as a fraction of total surface. Used to *solve* for sea level rather
 *  than tuning the elevation field until the coastlines look about right. */
export const LAND_FRACTION = 0.292;

/** Mean elevation of land above sea level, m, and mean ocean depth, m. */
export const MEAN_LAND_ELEVATION_M = 840.0;
export const MEAN_OCEAN_DEPTH_M = 3688.0;

/** Highest and deepest points, m. The ends of the elevation range. */
export const MAX_ELEVATION_M = 8849.0;
export const MAX_DEPTH_M = -10935.0;

/** Environmental lapse rate, degC per metre of altitude. Measured, and one of
 *  the most reliable numbers in atmospheric science. */
export const LAPSE_RATE_PER_M = 0.0065;

/**
 * Zonal mean surface temperature, degC, fitted as a cubic in sin^2(latitude).
 *
 * The textbook sin^2 model (North's energy-balance approximation) runs about
 * 10 degC too cold in the mid-latitudes, which pushes the temperate forest belt
 * far enough toward the equator to be obvious. These three coefficients are a
 * least-squares fit to observed zonal means at 0, 30, 45, 60 and 90 degrees:
 * 26, 20, 12, 0 and -25 degC. It is a fit to data, not a physical model, and
 * docs/known-gaps.md records that a real energy balance would replace it.
 */
export const TEMP_EQUATOR_C = 26.0;
export const TEMP_QUAD_COEFF = 20.0;
export const TEMP_CUBIC_COEFF = 31.0;

/** Seasonal swing between warmest and coldest month, degC, at the pole. Near
 *  zero at the equator and growing with sin^2(latitude). Earth: about 2 degC at
 *  the equator, 30 at 60 degrees N. */
export const SEASONAL_AMPLITUDE_POLE_C = 40.0;

/**
 * Koeppen's tree line: forest gives way to tundra where the warmest month
 * averages below 10 degC, and to permanent ice below 0 degC. These are
 * classification boundaries drawn from observed vegetation, which is exactly
 * the kind of number this project prefers to a chosen threshold.
 */
export const TREELINE_WARMEST_MONTH_C = 10.0;
export const ICE_WARMEST_MONTH_C = 0.0;

/**
 * Zonal mean precipitation over LAND, mm/yr: an equatorial peak at the
 * intertropical convergence, a second at the polar front, over a dry
 * background. Centres in units of |sin(latitude)|.
 *
 * Over land specifically, and that distinction is the whole calibration. The
 * all-surface zonal mean at 30 degrees is around 600 mm, and fitting to it gave
 * a planet with 0.2% desert against Earth's 19% -- because that 600 mm is
 * almost entirely ocean, while the land sitting at 30 degrees is the Sahara,
 * Arabia, the Atacama, the Kalahari and the Australian interior. The model only
 * ever evaluates these over land, so the land profile is the honest target.
 * These four values are the output of verify/calibrate_climate.ts, which
 * sweeps them and scores the resulting land cover against Earth's. The best
 * fit reproduces forest/grass/desert/tundra to within 2.6 points across all
 * four -- total absolute error 0.068, against 0.266 before the classification
 * moved onto the aridity index.
 */
export const PRECIP_ITCZ_MM = 2400.0;
export const PRECIP_ITCZ_WIDTH = 0.26;
export const PRECIP_POLAR_FRONT_MM = 800.0;
export const PRECIP_POLAR_FRONT_CENTRE = 0.80;
export const PRECIP_POLAR_FRONT_WIDTH = 0.20;
export const PRECIP_BACKGROUND_MM = 40.0;

/**
 * How fast rain wrings out of an air mass moving inland, per cell of travel.
 * At 277 km a cell this is a half-life of about 1,900 km, which puts the dry
 * heart of a continent the right distance from its coasts.
 */
export const CONTINENTALITY_PER_CELL = 0.10;

/** Metres of ascent that doubles rainfall on a windward slope, and metres of
 *  descent that drives a lee slope to its driest, with that floor. Orographic
 *  rainfall is the sharpest signal on a real precipitation map -- the Atacama
 *  and the Great Basin are both simply behind something. */
export const OROGRAPHIC_DOUBLING_M = 900.0;
export const RAIN_SHADOW_M = 1400.0;
export const RAIN_SHADOW_FLOOR = 0.10;

/**
 * Net primary productivity, the Miami model (Lieth, 1975): an empirical fit of
 * observed plant growth against temperature and rainfall across every biome on
 * Earth. Productivity is the lesser of what heat allows and what water allows,
 * which is why a hot desert and a cold bog are both unproductive for different
 * reasons. Grams of dry matter per square metre per year.
 */
export const MIAMI_MAX_NPP = 3000.0;
export const MIAMI_TEMP_A = 1.315;
export const MIAMI_TEMP_B = 0.119;
export const MIAMI_PRECIP_K = 0.000664;

/** Plate count. Earth has seven major and about eight minor plates. */
export const TECTONIC_PLATES = 15;

/** Plate drift, m/yr. Measured by satellite geodesy at 1-10 cm/yr. */
export const PLATE_DRIFT_M_PER_YR = 0.05;

/**
 * Holdridge's potential evapotranspiration: PET in mm/yr is 58.93 times the
 * biotemperature in degC. Biotemperature is the mean of the monthly means with
 * everything below 0 and above 30 clamped away, on the reasoning that plants
 * do no growing outside that range so those months should not count toward
 * the water they need.
 */
export const HOLDRIDGE_PET_FACTOR = 58.93;
export const BIOTEMP_MIN_C = 0.0;
export const BIOTEMP_MAX_C = 30.0;

/**
 * The UNEP aridity index: precipitation divided by potential
 * evapotranspiration, with boundaries drawn by the UN Convention to Combat
 * Desertification from observed vegetation and soil.
 *
 * This replaced a pair of hand-set rainfall thresholds that had no cold desert
 * in them at all -- the model was turning the Gobi, the Great Basin and
 * Patagonia into grassland, which cost about a third of Earth's desert area.
 * Aridity gets it right because it asks how much water a place has *relative to
 * how fast it loses it*, and 200 mm is a desert at 25 degC and a wetland at 0.
 */
export const ARIDITY_DESERT = 0.20;      // arid and hyper-arid
export const ARIDITY_SEMIARID = 0.50;    // grassland and steppe
export const ARIDITY_SUBHUMID = 1.00;    // seasonal forest and woodland
export const ARIDITY_PERHUMID = 1.90;    // rainforest

/** Cosine of each month's phase, baked as literals. Used to reconstruct the
 *  monthly temperatures a biotemperature needs, without a transcendental. */
export const MONTH_PHASE: readonly number[] = [
  1.0, 0.866025403784439, 0.5, 0.0, -0.5, -0.866025403784439,
  -1.0, -0.866025403784439, -0.5, 0.0, 0.5, 0.866025403784439,
];

// ---------------------------------------------------------------------------
// Soil
// ---------------------------------------------------------------------------

/** Soil forms at roughly 0.05 mm/yr from weathering parent rock -- and erodes
 *  far faster than that on a slope, which is why mountains have none. */
export const SOIL_FORMATION_MM_PER_YR = 0.05;

/**
 * Depth of topsoil, cm. A mollisol under temperate grassland -- chernozem, the
 * black earth of the steppe and the prairie -- is the deepest soil on Earth at
 * 60-100 cm. A typical temperate forest soil is 20-30. Mountain and desert
 * soils are under 10.
 */
export const TOPSOIL_DEEPEST_CM = 90.0;
export const TOPSOIL_TYPICAL_CM = 25.0;
export const TOPSOIL_THIN_CM = 6.0;

/**
 * Slope at which soil stops accumulating, as a gradient (rise over run).
 * Above about 0.30 -- roughly 17 degrees -- erosion outpaces formation and the
 * hillside is bare rock and scree. Below about 0.02 it is flat enough to
 * waterlog. Both from soil-survey practice rather than from feel.
 */
export const SLOPE_EROSION_LIMIT = 0.30;
export const SLOPE_WATERLOGGING_LIMIT = 0.02;

/**
 * The reference yield of good land: about 1,000 kg of grain per hectare per
 * year on unfertilised medieval three-field arable. Records from English manor
 * accounts put wheat at 7-10 bushels an acre, which is 470-670 kg/ha; the
 * higher figure allows for the better land and the better years.
 */
export const MEDIEVAL_GRAIN_KG_PER_HA = 1000.0;

// ---------------------------------------------------------------------------
// What is in the ground
// ---------------------------------------------------------------------------

/**
 * Crustal abundance, parts per million by mass. These set how common a deposit
 * is relative to the others -- iron is not rare and tin genuinely is, and the
 * whole bronze-then-iron shape of a metal age falls out of that ratio rather
 * than from anyone deciding it should.
 */
export const CRUST_PPM_IRON = 56300.0;
export const CRUST_PPM_COPPER = 60.0;
export const CRUST_PPM_LEAD = 14.0;
export const CRUST_PPM_TIN = 2.3;
export const CRUST_PPM_SILVER = 0.075;
export const CRUST_PPM_GOLD = 0.004;

/** A worked ore body is enriched far above crustal average before it is worth
 *  digging. Iron ore is about 30% Fe against 5.6% in ordinary rock; copper ore
 *  is 0.5-2% against 0.006%. Enrichment is what a deposit *is*. */
export const ORE_ENRICHMENT_IRON = 5.0;
export const ORE_ENRICHMENT_COPPER = 150.0;
export const ORE_ENRICHMENT_TIN = 400.0;
export const ORE_ENRICHMENT_PRECIOUS = 1000.0;

/** Standing timber in a mature temperate forest, tonnes of dry wood per
 *  hectare. Boreal is thinner, tropical much heavier. */
export const TIMBER_TEMPERATE_T_PER_HA = 150.0;

/** Large game: a temperate forest carries roughly 5-15 deer per square
 *  kilometre, savanna far more ungulate biomass, tundra almost none. Expressed
 *  as a share of net primary productivity reaching large herbivores. */
export const HERBIVORE_SHARE_OF_NPP = 0.02;
export const DEER_MASS_KG = 70.0;

/**
 * Standing biomass of large herbivores in savanna, kg per km2. Africa's
 * savannas carry 3,000-10,000; this is the middle. It is the single measured
 * point the whole game-animal model is scaled from -- every other biome is
 * derived from it by how much of its productivity a grazing animal can
 * actually reach.
 */
export const SAVANNA_HERBIVORE_KG_PER_KM2 = 5000.0;

/** Standing timber in mature forest, tonnes of dry wood per hectare, by how
 *  much wood the climate builds. Temperate 150, boreal 80, tropical 300. */
export const TIMBER_TEMPERATE_REFERENCE_NPP = 1000.0;

/**
 * Q10 for soil decomposition: organic matter rots about twice as fast for
 * every 10 degC. One of the better-established numbers in soil science, and the
 * reason boreal soils store a third of the soil carbon on the planet while
 * tropical ones store almost none despite growing far more.
 */
export const SOIL_Q10 = 2.0;
export const SOIL_DECOMP_REFERENCE_C = 10.0;

/**
 * The share of a plant's yearly production that goes below ground, by biome.
 *
 * This is the mechanism that decides which soils are worth farming, and it is
 * easy to miss. Grasses put 60-80% of everything they make into roots, which
 * die back each year and become humus exactly where the next crop needs it. A
 * tree puts its production into a trunk that stands for two centuries and then
 * rots on the surface. So a rainforest can out-produce a prairie threefold and
 * still build almost no soil.
 *
 * Root-to-shoot allocation is measured, and these follow the published ranges.
 */
export const BELOWGROUND_FRACTION: readonly number[] = [
  0.00, 0.00, 0.60, 0.30, 0.75, 0.25, 0.20, 0.60, 0.65, 0.20, 0.15, 0.50, 0.55,
];

/**
 * Soil organic matter under undisturbed temperate grassland, in the units
 * soilOrganicMatter returns, used as the top of the fertility scale. Chernozem
 * runs 8-12% organic matter against 1-2% for a tropical ferralsol, and that
 * ratio is what the model has to reproduce.
 */
export const SOM_CHERNOZEM_REFERENCE = 614.0;

/** Biotemperature at which soil nutrients are fully available, degC. Near
 *  Holdridge's boundary between the boreal and temperate belts. Below it the
 *  growing season is too short to mineralise what the soil holds. */
export const BIOTEMP_AVAILABILITY_C = 10.0;

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

/**
 * Crude birth and death rates in a pre-industrial population, per thousand per
 * year. Parish registers across medieval and early-modern Europe cluster at
 * 32-40 births and 30-38 deaths -- a natural increase of a few per thousand,
 * which is why populations took centuries to double and a bad decade undid it.
 */
export const BIRTH_RATE_PER_1000_YR = 35.0;
export const DEATH_RATE_PER_1000_YR = 32.0;

/**
 * How long a person can go on short rations before it kills them. Starvation
 * studies put the limit at losing about 30% of body mass; at half rations that
 * takes roughly ten weeks.
 */
export const STARVATION_WEEKS = 10.0;

/**
 * Land one person needs to feed themselves, hectares. Not an anchor in its own
 * right -- it is here to be checked against, because it is the number every
 * agricultural historian quotes (0.5 to 1.5 ha under a three-field rotation)
 * and the model must land inside that range or something upstream is wrong.
 */
export const HISTORICAL_HA_PER_PERSON_LOW = 0.5;
export const HISTORICAL_HA_PER_PERSON_HIGH = 1.5;

/** Days in a week, and weeks in a year. One turn is one week. */
export const DAYS_PER_TURN = 7.0;
export const TURNS_PER_YEAR = 365.25 / 7.0;

/**
 * The share of held arable actually in crop in a given year.
 *
 * Under the three-field rotation that dominated medieval northern Europe, a
 * third of the land lies fallow each year to recover; under the older
 * two-field system it was a half. This is not a detail: it is the difference
 * between the model saying good grassland feeds a person off 0.37 ha and
 * saying it feeds them off 0.55, and only the second is inside the 0.5-1.5 ha
 * that agricultural historians actually measure.
 */
export const CROPPED_FRACTION_THREE_FIELD = 2.0 / 3.0;

// ---------------------------------------------------------------------------
// Moving things
// ---------------------------------------------------------------------------
//
// The whole pre-industrial economy turns on one fact: hauling food costs food.
// The driver eats, the oxen eat, and what they eat has to be grown on land
// that could have grown something else. Work that through and the cost of
// transport falls out in the same units as the cargo -- no price, no currency,
// just what fraction of a load is consumed getting it there.
//
// Two independent measurements check the result, and derive.ts asserts both:
//
//   Diocletian's Price Edict (301 AD) implies sea transport cost roughly a
//   fortieth of road transport over the same distance.
//
//   Duncan-Jones, from Roman evidence: a wagon-load of wheat about doubled in
//   price over 300 miles, near 480 km.
//
// Nothing below was chosen to hit either figure.

/** Ox cart: payload kg, and the pace a team of oxen actually walks, km/h. */
export const OX_CART_PAYLOAD_KG = 500.0;
export const OX_CART_SPEED_KMH = 3.0;
export const OXEN_PER_CART = 2;

/** A working ox, kg, and the dry fodder it eats as a share of body mass. An
 *  ox at work eats more than one at rest; 2.5% is the working figure. */
export const OX_MASS_KG = 600.0;
export const OX_FODDER_FRACTION = 0.025;

/** Hours a cart is actually on the road in a day. Loading, unloading, and
 *  resting the team take the rest. */
export const CART_HOURS_PER_DAY = 8.0;

/** A porter carries what a person can carry all day: soldiers' load studies
 *  and portering records both land near 30 kg. */
export const PORTER_LOAD_KG = 30.0;
export const PORTER_KM_PER_DAY = 25.0;

/** Hard physical labour raises daily energy need by about 40% over the
 *  campaign figure already anchored above. */
export const HARD_LABOUR_MULTIPLIER = 1.4;

/**
 * A river barge and the horse that tows it. The measured fact behind water
 * transport is that one horse drags about 1.5 t on a road and thirty to fifty
 * on water -- the same animal, the same day, twenty times the cargo. It is why
 * every great pre-industrial city is on water and none are not.
 */
export const BARGE_PAYLOAD_KG = 15000.0;
export const BARGE_CREW = 2;
export const BARGE_KM_PER_DAY = 25.0;

/** Meadow hay, kg per hectare per year. Fodder competes with grain for land,
 *  so the cost of feeding an ox is ultimately measured in acres of grain. */
export const HAY_YIELD_KG_PER_HA = 3000.0;

/** Length of a working day, dawn to dusk less meals. Medieval labour statutes
 *  specify exactly this and were fought over at length. */
export const WORKING_DAY_HOURS = 10.0;

// --- the two historical checks ---------------------------------------------

/** Duncan-Jones: a wagon-load of wheat roughly doubled in price over 300 miles. */
export const WHEAT_DOUBLING_DISTANCE_KM = 480.0;

/** Diocletian's Edict, as usually reduced: water is about a fortieth of road. */
export const WATER_ROAD_COST_RATIO = 40.0;

// ---------------------------------------------------------------------------
// Working the land
// ---------------------------------------------------------------------------

/**
 * The virgate, and what it implies about labour.
 *
 * A virgate -- a yardland -- was about 30 acres, or 12 hectares, and it was the
 * holding that supported one peasant family. That is a measured institution
 * repeated across thousands of English manorial surveys, and it pins the labour
 * cost of arable from the other end: a family of five has about two and a half
 * working adults, each giving roughly 250 days a year once holy days are taken
 * out, and between them they worked twelve hectares.
 *
 * 625 person-days over 12 ha is 52 days per hectare per year. Nobody had to
 * decide that; it is what the surveys say, divided out.
 */
export const VIRGATE_HECTARES = 12.0;
export const WORKERS_PER_FAMILY = 2.5;
export const WORKING_DAYS_PER_YEAR = 250.0;

/**
 * Seed corn: the share of a harvest that cannot be eaten because next year
 * depends on it.
 *
 * Medieval yield ratios ran about 3.5 grains harvested per grain sown, which
 * is catastrophically low by modern standards and is the single most
 * constraining number in a pre-industrial economy. It means over a quarter of
 * every harvest goes straight back into the ground, and it is why a bad year
 * did not merely cause hunger -- it ate the following year as well.
 */
export const MEDIEVAL_YIELD_RATIO = 3.5;

/**
 * How much flow a channel needs to float a barge, as normalised catchment.
 * The same threshold the renderer draws a river at, because a river you can
 * see and a river you can move grain on should be the same river.
 */
export const NAVIGABLE_DRAINAGE = 0.55;

/**
 * What wheat needs, as opposed to what a landscape grows.
 *
 * Net primary productivity says how much vegetation a place builds. It does
 * not say whether that place can carry a *crop*, and the two come apart badly:
 * a wet tropical hillside out-produces the Beauce several times over and will
 * not ripen wheat. So the crop has its own requirements, measured for the crop.
 *
 * Wheat needs 450-650 mm of water across a season and about 120 days above its
 * base temperature of 5 degC, below which it does not develop at all. All three
 * are standard agronomic figures.
 */
export const WHEAT_WATER_REQUIREMENT_MM = 500.0;
export const WHEAT_GROWING_DAYS = 120.0;
export const WHEAT_BASE_TEMP_C = 5.0;

/**
 * The fastest a pre-industrial population ever grew from births alone.
 *
 * Colonial America: roughly 3% a year sustained, doubling every 25 years, on
 * abundant land with early marriage and low urban density. Franklin noticed it
 * in 1751 and Malthus built a book on it. It is the ceiling, and it is what a
 * settlement with all the food it wants should approach -- not exceed.
 *
 * The birth multiplier that produces it is solved rather than chosen: to reach
 * a 30-per-thousand net increase against a 32-per-thousand death rate, births
 * must run at 62 per thousand, which is 1.77 times the baseline.
 */
export const MAX_NATURAL_INCREASE_PER_YEAR = 0.03;

/**
 * How fast people move to somewhere with food.
 *
 * FREE PARAMETER, and an important one to be honest about. Medieval towns grew
 * mostly by immigration rather than by birth -- urban death rates exceeded
 * urban birth rates almost everywhere, the "urban graveyard" effect -- and
 * successful ones sustained 1-3% a year that way, with bursts far higher after
 * a plague or a charter.
 *
 * What is not measurable is where the migrants come from in a world that has
 * barely been settled. Until there are other settlements to move *from*, this
 * stands in for the rest of the world, and 8% of the unfilled capacity per
 * year is ours. It is the number to revisit the moment migration between real
 * settlements exists.
 */
export const MIGRATION_RATE_PER_YEAR = 0.08;

/** Nobody moves to a place that cannot feed them. Migrants need to see a
 *  surplus, not merely subsistence. */
export const MIGRATION_MIN_RATION = 1.05;

// ---------------------------------------------------------------------------
// Iron
// ---------------------------------------------------------------------------
//
// The second thing a settlement can make, and the reason specialisation pays.
// Iron is chosen over any other craft because its whole chain is already on
// the map: ore comes from the geology model, charcoal from the timber model,
// and what it buys -- less labour per hectare -- feeds straight back into the
// supply model. Nothing new had to be invented to close the loop.

/**
 * Iron consumed per person per year, kg. Estimates of European output in the
 * fourteenth century divided by population land near one kilogramme a head --
 * a ploughshare, a coulter, a scythe, an axe, nails and horseshoes, all of it
 * wearing out and being replaced over a few years.
 */
export const IRON_PER_PERSON_KG_PER_YEAR = 1.0;

/**
 * A bloomery, which is what iron came out of before the blast furnace.
 *
 * A run yields about 15 kg of iron from roughly three times its weight in ore,
 * and needs about four kilogrammes of charcoal for every kilogramme of iron.
 * Charcoal in turn takes about five kilogrammes of wood per kilogramme made,
 * so a kilogramme of iron consumes twenty kilogrammes of standing timber. That
 * is why ironworking moved when the woods ran out, not when the ore did.
 */
export const BLOOM_YIELD_KG = 15.0;
export const ORE_PER_IRON_KG = 3.0;
export const CHARCOAL_PER_IRON_KG = 4.0;
export const WOOD_PER_CHARCOAL_KG = 5.0;

/** Person-days for each stage of making a kilogramme of iron. Digging, felling,
 *  burning, smelting and smithing, from what each trade got through in a day. */
export const ORE_DUG_KG_PER_DAY = 200.0;
export const WOOD_FELLED_KG_PER_DAY = 1000.0;
export const WOOD_CHARRED_KG_PER_DAY = 500.0;
export const BLOOM_CREW_DAYS = 5.0;
export const SMITHING_DAYS_PER_KG = 0.5;

/**
 * What iron buys: a scythe mows three to four times as fast as a sickle, and
 * an iron-shod mouldboard plough opens ground a wooden ard cannot. Cutting and
 * ploughing are about half of farm labour.
 *
 * FREE PARAMETER: that half. The scythe figure is measured and repeatedly
 * documented; the share of the farming year it applies to is our estimate.
 */
export const SCYTHE_SPEEDUP = 3.0;
export const TOOL_DEPENDENT_LABOUR_SHARE = 0.5;

/**
 * How much grain a settlement tries to keep in hand, in years of eating.
 *
 * Medieval granaries aimed at a year's supply plus next year's seed, because
 * the gap between harvests is the whole problem and a failed harvest has to be
 * survivable. It is also what makes trade *stabilising* rather than merely
 * useful -- a town with a full granary can lose a supplier for a season.
 */
export const GRAIN_STOCK_TARGET_YEARS = 1.0;

/** Grain spoils. Even well kept, a granary loses a few per cent a year to
 *  damp, rats and weevils; 5% is the usual figure for good storage. */
export const GRAIN_SPOILAGE_PER_YEAR = 0.05;

// ---------------------------------------------------------------------------
// The farming year, task by task
// ---------------------------------------------------------------------------
//
// Manorial accounts and the thirteenth-century husbandry treatises -- Walter of
// Henley above all -- record how much ground each job covered in a day, because
// that is exactly what a reeve had to know to plan a year. So the labour cost
// of arable is not estimated here, it is added up.
//
// Rates are in acres per man-day, the unit the sources use. An acre is 0.4047
// hectares.
//
// This replaced a figure derived from the virgate -- 12 hectares to a family of
// two and a half workers giving 250 days each, so 52 man-days a hectare. That
// reasoning assumed a family spent all its labour on its own arable, and a
// villein family did nothing of the kind: week-work on the lord's demesne ran
// to two or three days in seven, and beyond that there were livestock, the
// croft, woodland rights, building and spinning. The virgate is now a *check*
// on the total rather than the source of it, and it passes: a family's own
// arable comes out at about half its available days, which leaves the right
// amount for everything else it owed and did.

export const ACRE_HECTARES = 0.4046856;

/**
 * A plough team covers an acre in a day -- Walter of Henley states it plainly
 * and manorial accounts bear it out -- but only with an iron share and coulter
 * to cut the furrow slice. A wooden ard scratches rather than turns, needs
 * cross-ploughing, and manages about half as much.
 *
 * The team is a ploughman and a driver, so an acre costs two man-days.
 */
export const PLOUGH_ACRES_PER_TEAM_DAY_IRON = 1.0;
export const PLOUGH_ACRES_PER_TEAM_DAY_WOOD = 0.5;
export const PLOUGH_TEAM_MEN = 2;

/** Ploughings a year: sown land twice, and fallow once or twice more, because
 *  the fallow is ploughed to kill weeds and that is half of why it works. */
export const PLOUGHINGS_PER_SOWN_ACRE = 2.0;
export const PLOUGHINGS_PER_FALLOW_ACRE = 1.5;

/** Harrowing to break the clods and cover the seed. */
export const HARROW_ACRES_PER_DAY = 1.5;

/** Sowing broadcast from a seed-lip. Fast, and the one job nobody rushed. */
export const SOW_ACRES_PER_DAY = 2.5;

/** Weeding, with a hook and a forked stick. Medieval fields were weedy and
 *  this was real work, done twice in a bad year. */
export const WEED_ACRES_PER_DAY = 0.5;

/**
 * Reaping wheat with a sickle: a quarter to a third of an acre a day. Slow on
 * purpose -- the sickle cuts high and holds the ear steady, losing far less
 * grain to shattering than a scythe, and leaving the long straw that thatched
 * the roof. It is why the scythe did not take over the wheat harvest for
 * centuries after it was mowing everything else.
 */
export const REAP_ACRES_PER_DAY_SICKLE = 0.28;

/** Mowing with a scythe: an acre a day, three to four times a sickle. Used for
 *  hay and for the spring grains, and it needs a large iron blade. */
export const MOW_ACRES_PER_DAY_SCYTHE = 1.0;

/** The share of the sown area under spring grains, which can be scythed.
 *  Under a three-field rotation, half the sown land is the spring field. */
export const SPRING_GRAIN_SHARE = 0.5;

/** Binding into sheaves and stooking them to dry. */
export const BIND_ACRES_PER_DAY = 0.5;

/** Carting the sheaves to the barn. */
export const CART_ACRES_PER_DAY = 1.0;

/**
 * Threshing with a flail and winnowing: about a quarter a day, which is
 * roughly 200 kg of grain. Unlike every other task this scales with the
 * harvest rather than with the acreage, so good land costs more to thresh.
 */
export const THRESH_KG_PER_DAY = 200.0;

// ---------------------------------------------------------------------------
// Spreading, and why kingdoms are the size they are
// ---------------------------------------------------------------------------

/**
 * The forty days.
 *
 * A feudal levy owed its lord forty days of service in the year, and that
 * number is the most important constraint on the size of a medieval kingdom
 * that nobody thinks of as a constraint. An army marching at a column's pace
 * has to get out, do something, and get home inside it. Split the forty days
 * roughly evenly between marching out, campaigning and marching back, and the
 * radius of effective authority falls straight out of the marching rate the
 * supply model already derived.
 *
 * It is why kingdoms were the size they were, and it is why holding land
 * across a sea was a different proposition from holding land up a road.
 */
export const FEUDAL_SERVICE_DAYS = 40.0;

/** How the forty days divide. Marching out, doing the thing, marching back. */
export const CAMPAIGN_MARCH_SHARE = 0.375;

/** Hours a column is actually on the road in a day. The rest is breaking camp,
 *  making camp, foraging and waiting for the baggage. */
export const MARCH_HOURS_PER_DAY = 8.0;

/**
 * A founding party.
 *
 * FREE PARAMETER. Four families is our figure. The lower bound is not really
 * economic -- one family can work land and feed itself, and the model would
 * let it -- it is that a household alone on a frontier is one bad winter or
 * one raiding party from gone. Assarts and daughter villages in the record are
 * founded by a handful of households at a time, not by one.
 */
export const FOUNDING_PARTY_FAMILIES = 4.0;
export const PEOPLE_PER_FAMILY = 5.0;

/**
 * How idle a settlement has to be before people leave.
 *
 * FREE PARAMETER, and a mild one: some slack is normal, and a village does not
 * split because two men had a quiet fortnight. A fifth of the workforce with
 * nothing to do is a real surplus and is roughly when the record shows assarts
 * and daughter settlements appearing.
 */
export const IDLE_SHARE_TO_SPREAD = 0.20;

/**
 * What a bad year yields, against an average one.
 *
 * Medieval harvests varied enormously -- a poor year could come in at half a
 * good one, and two poor years running was a famine. Manorial yield series
 * swing by 30-50% about their mean.
 *
 * This is why a village plants more than it eats. Not greed and not trade:
 * you sow for the bad year, because if you sow for the average one you starve
 * every time the weather turns. It is also, incidentally, where the surplus
 * that feeds a town and pays a tax comes from in a good year.
 */
export const BAD_YEAR_YIELD_FRACTION = 0.65;
