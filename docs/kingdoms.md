# Kingdoms

## Nobody designs a border

A border is where two expansions met.

```
more workforce than work   →  a party leaves and founds a daughter
the daughter is in reach   →  it stays part of the same kingdom
the daughter is too far    →  it cannot be held, and is its own kingdom
nowhere free to go         →  expansion stops, and there is a frontier
                           →  and people start leaving instead
```

There is no settlement AI. There is a rule, and it is the same rule for a
player's town and an NPC one — the player can override it, nobody else needs
to. A `Polity` is an id, a name, a capital and a colour; it has no government,
no policy and no behaviour of its own.

## The two things that were already there

The trigger and the stopping condition both existed before this system did, for
completely different reasons.

**`limitedBy: 'land'`** was a diagnostic telling a player whether more settlers
would help. It turns out to be exactly the condition under which a real
settlement throws off a daughter: the ground would not grow what they set out
to grow, however many hands they put on it.

**The territory partition** exists so two towns cannot farm one field. Unchanged,
it is also the thing that makes expansion stop at a frontier.

## Why kingdoms have a size

A feudal levy owed **forty days** of service in the year. An army has to march
out, do something, and march back inside that. Give three eighths of the forty
days to each leg, at the column pace of 0.91 m/s over an eight-hour marching
day, and the radius of effective authority is **393 km**.

That is not a balance number. It is what forty days and a walking pace multiply
out to — and every term in it was already derived for something else, the march
rate from what a man carries and how fast he walks under it.

It is why medieval kingdoms were the size they were: why the Angevin empire was
a strain and Wessex was not, why a rebellion four hundred miles from the capital
usually won. A settlement founded beyond it **cannot be held**, so it is its own
kingdom from the day it is founded.

## Where a daughter goes

**Twice the parent's radius**, because of how the boundary actually falls. Land
goes to whoever is nearest, so the border between two settlements sits at the
*midpoint* — and a daughter placed at the edge of its mother's fields therefore
takes half of them.

This took four attempts and each failed differently:

| rule | what happened |
|---|---|
| twice the parent's *potential* reach | 6.2 km of clearance, wider than the search area. Expansion never happened at all |
| the founding party's needs alone (1.2 km) | the daughter got its ground; the parent kept a circle 600 m across. A town of 900 lost **seven eighths of its production in a year** to its own children |
| parent radius + daughter radius | still short — the midpoint of that distance is inside the parent's fields |
| **twice the parent radius** | both keep their land |

What made the workable version workable was not the formula. It was settlements
learning to farm what they need rather than every hectare they can reach, which
cut the parent's worked area fivefold — so a rule demanding 6.2 km now asks for
2.6.

**A founding party searches further than a farmer walks.** Using the catchment
deadlocked: a town that had filled its seven maps could see no ground but its
own, so it could never place a daughter, and expansion stopped dead at exactly
the moment population pressure was highest. The search now generates rings of
realm cells out to 3 rings — 37 maps — because a party leaving is not coming
back tonight.

## What a village plants

Not a year's eating — **a bad year's eating**. Medieval yields swung 30–50%
about their mean, so a village that sowed for an average year starved every time
the weather turned. Sowing at 1/0.65 of need is why there is a surplus in a good
year, and that surplus is what feeds a town, fills a granary and pays a tax.

Plus whatever the granary is still short, plus **what it sold last year** — a
farmer plants for last year's buyer. Without that last term a farming town grows
exactly what it needs, its population rises until it eats that, and the grain
feeding its neighbour's miners simply stops. Measured at year twelve, with the
miners going back to farming poor ground.

This also fixed the population runaway. Before it, a hundred people with land to
spare ploughed 5.5 km² and grew five times what they ate, migration was pulled
by four times the population in headroom, and towns exploded at 30% a year.

## Measured

One settlement of 120 on good savanna, ninety game-years, nothing else on the
continent:

| year | people | state | towns |
|---|---|---|---|
| 9 | 231 | fed, land to spare | 1 |
| 27 | 862 | fed | 1 |
| 36 | 1,412 | **land-limited** | 7 |
| 90 | 1,398 | land-limited, stable | 10 |

It grows into its land for thirty-six years, fills it, and then throws off
daughters — and the parent stays healthy at 1,397 people while it does. All ten
are still one kingdom, because all ten are well inside 393 km.

## Not here yet

**No conflict.** When two kingdoms meet, expansion simply stops. Invading,
conquest, concession and tribute are the next system — `Polity.tributaryTo`
exists and nothing sets it. Military strength should come out of what is already
here: fighting men spared from the fields, iron for their equipment, and grain
to keep them in the field, all of which the supply model already tracks.

**No NPC seeding.** The world starts empty and fills only from where a player
plants. Kingdoms that exist before you arrive need settlements generated at
their equilibrium for a realm nobody has visited, which is the same
generate-don't-store trick one layer up.

**Expansion is unfair by construction.** Settlements are considered in key
order, so if two want the same valley in the same week, whoever sorts first
takes it. A real race would have both parties set out and one arrive second.
