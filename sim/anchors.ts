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

/**
 * Mean elevation of land above sea level, m, and mean ocean depth, m.
 *
 * The RATIO between them is what the generator needs, and it is the reason a
 * coastline cannot be interpolated in metres. Land stands a few hundred metres
 * up and the sea floor lies four kilometres down, so a straight interpolation
 * between a continent and an abyss crosses sea level four fifths of the way
 * into the continent: a region at +643 m beside ocean at -3,800 crossed 14% of
 * the way out from its own centre rather than at the boundary halfway, and
 * kept about 8% of its area as land.
 *
 * Compounded over the ladder that turned a planet solved for LAND_FRACTION
 * above into a march layer holding 12% land and a hundred layer holding 6%.
 * See gen/submap.landSignal.
 */
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
export const PRECIP_BACKGROUND_MM = 10.0;

/**
 * How fast rain wrings out of an air mass moving inland, per KILOMETRE.
 *
 * Per kilometre, not per cell, and that distinction is not pedantry: it was
 * written per cell, and when the globe went from 10,242 regions to 92 the cell
 * grew from 277 km to 2,530 km and the term became ten times too weak. Every
 * continent turned into rainforest -- 44% forest cover against a target of 31%
 * -- because no interior was ever dry.
 *
 * Refitted when the planet moved onto a simulated mesh, and it moved a long
 * way: from a 1,900 km half-life to 578. The reason is measurable and is not
 * about rain. This world's land covers the same 149 million km2 as Earth's and
 * is in about the same number of pieces, but it is more dissected -- the median
 * land point sits 278 km from the sea where Earth's sits nearer 600 -- so a
 * given half-life dries out proportionally less of it.
 *
 * Refitted AGAIN when the storms took the polar rows, and this time it moved
 * back the other way: from a 578 km half-life to 1,386. Drowning the outermost
 * row of cells leaves this world with no land above about 57 degrees, so its
 * ground is proportionally less under the wet polar front and more in the dry
 * subtropics than it was -- and a term tuned to dry out interiors was then
 * drying out a world that had already lost its wettest latitudes. Desert cover
 * ran to 32.8% against a target of 22.7, and forest fell to 22.9 against 41.1.
 *
 * The new value is also the more defensible one against the ground truth it
 * came from: continentality across a real continental interior is measured at
 * something over a 1,000 km half-life -- the Great Plains figure this anchor
 * was originally argued from -- and 5.0e-4 gives 1,386 km where 1.2e-3 gave
 * 578. The fit had been pulling it further from the measurement than it needed
 * to be.
 *
 * Fitted rather than chosen: the sweep in verify/calibrate_climate.ts scores
 * whole land-cover fractions against Earth's, restricted to the latitudes this
 * world has land in, and this is the value that wins. The fit error over four
 * cover classes is 0.068, against 0.253 for the old value on the new world.
 *
 * The first sweep after the re-grid returned all eight of its best rows at the
 * bottom of its range, which is a sweep reporting that it ran out of room
 * rather than that it found a minimum. Extending the range downward put the
 * winner in the interior, with 3.5e-4 and 2.0e-4 both scoring worse. That check
 * -- is the winner on a boundary? -- is worth making every time this is refit.
 */
export const CONTINENTALITY_PER_KM = 5.0e-4;

/**
 * How wide a mountain range is, metres. A plate boundary is a line and a
 * cordillera is a few hundred kilometres across, so the uplift is smeared over
 * that distance -- however many cells that happens to be at the current
 * resolution. At 92 regions it is less than one cell and no smearing happens
 * at all, which is the honest answer: a 2,900 km cell cannot resolve the
 * Andes.
 */
export const MOUNTAIN_RANGE_WIDTH_M = 500000.0;

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
// Two independent measurements check the result, and verify_supply.ts asserts
// both of them -- derive.ts asserts nothing, and this line used to say it did:
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
 * Downstream hydraulic geometry: how deep a river is for the water in it.
 *
 * Leopold and Maddock measured 20 river systems across the United States in
 * 1953 and found the same power laws in all of them -- width, depth and
 * velocity each scale as a fixed power of discharge, and the three exponents
 * sum to one because their product is the discharge itself. Mean depth is
 *
 *     d = 0.27 * Q^0.40      d in metres, Q in cubic metres a second
 *
 * This is what lets a channel's size be *solved* from its catchment rather
 * than asserted. Navigability follows from it and a barge's draught, which is
 * the point: nobody gets to choose how big a river has to be.
 */
