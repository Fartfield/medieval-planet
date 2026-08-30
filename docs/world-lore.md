# World lore

This file holds the things that are true about this world because we say so,
as opposed to the things that are true because they are measured. Everywhere
else in this project a number has to be derived from something real; here the
whole point is that it is not. Keeping the two apart is why this file exists.

## The storms

The poles are not ice. Each is a permanent storm, turning without season and
without pause, and they are the two places on the planet nobody has been.

Two pantheons live in them — one at each pole, opposed in everything, and
neither able to reach the other except across a world that lies between them.
What is visible from the ground is only the edge of that: the weather over each
pole is the outermost skirt of a god-quarrel that does not end.

The storms turn **opposite ways**. On a real planet that is Coriolis and needs
no explaining; here it is also the plainest possible statement that the two are
not the same thing. They are drawn in opposed palettes for the same reason —
the north cold, blue-white on slate; the south violet on near-black.

### What that costs the map, and why the cost is the point

**No land touches either storm.** The generator drowns the outermost row of
world cells outright, so the last thing before the wall of weather is open
water. That is not decoration: it is enforced in `drownStormMargin` in
`sim/gen/tectonics.ts`, and `verify_geometry` checks that none of the 78
cap-bordering cells is land.

The price is paid in latitude. Sine-latitude compresses towards the pole, so
the outermost row spans 56.8 to 77.6 degrees — meaning **this world has no land
above about 57 degrees at all.** There is no Scandinavia here and no Siberia.
The sea level is re-solved afterwards against Earth's land fraction, so that
land is not lost, it comes back further south; the world is the same size and
is simply arranged differently.

That follows from the rule rather than being chosen alongside it. A cell is
land or it is not, so "no land touches the caps" can only mean "the whole
outer row is sea", and near the pole one row is a great deal of latitude.

### Where they begin

The storms start at 77.58 degrees, and their angular radius is 12.42 degrees.

This *is* chosen, and it is worth being honest that it did not used to be. The
caps began as an artefact — a hex band wrapped around a sphere cannot reach the
poles, and whatever it failed to cover became ice by default. That left caps of
24.95 degrees, and the code made a small celebration of the band ending within
a degree and a half of the real polar circle, while admitting the coincidence
was luck.

The luck is spent. The caps are a place now, so their size is a decision, and
halving their width is what set the world grid's aspect at 14 rows to 39
columns. The arithmetic runs backwards from the wanted cap:
`BAND_SIN_LIMIT = 2.72070 x ROWS/COLS`, and nothing else in the grid affects
it. See `sim/geo/sphere.ts`.

## Free parameters here

The look of a storm is not measured, so these are ours and are labelled as such
in `client/src/render.ts`: three arms, a twist of 0.55, sixteen rings, and the
two palettes. The one thing borrowed from the real article is the *shape* — a
logarithmic spiral, which is what a cyclone's rainbands actually are, because a
band turns through a constant angle for each constant ratio of radius.
