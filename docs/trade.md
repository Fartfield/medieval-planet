# Trade and specialisation

## What it unlocks

A town that cannot feed itself.

Before trade, every settlement had to grow its own food, so the only viable
sites were farmland and the ore in the mountains was decoration. With a route
to a grain surplus, a mining town on bare rock is a perfectly good idea.

Measured, on the same tile with the same seed:

| | alone | with a farming neighbour |
|---|---|---|
| hands farming | 100% | **5%** |
| iron made | none | **178 kg/turn** |
| grain imported | none | **353 kg/turn** |
| what it is | subsistence hamlet | ironworks |

Same ground, same people. The only difference is somebody to trade with.

## The rule that makes towns specialise

One rule, and it reads a diagnostic the supply model already produced:

* short of food and limited by **hands** → put more hands on the fields
* short of food and limited by **land** → more hands would not help. Put them
  in the mine and buy grain instead

A town on bare rock is land-limited from its first week, so it walks its farm
share down and becomes a mining town living on imports. A town on good soil is
hand-limited, keeps farming, and ends up feeding the miners. Neither was told
to. It is the same arithmetic reading two different pieces of ground.

Two guards on top of it:

**A full granary first.** A town that puts its hands in a mine before it has a
year of food starves in the first bad week.

**Unsold stock means stop making it.** There is no price in this project, so a
town cannot watch iron get cheaper — but it can watch the pile in the yard grow
while nobody comes for it. Without this the mine specialised forever and
accumulated 1.65 million kg of iron for a thousand people who needed a thousand
a year. A market signal does not have to be a price; it has to be a fact the
producer can observe.

## Territory

**Two settlements cannot both farm the same field.** A tile goes to whichever
settlement is nearest it.

That is a Voronoi partition, and it is also just what village territories were:
the boundary between two villages ran where the walk from one became longer
than the walk from the other, and the parish map of almost anywhere still shows
it.

Until this existed both towns built their catchment as though alone on the
continent. A farming town and a mining town two kilometres apart each counted
the whole valley, neither was ever short, and trade had nothing to do.

## How the market clears

Greedy nearest-source, worst shortage first. Each settlement short of a good
draws from whichever supplier delivers most cheaply, until it is satisfied or
the suppliers are dry.

Suppliers are ranked by the fraction that **arrives**, not by distance — which
is what makes water win. A river supplier three hundred kilometres away beats a
cart supplier at fifty.

It is not an optimal allocation; a proper transportation solve would do better.
It is deterministic — every tie broken down to the address key — and it produces
the behaviour that matters.

## Iron

Chosen as the second good because its whole chain was already on the map: ore
from the geology model, charcoal from the timber model, and what it buys feeds
straight back into supply. Nothing new had to be invented to close the loop.

**Making it** costs 0.88 man-days a kilogramme, added up across five measured
stages — digging, felling, charring, smelting, smithing — with the bloomery run
dominating. Three things bind output and the smallest wins: hands, ore richness,
and **wood**. Twenty kilogrammes of standing timber per kilogramme of iron, as
charcoal, and only the annual increment counts. That is usually the binding one,
and it is why ironworks moved when the woods gave out rather than when the ore
did.

**Buying it** takes 33% off the farming year — see below.

The check on the whole chain: at 0.88 man-days a kilogramme, one full-time
ironworker keeps **285 people** in tools, and a few hundred people to a smith is
what the manorial record shows. Nothing was tuned to produce that.

## The farming year

Rebuilt from measured task rates, job by job, because the first version was
wrong.

It had derived labour from the virgate — twelve hectares to a family with two
and a half workers giving 250 days each, so 52 man-days a hectare. That is
arithmetically fine and historically wrong: it assumes a villein family spent
all its labour on its own arable, and it spent nothing like all of it.
Week-work on the lord's demesne ran to two or three days in seven, and past
that there were the beasts, the croft, the woods, building and spinning.

So the number was roughly double what it should be, and settlements starved on
land that would have fed them.

Now it is added up from what the manorial accounts and Walter of Henley record
about how much ground each job covered in a day:

| task | rate | man-days/acre |
|---|---|---|
| ploughing, twice | 1 acre/team-day, team of 2 | 4.0 |
| harrowing | 1.5 acres/day | 0.7 |
| sowing | 2.5 acres/day | 0.4 |
| weeding | 0.5 acres/day | 2.0 |
| reaping | sickle 0.28, scythe 1.0 | 2.3 |
| binding | 0.5 acres/day | 2.0 |
| carting | 1 acre/day | 1.0 |
| **sown acre** | | **12.4** |

Historians put the full cycle at 10–15 man-days to a sown acre. Threshing is
separate because it scales with the *harvest* rather than the acreage — a flail
gets through about a quarter a day whatever the field looked like — so good
land costs more to thresh.

Per **held** hectare, with a third lying fallow and still being ploughed:
**22.8 man-days** with iron, **34.0** without.

### The virgate is now a check, and it passes

A virgate of 12 hectares comes to 274 man-days, which is **44%** of a family's
625. That leaves 351 days for week-work (75–110 of them), the beasts, the croft
and everything else a household owed and did. It fits — and that it fits is
what makes the rest trustworthy.

### What iron actually buys

The plough. An iron share and coulter cut a furrow slice a wooden ard can only
scratch, so an iron-shod team turns an acre a day where a wooden one manages
half. Add the scythe for the spring grains — three to four times a sickle — and
iron takes **33%** off the farming year.

The sickle survives for winter wheat and that is not backwardness: it cuts high,
holds the ear steady, loses far less grain to shattering, and leaves the long
straw that thatched the roof.

## Limits

**No river topology.** Water is used when both ends can take a boat, which lets
two settlements on *different* rivers barge to each other. Generous in the same
direction as the missing roads. The fix needs the cross-boundary work first.

**No trade restrictions.** Everybody trades with everybody. Alliances and
embargoes arrive with Houses.

**Only two goods.** Grain and iron. Timber, stone, salt and cloth are all
already generated on the map and none of them move.

**No prices and no money.** Deliberate — transport cost is denominated in the
cargo itself, so none was needed. It will be needed the moment a third good
competes with a second for the same hands.