export const HYDRAULIC_DEPTH_COEFF = 0.27;
export const HYDRAULIC_DEPTH_EXPONENT = 0.40;

/**
 * The width half of the same relations: w = 2.7 * Q^0.50.
 *
 * The three coefficients multiply to one and the three exponents sum to one,
 * because width times depth times velocity is the discharge itself. That is
 * not a fit, it is an identity, and it is the reason this set can be trusted
 * where a single fitted curve could not.
 */
export const CHANNEL_WIDTH_COEFF = 2.7;
export const CHANNEL_WIDTH_EXPONENT = 0.50;

/**
 * How wide a river's floodplain is, in channel widths.
 *
 * Leopold and Wolman measured meander geometry across scales and found the
 * whole pattern locked to channel width: a meander wavelength is 10-14 widths,
 * and the belt the channel sweeps across -- which is the floodplain it builds
 * -- is 15 to 18. A brook has a floodplain a few metres wide and the Mississippi
 * has one tens of kilometres wide, for the same reason and by the same ratio.
 *
 * This is what lets alluvial soil be placed by size rather than by rank. A
 * floodplain narrower than the tile it sits in is not absent, it is a fraction
 * of that tile, and saying so is the only honest thing a coarse map can do.
 */
export const MEANDER_BELT_WIDTHS = 15.0;

/**
 * What a laden medieval river barge drew.
 *
 * Around 0.9 m for the flat-bottomed craft that worked the Severn trows, the
 * Thames western barges and the Rhine and Meuse traffic. Shallower than a
 * seagoing hull by design: a river boat is built to the river it works, and
 * the binding constraint is the shallowest reach it must cross in summer.
 */
export const BARGE_LADEN_DRAFT_M = 0.9;

/**
 * The largest river there is: the Amazon at its mouth, 209,000 m3/s.
 *
 * The top of the scale discharge is measured against. It is a real ceiling
 * rather than a convenience -- no drainage basin on Earth delivers more, and
 * a generated world that produced a bigger one would be saying something
 * false about itself.
 */
export const AMAZON_M3_PER_S = 209000.0;

/** Seconds in a Julian year, for turning a depth per year into a flow. */
export const SECONDS_PER_YEAR = 31557600.0;

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

// ---------------------------------------------------------------------------
// The ground, as rock and as soil
// ---------------------------------------------------------------------------
// Everything below is a laboratory or field measurement of real material.
// What varies from one is which rock a place is made of, and that is settled
// by the tectonic history the planet generator already computes.

/**
 * Stream-power incision: how fast running water cuts down into rock.
 *
 *     E = K * A^m * S^n,   with m ~ 0.5 and n ~ 1
 *
 * The exponents are the ones every field calibration converges on, and the
 * m/n ratio near 0.5 is why a river long-profile is concave -- discharge grows
 * downstream faster than the slope it needs, so the channel flattens as it
 * goes. This is the law that carves a valley rather than drawing one.
 *
 * K is the erodibility, and it is the part that depends on the rock. The range
 * across lithologies spans three orders of magnitude, which is why a granite
 * massif stands while the shale beside it is a plain.
 */
/**
 * How rough terrain stays as you look closer: the Hurst exponent.
 *
 * Topography is self-affine, not self-similar -- halve the horizontal scale
 * and the relief does not halve with it, it falls by rather less. Variogram
 * and spectral analyses of real land surfaces put the exponent between 0.5 and
 * 0.8, a fractal dimension of 2.2 to 2.5, and 0.7 is the middle of that for
 * continental topography.
 *
 * The number matters here more than it would in a single-scale generator,
 * because it is applied seven times over. Amplitude had been falling as the
 * full first power of the wavelength, which is an exponent of 1.0 and smoother
 * than any real landscape: it left the layer a person actually stands on with
 * ONE MILLIMETRE of texture on a 41 cm tile, and the plot layer with five
 * centimetres across thirty-seven metres. Both were flat as glass.
 *
 * One exponent across seven orders of magnitude is an approximation and worth
 * saying so -- different processes shape a mountain range and a ploughed field
 * -- but a measured approximation beats an unmeasured one.
 */
