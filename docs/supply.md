# Supply

## Hauling food costs food

That is the whole model. The driver eats. The oxen eat. What they eat grew on
land that could have grown something else. Work it through and the cost of
transport comes out in the same units as the cargo — a fraction of the load
consumed per kilometre — with no price and no currency anywhere in it.

| | eaten per km | range | doubling |
|---|---|---|---|
| porter | 0.324% | 309 km | 154 km |
| ox cart | 0.131% | 761 km | 381 km |
| river barge | 0.0031% | 32,500 km | 16,300 km |

Every journey is round-trip: a cart fetching a harvest goes out loaded and
comes home empty, and the team eats on both legs. Costing only the loaded
kilometres made haulage 1.6× too cheap.

**Water is 42.7× cheaper than road.** That single ratio is why every great
pre-industrial city sits on water and none of them do not, why grain from Egypt
fed Rome while grain from two hundred miles inland did not, and why a river on
this map is worth more than a mountain of iron. The rivers the generator draws
stop being scenery here.

### Two independent checks

Nothing in the derivation was fitted to a target.

* **Diocletian's Price Edict** (301 AD) implies sea transport cost roughly a
  fortieth of road. The model gives **42.7**. This is the cleaner of the two
  checks, because it is a ratio and the round-trip factor cancels out of it.
* **Duncan-Jones**: a wagon-load of wheat about doubled in price over 300 miles
  (480 km). The model gives **381 km**, and it *should* come out lower — his
  figure is a price, and a price carries tolls, risk and somebody's profit on
  top of the food the oxen ate. A physical cost *above* a price-derived one
  would be the impossible result.

## What bounds a settlement

Two limits, with very different shapes. The difference between them is most of
what a player feels.

**Labour is the near limit.** Every hectare of arable needs about 52
person-days a year, and a worker walking to a distant field spends the day
walking. This falls off fast — 96% of a day survives a 1 km walk, 52% survives
12 km, nothing survives 25 km — and it is why settlements are compact.

**Transport is the far limit.** At two kilometres a cart loses under half a
percent. It only bites at the scale of feeding a city from another province,
which is exactly when water stops being scenery.

So a small settlement is **labour-limited** — more hands would help — and a
large one becomes **land-limited**, at which point more hands do not help and
it has to spread out or move. The inspector says which.

### Where the labour figure comes from

The virgate. A yardland was about 30 acres — 12 hectares — and it was the
holding that supported one peasant family. A family of five has about two and a
half working adults, each giving roughly 250 days a year once holy days are
out, so 625 person-days over 12 hectares is **52 days per hectare**. That is a
measured institution divided out, not a chosen number.

### Seed corn

Medieval yield ratios ran about 3.5 grains harvested per grain sown, so **29% of
every harvest goes straight back into the ground.** It is the single most
constraining number in a pre-industrial economy, and it is why a bad year did
not merely cause hunger — it ate the following year as well.

## What gets farmed

Every reachable tile is scored as **delivered grain per person-day** — what it
yields, less what the walk costs, less what the journey home eats — and the
settlement works down that list until its hands run out.

Ranking on a single number makes a rich distant tile and a poor near one
directly comparable, and sorting on it reproduces **von Thünen's rings**
without anything in the code mentioning a ring: intensive near, extensive far,
and the frontier pushing outward as the settlement grows. Select a settlement
in the client and its worked fields are drawn; that shape is not designed, it
is what the arithmetic produced.

## Growth

There is no population cap and no settlement cap. A settlement grows until it
runs out of hands, land or food.

**Births** run at the rates parish registers record, scaled by how well people
have been eating. The multiplier at full surplus is solved rather than chosen:
colonial America is the fastest a pre-industrial population ever grew from
births alone, at 3% a year, and reaching that against a 32-per-thousand death
rate needs births at 62 per thousand — 1.77× baseline.

**Migration** does most of the work, which is historically right: medieval
towns grew by immigration, not by birth, because urban death rates ran ahead of
urban birth rates almost everywhere. People move to where there is a surplus,
at 8% of the unfilled capacity per year. That rate is a **free parameter** and
is the one to revisit the moment migration between real settlements exists —
until then it stands in for the whole rest of the world.

Measured, on good land: 5 people → 52 in ten years → 1,277 in thirty → settling
around 3,100 against a carrying capacity of 3,143. A logistic curve, with the
constraint switching from labour to land at year 30. On marginal land the same
five people sit at exactly five, ration 0.99, indefinitely — subsistence,
neither growing nor dying. Which is what pre-industrial populations did for
centuries at a time.

## Limits of the current version

**Seven sub-maps.** A catchment spreads to the home ground map plus its six
neighbours — 35 km², enough for roughly three thousand people. Going further is
not a code change but a cost one: each map is 75 ms to generate, and a radius
covering the full 25 km commute limit would want three hundred of them. A
settlement that outgrows seven maps is the signal to build the incremental
version.

**No roads and no terrain cost.** A cart track is assumed passable between any
two land tiles, which is generous — real terrain has bogs and gorges. It is the
optimistic assumption, so settlements read as slightly better supplied than
they should.

**No backhaul.** Long-distance trade is cheaper than this model says, because a
cart on an established route carries something back. The round-trip figure is
right for a settlement fetching its own crop and pessimistic for trade.

**Harvest is averaged across the year.** The annual figure divided by 52. Real
grain arrives once, and the shape of a medieval year is about storing it and
not running out before the next one. Averaging makes famine a slow slide rather
than a cliff in March.