export const TOPOGRAPHY_HURST = 0.70;

/**
 * Local relief at a ten-kilometre baseline: how much a landscape goes up and
 * down across ten kilometres of it.
 *
 * The standard way relief is reported, and it is measured everywhere. A high
 * mountain belt runs 800-1,500 m per 10 km; rolling hill country 100-250;
 * a floodplain or a shield plain 10-30. These are the two ends of that.
 *
 * They are here because a generator needs to know how rough to make ground at
 * a scale it is not looking at. Relief scales as the baseline to the Hurst
 * exponent, so one measured relief at one measured baseline sets it at every
 * other -- and *that* is the number a generated world can be checked against,
 * which "420 metres of noise" never was.
 *
 * The detail amplitude used to be a bare 420 m at the top layer divided down.
 * The trouble with a bare number is not that it is wrong, it is that nothing
 * can say whether it is wrong. Once the staircase was out of the sampler the
 * whole world measured under six degrees everywhere -- no slope on Earth, no
 * bare rock, and denudation a hundredfold too slow -- and there was no
 * measurement the old constant could be held against to have caught it.
 */
export const LOCAL_RELIEF_MOUNTAIN_M = 900.0;
export const LOCAL_RELIEF_PLAIN_M = 18.0;
export const LOCAL_RELIEF_BASELINE_M = 10000.0;

/**
 * The one measured point stream power is calibrated at.
 *
 * A temperate hillslope on ordinary sedimentary rock -- a catchment of about
 * ten hectares at a gradient of one in ten -- denudes at roughly 0.05 mm a
 * year. That is the middle of the cosmogenic-nuclide and sediment-yield
 * compilations for stable continental uplands, and it fixes K for every other
 * rock and every other geometry.
 *
 * What comes out the far end is not fitted and is the check: an active
 * mountain front lands near 0.8 mm/yr and a lowland basin near 0.005, and the
 * measured spread across those settings is exactly two orders of magnitude.
 */
/**
 * How long a hillslope is, divide to channel: 50 to 500 m in soil-mantled
 * temperate landscapes, and it is what sets the scale the soil and stability
 * models are valid at.
 *
 * A cell has to be a good deal smaller than a hillslope before its gradient
 * means anything. A two-kilometre mountain spread across a 2,900 km cell is a
 * gradient under one degree -- nowhere near what strips a ridge -- so a
 * hillslope steady state asked at that scale answers "deep soil everywhere"
 * for every mountain on the planet. That exact failure is on record in the
 * sister project: bare rock came out at 0% of land and mean soil at 3.6 m,
 * and the rule was right while the grid could not ask it.
 *
 * So the ladder asks it only where it is resolved, which is the plot layer
 * down. Above that the fields are still computed -- they are cheap and they
 * are the same function -- but `hillslopesResolved` is false and nothing
 * should be believing them.
 */
export const HILLSLOPE_LENGTH_M = 100.0;

export const DENUDATION_TEMPERATE_M_PER_YR = 5.0e-5;
export const DENUDATION_REFERENCE_CATCHMENT_M2 = 1.0e5;
export const DENUDATION_REFERENCE_SLOPE = 0.10;

export const STREAM_POWER_M = 0.5;
export const STREAM_POWER_N = 1.0;

/**
 * Soil production, by Heimsath's cosmogenic-nuclide measurements.
 *
 *     P = P0 * exp(-z / z0)
 *
 * Bedrock turns into soil fastest where there is a thin cover over it -- some
 * soil to hold water against the rock, but not enough to insulate it. Under a
 * deep column production falls away exponentially. Measured at Point Reyes,
 * the Oregon Coast Range and Nunnock River, all agreeing on a decay depth
 * around half a metre.
 *
 * The exponential is why soil depth is *self-limiting*: strip a hillside and
 * it makes soil faster; leave it and production slows to nothing. A steady
 * state falls out where production equals erosion, and that steady state is
 * the soil depth of a landscape -- not a number anybody types in.
 */
export const SOIL_PRODUCTION_MAX_M_PER_YR = 0.00009;
export const SOIL_PRODUCTION_DECAY_M = 0.50;

/**
 * Root cohesion: the strength a plant's roots add to the soil, in kilopascals.
 *
 * Measured by back-analysis of slopes that failed and shear tests on rooted
 * blocks. It is the term that makes vegetation part of the geotechnics rather
 * than decoration on top of it: bare soil at the angle of repose sits at a
 * factor of safety near 1 by definition, so 15 kPa of forest roots is the
 * difference between a stable 33-degree slope and a stable 45-degree one.
 */
export const ROOT_COHESION_BARE_KPA = 0.0;
export const ROOT_COHESION_GRASS_KPA = 3.0;
export const ROOT_COHESION_SHRUB_KPA = 6.0;
export const ROOT_COHESION_FOREST_KPA = 15.0;

/**
 * How fast root strength goes after the plants die: half-life 2-5 years.
 *
 * Sidle's decay curves. The consequence is measured too and it is the reason
 * this number is here: landslide frequency after a clearcut peaks 3 to 15
 * years later, not at the time of the cut. The roots keep holding while they
 * rot, and the hillside comes down on whoever is farming it by then.
 */
export const ROOT_DECAY_HALFLIFE_YR = 3.5;

/**
 * Unit weight of wet soil and of water, and gravity. Newtons per cubic metre.
 *
 * Soil at 1,900 kg/m3 is a typical wet colluvium -- the material that actually
 * sits on hillsides and the material that actually slides off them.
 */
export const SOIL_UNIT_WEIGHT_N_M3 = 18640.0;
export const WATER_UNIT_WEIGHT_N_M3 = 9810.0;

/**
 * Angle of repose of drained granular soil, degrees.
 *
 * Around 33 for sand and gravel, and it is where the infinite-slope test is
 * calibrated: on bare cohesionless ground the factor of safety is exactly 1 at
 * this angle, whatever the depth, because both sides of the ratio carry the
 * same weight term. That identity is a free check on the arithmetic.
 */
export const SOIL_FRICTION_ANGLE_DEG = 33.0;

// ---------------------------------------------------------------------------
// Plate tectonics
// ---------------------------------------------------------------------------
// The mesh the world is generated on runs a plate simulation. Everything here
// is something measured about Earth's crust and how it moves.

/**
 * How fast plates move: 10 to 100 mm a year.
 *
 * The measured range across Earth's plates. The Pacific runs near the top of
 * it, the Eurasian near the bottom, and the spread is what makes one boundary
 * a Himalaya and another a quiet suture.
 */
export const PLATE_SPEED_MIN_M_PER_YR = 0.010;
export const PLATE_SPEED_MAX_M_PER_YR = 0.100;

/**
 * Crustal thickness, kilometres. Continental 35, oceanic 7.
 *
 * The single most consequential pair of numbers in the whole model, because
 * the difference between them IS the difference between land and sea: thick
 * light crust floats high, thin dense crust floats low, and everything else is
 * detail on top of that.
 */
export const CRUST_CONTINENTAL_KM = 35.0;
export const CRUST_OCEANIC_KM = 7.0;

/** Crust cannot be thinned away to nothing; rifted continental crust bottoms
 *  out around 10 km before it breaks and becomes ocean floor. */
export const CRUST_MINIMUM_KM = 6.0;

/**
 * Continental crust as a share of the Earth's surface: about 41%.
 *
 * More than the 29% that is dry land, because the continental shelves are
 * continental crust that happens to be under water. Using the land fraction
 * here instead would drown every shelf in the world and leave no shallow sea
 * to fish, trade or invade across.
 */
export const CONTINENTAL_FRACTION = 0.41;

/**
 * How deep a continent is: the median point of Earth's land is about 600 km
 * from the sea, and the furthest -- the Eurasian pole of inaccessibility, in
 * Xinjiang -- is about 2,650.
 *
 * These are what a continent-generating field has to be checked against, and
 * they are why the craton field is only three octaves. At seven it produced
 * beautiful fractal coastlines around forty-three landmasses whose median
 * point was 417 km from water: an archipelago, not a world with continents in
 * it. The rain then had nowhere to dry out, every interior was forest, and the
 * climate calibration tried to fix it by cranking continentality to a 385 km
 * half-life -- against about 1,000 km measured across the Great Plains -- which
 * is what compensating for the wrong thing looks like.
 *
 * Compactness comes from the low frequencies; the coastline's roughness comes
 * from the elevation noise and the erosion on top. Asking one field to do both
 * gets neither.
 */
export const CONTINENT_MEDIAN_INLAND_KM = 600.0;
export const CONTINENT_MAX_INLAND_KM = 2650.0;

/**
 * Airy isostasy: the fraction of a crustal column that stands above the level
 * the mantle would settle at.
 *
 * One minus the density ratio, with continental crust at 2,700 kg/m3 and
 * mantle at 3,300: 1 - 2700/3300 = 0.1818. A column of crust floats with about
 * an eighth of itself proud, which is why 35 km of crust gives a continent a
 * few hundred metres of freeboard and not thirty kilometres of it.
 */
export const ISOSTATIC_FREEBOARD = 0.1818;

/**
 * The datum that turns freeboard into elevation, kilometres.
 *
 * Solved rather than chosen: standard continental crust must come out at
 * Earth's mean land elevation. 35 km at 0.1818 is 6.36 km of freeboard, and
 * mean land is 0.84 km above the sea, so the datum is 5.52.
 */
export const ISOSTATIC_DATUM_KM = 5.52;

/**
 * Sea floor deepens as it cools: depth = 2500 + 350*sqrt(age in Myr).
 *
 * The half-space cooling law, and it is measured on every ocean on Earth. A
 * ridge crest sits about 2,500 m down and hundred-million-year floor about
 * 6,000, and the square root is the signature of heat diffusing out of a slab
 * -- not a curve anybody fitted for looks.
 *
 * It is the reason an ocean basin has a shape at all rather than being a flat
 * bottom at one depth.
 */
export const RIDGE_CREST_DEPTH_M = 2500.0;
export const THERMAL_SUBSIDENCE_COEFF = 350.0;

/** Half-spreading rate, km per million years -- the same thing as mm/yr, and
 *  the middle of the measured range. Turns distance from a ridge into age. */
export const SPREADING_HALF_RATE_KM_PER_MYR = 40.0;

/**
 * How much crust a collision piles up, and how much an arc does, per unit of
 * convergence rate per step.
 *
 * FREE PARAMETERS in the sense that the step is not a year -- what is measured
 * is the RATIO and the end state. Continental collision doubles crustal
 * thickness: Tibet runs 70 km against a normal 35, and that is the thickest
 * crust on Earth. A volcanic arc thickens far less, which is why the Andes are
 * 6 km high and the Himalaya 8 with a plateau behind them.
 */
export const COLLISION_THICKENING_KM = 9.0;
export const ARC_THICKENING_KM = 2.2;

/** How much a rift thins the crust it pulls apart, on the same terms. */
export const RIFT_THINNING_KM = 3.0;

/**
 * How far a belt spreads inland per step, as a share of the neighbour average.
 *
 * A collision does not raise a line, it raises a belt: measured orogens run
 * 150 to 500 km wide, which at 49 km mesh cells is three to ten of them.
 */
export const OROGEN_SPREAD = 0.28;

/**
 * Relief the mesh adds on top of the tectonics, metres at the coarsest octave.
 *
 * Tectonics gives mountain belts and basins and nothing between them. This is
 * what stops every part of a continent's interior being the same height, and
 * it falls away with frequency at TOPOGRAPHY_HURST -- the same exponent the
 * gameplay ladder uses, because it is the same property of the same terrain.
 */
export const MESH_RELIEF_M = 900.0;

/**
 * How hard and how long the mesh is eroded.
 *
 * FREE PARAMETERS. The stream-power law and its exponents are measured (see
 * DENUDATION_TEMPERATE_M_PER_YR), but a pass is not a year and the aim here is
 * the shape a landscape settles into rather than a date. Twelve passes is
 * where the drainage stops reorganising.
 */
export const MESH_EROSION_PASSES = 8;
export const MESH_EROSION_RATE = 4.0e-5;
export const MESH_CREEP = 0.18;

// ---------------------------------------------------------------------------
// What grows, and how much of it there is
// ---------------------------------------------------------------------------

/**
 * The dry above-ground wood in one mature forest tree, tonnes.
 *
 * From allometry rather than from a stand count. A temperate broadleaf at 30 cm
 * diameter at breast height carries roughly half a tonne of dry above-ground
 * mass, and 30 cm is about the mean of a mature mixed stand once the
 * understorey stems are counted with the canopy ones.
 *
 * It is worth saying what this predicts, because nothing was tuned to make it
 * land there: a temperate forest at TIMBER_TEMPERATE_T_PER_HA carries
 * 150 / 0.5 = 300 stems a hectare, and mature temperate forests are measured at
 * 300 to 500. The stand density is a RESULT of the timber and the tree, not a
 * third number set beside them.
 */
export const TREE_WOOD_T = 0.5;

/**
 * The crown a tree of that size casts, metres across.
 *
 * Crown diameter runs about 25 times the stem diameter in open-grown broadleaf
 * and rather less where trees are crowded; 8 m at 30 cm dbh is the crowded
 * figure, which is the one a closed stand wants.
 */
export const TREE_CROWN_M = 8.0;

/** Dry above-ground wood in one mature shrub, kg. A hazel or a juniper of a
 *  few stems and a couple of metres, measured at 10 to 30 kg. */
export const SHRUB_WOOD_KG = 15.0;

/** And the crown it casts, metres. */
export const SHRUB_CROWN_M = 2.0;

/**
 * Dry wood in one liana, kg, and the crown it occupies.
 *
 * A liana puts almost nothing into its own stem and almost everything into
 * reaching a canopy it did not build: a 5 cm stem carries perhaps 20 kg while
 * spreading through several tree crowns. Its "crown" here is the canopy area it
 * occupies rather than anything it holds up.
 */
export const VINE_WOOD_KG = 20.0;
export const VINE_CROWN_M = 5.0;

/**
 * Dry mass of one grass plant, grams -- a tuft, not a tiller.
 *
 * A perennial bunchgrass carries a few grams of standing dry matter per tuft.
 * Against a temperate grassland's 300 to 500 g/m2 of above-ground biomass this
 * gives 100 to 170 tufts a square metre, which is what a hand-sized quadrat of
 * ordinary sward holds.
 */
export const GRASS_TUFT_G = 3.0;

/**
 * How long herbaceous growth stands before it is shed, years.
 *
 * One, near enough: a grass sward replaces its above-ground parts annually,
 * which is why standing biomass and annual production are the same number in a
 * grassland and are not remotely the same number in a forest.
 */
export const HERB_RESIDENCE_YR = 1.0;

// ---------------------------------------------------------------------------
// What a household burns and builds with
// ---------------------------------------------------------------------------

/**
 * Firewood burnt per person per year, kg of dry wood.
 *
 * The largest use of wood in any pre-industrial society by a wide margin, and
 * the one that decides how much woodland a village must keep. European
 * consumption before coal is reported at one to two cubic metres of solid wood
 * a head a year -- cooking every day, heating for half of it -- and at 600
 * kg/m3 for mixed air-dry hardwood that is 600 to 1,200 kg. A tonne is the
 * middle of it.
 *
 * It is worth seeing what this implies before believing it: a temperate wood
 * grows about 8 t/ha/yr, so ONE hectare feeds eight people's fires for ever,
 * and a village of two hundred needs twenty-five hectares of managed woodland.
 * That is why medieval woodland was coppiced, counted and fought over, and the
 * model producing it from a fuel figure and a growth rate rather than being
 * told it is the point.
 */
export const FIREWOOD_KG_PER_PERSON_YEAR = 1000.0;

/**
 * The timber in one house, cubic metres, and how long it stands.
 *
 * A timber-framed peasant house of the period takes ten to twenty cubic metres
 * of oak in its frame, and the frames last: surviving English examples are six
 * hundred years old and still holding a roof up. A hundred years is a
 * conservative service life for the purpose of an annual replacement rate.
 *
 * Building is a small demand next to burning, which is the historically
 * important part -- a village could not run out of house frames, and could very
 * easily run out of fuel.
 */
export const HOUSE_TIMBER_M3 = 15.0;
export const HOUSE_LIFE_YEARS = 100.0;
export const HOUSE_PEOPLE = 5.0;

/** Air-dry mixed hardwood, kg per cubic metre. Oak is 700, pine 500. */
export const WOOD_DENSITY_KG_M3 = 600.0;

// ---------------------------------------------------------------------------
// Grazing
// ---------------------------------------------------------------------------

/**
 * The standard livestock unit, kg: a mature cow.
 *
 * Herds are counted in these because a cow, an ox, five sheep and six pigs eat
 * about the same amount, and the thing that limits a settlement is the eating
 * rather than the animal. Five hundred kilogrammes is the figure agricultural
 * statistics have used for a century, and a medieval cow was smaller -- so a
 * herd counted here in units is more animals than it sounds.
 */
export const LIVESTOCK_UNIT_KG = 500.0;

/**
 * Dry matter a grazing animal eats daily, as a fraction of its own mass.
 *
 * Two and a half per cent, which is among the better-measured numbers in
 * animal husbandry and barely varies between ruminants: a cow, a sheep and a
 * deer all eat about a fortieth of themselves a day in dry fodder. It is set
 * by gut capacity and passage rate, not by species.
 */
export const INTAKE_DRY_FRACTION = 0.025;

/**
 * FREE PARAMETER: how much of the forage grown is actually eaten.
 *
 * Not all of it, and not for want of appetite. A grazing animal treads on some,
 * fouls some, and must leave enough leaf standing for the sward to regrow --
 * graze a pasture to the ground and it stops producing. Continuous grazing is
 * usually put at 40 to 60 per cent of production removed; rotational grazing
 * does better and neither medieval commons nor open range was rotational.
 *
 * A half is ours. GRAZEABLE_FRACTION already says what share of a place's
 * growth is within reach of something with hooves, which is a different
 * question -- that one is about the canopy, this one is about the sward.
 */
export const PASTURE_UTILISATION = 0.5;

// ---------------------------------------------------------------------------
// The shape of the year
// ---------------------------------------------------------------------------

/**
 * The tilt of the axis, degrees.
 *
 * The whole reason there is a year rather than a long unchanging day. Earth's
 * obliquity is 23.44 degrees and it is why the tropics are where they are --
 * the Tropic of Cancer is the latitude at which the sun reaches the zenith,
 * which is the tilt exactly, and the Arctic Circle is 90 minus the tilt, the
 * latitude at which the sun fails to rise at midwinter.
 *
 * Change this and you change the world: at zero there are no seasons at all,
 * and past 54 degrees the poles receive more annual sunlight than the equator
 * and the whole climate model turns inside out.
 */
export const AXIAL_TILT_DEG = 23.44;

/**
 * The solar constant, W/m2: sunlight arriving at the top of the atmosphere.
 *
 * Measured by satellite at 1361. Everything about how much a place grows
 * begins here, and the seasonal part of it is this number times the geometry
 * of a tilted sphere.
 */
export const SOLAR_CONSTANT_W_M2 = 1361.0;

/**
 * How far the warmest week lags the longest day, weeks.
 *
 * The sun is highest at midsummer and the hottest weather comes a month later,
 * because ground and air take time to warm and the surplus keeps accumulating
 * while days are still longer than nights. Over land the lag is measured at
 * three to five weeks; over ocean it is nearer eight, which is why maritime
 * summers are late and mild.
 *
 * Four weeks is the land figure, and this world's people live on land.
 */
export const THERMAL_LAG_WEEKS = 4.0;
