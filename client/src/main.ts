// The client.
//
// It builds the entire world locally. The server sends a seed and a list of
// changed tiles; everything else -- the planet, the realm maps, the ground
// maps, the soil under every tile -- is generated here from the same `sim/`
// code the server runs. That is why the wire carries kilobytes for a world of
// a trillion tiles.
//
// And it is why the client hashes each region it opens and sends the
// fingerprint up. If the two ever generate different worlds from the same
// seed, the server says so within a second rather than a month.

import { World } from '../../sim/world.ts';
import { regionFingerprint } from '../../sim/turn.ts';
import {
  toKey, fromKey, GROUND_DEPTH, MAX_DEPTH, LAYER_NAMES, equals,
} from '../../sim/geo/address.ts';
import { CELL_COUNT, neighbours as globeNeighbours } from '../../sim/geo/sphere.ts';
import { toDirection, toLocal, type SubMap } from '../../sim/gen/submap.ts';
import { SUBCELL_COUNT } from '../../sim/geo/hexgrid.ts';
import { BIOME_NAMES, BIOME_COLOURS, Biome } from '../../sim/model/biome.ts';
import { LANDFORM_NAMES } from '../../sim/model/tile.ts';
import { MINERAL_NAMES } from '../../sim/model/resources.ts';
import { ROCK_NAMES } from '../../sim/model/rock.ts';
import { workedCells } from '../../sim/model/settlement.ts';
import { Mineral } from '../../sim/model/resources.ts';
import { ironOutputKgPerYear, IRON_LABOUR_SAVING } from '../../sim/model/labour.ts';
import { GRAIN_PER_PERSON_YEAR } from '../../sim/economy.ts';
import { NAVIGABLE_M3_PER_S } from '../../sim/derive.ts';
import { IRON_PER_PERSON_KG_PER_YEAR } from '../../sim/anchors.ts';
import type { TileDelta } from '../../sim/model/tile.ts';
import type { ServerMessage, PlayerInfo } from '../../server/protocol.ts';
import type { Polity } from '../../sim/model/polity.ts';
import { AUTHORITY_REACH_KM } from '../../sim/model/polity.ts';
import {
  newCamera, globeView, flatView, drawGlobe, drawSubMap,
  pickGlobe, pickAmong, mapIsVisible, houseColour, blendColours, TINT_MIN_PX, MOSAIC_MIN_PX,
  type Frame,
  type ChildLookup,
  type Camera, type CellTint,
} from './render.ts';

// --- state ------------------------------------------------------------------

let world: World | null = null;
let playerId = -1;
let players: PlayerInfo[] = [];
let polities: Polity[] = [];
let turn = 0;
let turnSeconds = 120;
let nextTurnAt = 0;
const checkedRegions = new Set<number>();

/** The path currently being looked at. Empty is the globe. */
let path: number[] = [];
let selected = -1;
const cam: Camera = newCamera();

const canvas = document.getElementById('canvas') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
let socket: WebSocket | null = null;

// --- logging ----------------------------------------------------------------

const logEl = document.getElementById('log')!;
function log(text: string, kind = ''): void {
  const line = document.createElement('div');
  if (kind) line.className = kind;
  line.textContent = text;
  logEl.appendChild(line);
  while (logEl.childElementCount > 60) logEl.firstElementChild!.remove();
  logEl.scrollTop = logEl.scrollHeight;
}

// --- networking -------------------------------------------------------------

function connect(): void {
  const name = localStorage.getItem('name')
    ?? `player-${Math.floor(Math.random() * 9000 + 1000)}`;
  localStorage.setItem('name', name);

  socket = new WebSocket(`ws://${location.host}`);

  socket.onopen = () => {
    socket!.send(JSON.stringify({ t: 'hello', version: 1, name }));
  };

  socket.onmessage = (ev) => {
    const msg = JSON.parse(ev.data as string) as ServerMessage;
    handle(msg);
  };

  socket.onclose = () => {
    setLive(false);
    log('disconnected, retrying in 2s', 'warn');
    setTimeout(connect, 2000);
  };

  socket.onerror = () => setLive(false);
}

function handle(msg: ServerMessage): void {
  switch (msg.t) {
    case 'welcome': {
      playerId = msg.playerId;
      players = msg.players;
      polities = msg.polities ?? [];
      turn = msg.turn;
      turnSeconds = msg.turnSeconds;
      nextTurnAt = performance.now() + turnSeconds * 1000;

      // The whole map, from one number.
      const t0 = performance.now();
      world = new World({ seed: msg.seed, radiusM: msg.radiusM });
      world.turn = msg.turn;
      world.loadDeltas(msg.deltas);
      log(`world ${msg.seed} built locally in ${Math.round(performance.now() - t0)} ms`);
      log(`${CELL_COUNT} regions, ${world.totalCellsAt(GROUND_DEPTH).toLocaleString('en')} ground tiles`);
      log(`${MAX_DEPTH} layers: ${LAYER_NAMES.join(' > ')}`);
      log(`each hex is tinted by its own ${SUBCELL_COUNT} children, one layer only`);
      log(`${msg.deltas.length} changed tile(s) received`);

      setLive(true);
      (document.getElementById('who') as HTMLElement).textContent =
        `${players.find((p) => p.id === playerId)?.name ?? 'you'} (#${playerId})`;
      refresh();
      break;
    }

    case 'turn':
      turn = msg.turn;
      players = msg.players;
      polities = msg.polities ?? polities;
      nextTurnAt = performance.now() + msg.nextIn * 1000;
      if (world !== null) {
        world.turn = msg.turn;
        applyDeltas(world, msg.changed);
      }
      if (msg.changed.length > 0) log(`turn ${turn}: ${msg.changed.length} tile(s) changed`);
      refresh();
      break;

    case 'ack':
      if (!msg.ok) log(`rejected: ${msg.reason ?? 'no reason given'}`, 'warn');
      break;

    case 'desync':
      log(`DESYNC in region ${msg.region}: server ${msg.serverHash.toString(16)}, `
        + `we generated ${msg.clientHash.toString(16)}`, 'bad');
      break;

    case 'error':
      log(`server: ${msg.reason}`, 'warn');
      break;
  }
}

/**
 * Apply the turn's changes. A delta with no fields is a tombstone -- the tile
 * was abandoned or everyone on it died -- and clears ours rather than merging
 * into it, which would leave a ghost owner behind forever.
 */
function applyDeltas(w: World, deltas: TileDelta[]): void {
  for (const d of deltas) {
    const address = fromKey(d.key);
    const empty = d.owner === undefined && d.population === undefined
      && d.populationHealth === undefined && d.soilHealth === undefined
      && d.cleared === undefined && d.depleted === undefined;
    if (empty) {
      w.setDelta(address, {
        owner: undefined, population: undefined, populationHealth: undefined,
        soilHealth: undefined, cleared: undefined, depleted: undefined,
      });
    } else {
      w.setDelta(address, d);
    }
  }
}

function order(action: 'claim' | 'settle' | 'abandon', target: string, amount?: number): void {
  if (socket === null || socket.readyState !== WebSocket.OPEN) {
    log('not connected', 'warn');
    return;
  }
  socket.send(JSON.stringify({ t: 'order', action, target, amount }));
  log(`${action} ${target}${amount ? ` x${amount}` : ''} - queued for turn ${turn + 1}`);
}

function setLive(live: boolean): void {
  const dot = document.getElementById('dot')!;
  dot.className = live ? 'live' : '';
  if (!live) (document.getElementById('who') as HTMLElement).textContent = 'offline';
}

// --- what is on screen ------------------------------------------------------

/**
 * The maps drawn around the one in the middle.
 *
 * A tile used to be shown alone, which made every map an island: you could not
 * see what your land bordered without leaving it, and the edge of the picture
 * was the edge of the world rather than the edge of a tile.
 *
 * Two sources, because adjacency is two different things. On the globe a
 * region's neighbours are the geodesic grid's own -- six of them, five at a
 * pentagon -- and that is a fixed table. Below the globe, adjacency is decided
 * by DISTANCE (see World.neighboursOf), so a tile on a map seam can have more
 * than six neighbours and that is the truth of the ground rather than a fault.
 * Either way it is the world that answers, not the renderer.
 */
function neighbourMapsOf(w: World, at: readonly number[]): number[][] {
  if (at.length === 0) return [];
  if (at.length === 1) {
    const out: number[][] = [];
    for (let i = 0; i < 6; i++) {
      const nb = globeNeighbours[at[0] * 6 + i];
      if (nb >= 0) out.push([nb]);
    }
    return out;
  }
  return w.neighboursOf(at as number[]) as number[][];
}

/**
 * FREE PARAMETER: how far the picture reaches, in maps.
 *
 * One means the middle map and the ring touching it, which is what the view
 * showed when neighbours were first drawn. Five means every map within five
 * steps -- up to ninety-one of them -- so the ground runs well past the edge
 * of the window at ordinary zoom and panning does not walk off the end of it.
 *
 * Nothing measures where this should sit. It is bounded below by wanting to
 * see past the tile you are on, and above by what it costs to generate maps
 * that are then culled off-screen. Five is ours.
 */
const VIEW_RANGE = 5;

/**
 * The maps DRAWN around the middle one, which is not the same set as the maps
 * that can be navigated to.
 *
 * Two rules, and both are about what can honestly be drawn together.
 *
 * SAME REGION ONLY. Everything descended from one region is a single lattice
 * -- the rosette turn carries the region's grain all the way down, and two
 * adjoining maps inside a region measure 0.02 degrees out of parallel at the
 * median. Maps in a DIFFERENT region are on a different lattice: the globe is
 * not a lattice, its neighbour bearings depart from a 60-degree one by up to
 * 20.45 degrees, and those maps arrive turned by up to 23 degrees and offset
 * by several tiles. Drawing them is drawing a tiling that does not exist, so
 * the picture stops at the region's edge. See docs/fix-attempts.md.
 *
 * NOT AT THE REGION LAYER AT ALL, for the same reason taken to its conclusion:
 * there, every neighbour IS another region.
 *
 * Generating a map that is then culled off-screen is not free, but it is far
 * from the cost of drawing it: drawSubMap culls each cell before asking for
 * its children, so a map beyond the window costs one map and no tiles.
 */
let drawnCacheKey = '';
let drawnCache: number[][] = [];

function drawnMapsOf(w: World, at: readonly number[]): number[][] {
  if (at.length <= 1) return [];
  // The set only changes when the middle map does, and asking the world for it
  // is a descent per candidate -- 0.30 ms, which is small until it is paid
  // sixty times a second for an answer that has not changed.
  const key = toKey(at as number[]);
  if (key === drawnCacheKey) return drawnCache;
  const parent = w.subMap((at as number[]).slice(0, -1));
  const here = w.tile(at as number[]).dir;
  // A little past the range, so a map exactly at the limit is not lost to
  // rounding in the distance test.
  const reach = parent.spacingM * (VIEW_RANGE + 0.35);
  const near = w.cellsWithin(here[0], here[1], here[2], reach, at.length, 4096);
  const mine = toKey(at as number[]);
  drawnCacheKey = key;
  drawnCache = near.filter((a) => a[0] === at[0] && toKey(a) !== mine) as number[][];
  return drawnCache;
}

/**
 * Put a different map in the middle without the picture moving.
 *
 * Walking off one tile onto the next has to be seamless or it is not walking,
 * it is teleporting. Two things would jump if they were not corrected here.
 *
 * The SHIFT: the picture is drawn in the middle map's terms, so its centre
 * sits at the pan origin. Give the middle to a neighbour and that neighbour's
 * centre becomes the origin, which slides everything by the distance between
 * the two. Pan by exactly that distance and nothing moves.
 *
 * The TURN: each map's basis faces its own first neighbour, and that is a
 * different direction for each map, so the new frame is rotated relative to
 * the old one -- by up to sixty degrees. The view's own turn absorbs it. See
 * Camera.rot.
 *
 * Both are read off the projection rather than assumed, the same way the cells
 * are placed.
 */
function focusOn(w: World, next: readonly number[]): void {
  if (world === null || path.length === 0 || equals(next as number[], path)) return;
  const view = flatView(window.innerWidth, window.innerHeight, cam);
  const here = w.subMap(path);
  const there = w.subMap(next as number[]);
  const perUnit = view.size / here.cellRadiusRad;

  const o = toLocal(here.basis, there.basis.ox, there.basis.oy, there.basis.oz);
  const vr = (cam.rot * Math.PI) / 180;
  const vc = Math.cos(vr);
  const vs = Math.sin(vr);
  cam.panX += (o.x * vc - o.y * vs) * perUnit;
  cam.panY += (o.x * vs + o.y * vc) * perUnit;

  // The angle the new map's own x-axis makes in the old map's terms, which is
  // exactly what the view has to take on to leave the picture where it is.
  const probe = new Float64Array(3);
  toDirection(there.basis, there.cellRadiusRad * 0.1, 0, probe, 0);
  const px = toLocal(here.basis, probe[0], probe[1], probe[2]);
  cam.rot += (Math.atan2(px.y - o.y, px.x - o.x) * 180) / Math.PI;

  path = next as number[];
  // The selection was an index into the map that just stopped being the middle
  // one, and index 40 of a different map is a different acre. The click path
  // sets it again straight after; scrolling simply drops it.
  selected = -1;
  refresh();
}

/** The frame every map in the flat view is drawn in the terms of. */
function frameFor(w: World): Frame {
  const middle = w.subMap(path);
  return { basis: middle.basis, cellRadiusRad: middle.cellRadiusRad, rotDeg: cam.rot };
}

/**
 * The point of the sphere under a pixel, in the flat view.
 *
 * The inverse of what the renderer does, and it has to be, or a click lands on
 * a tile other than the one under the cursor. Undo the pan, undo the view's
 * turn, scale back into the frame's own units, and project.
 */
function directionAt(w: World, sx: number, sy: number): Float64Array {
  const view = flatView(window.innerWidth, window.innerHeight, cam);
  const middle = w.subMap(path);
  const perUnit = view.size / middle.cellRadiusRad;
  const dx = sx - view.cx;
  const dy = sy - view.cy;
  const vr = (-cam.rot * Math.PI) / 180;
  const vc = Math.cos(vr);
  const vs = Math.sin(vr);
  const out = new Float64Array(3);
  toDirection(middle.basis,
    (dx * vc - dy * vs) / perUnit, (dx * vs + dy * vc) / perUnit, out, 0);
  return out;
}

/**
 * Hand the middle to whichever tile the window is actually looking at.
 *
 * Called after every pan. The tile under the middle of the window is the one
 * being looked at, so it is the one the picture should be drawn in the terms
 * of -- and because the swap is seamless, the player never sees it happen.
 * They just keep scrolling, and the ground keeps going.
 *
 * At every layer, by construction: `addressAt` descends from the globe to
 * whatever depth it is asked for, so this is the same three lines for a region
 * and for a yard.
 */
function followTheView(w: World): void {
  if (path.length === 0) return;
  const d = directionAt(w, window.innerWidth / 2, window.innerHeight / 2);
  const here = onScreen(w);
  const hit = pickAmong(here.maps, d[0], d[1], d[2]);
  // Index 0 is the map already in the middle, and pickAmong offers it first,
  // so this only fires once the view has genuinely left it.
  if (hit !== null && hit.map > 0) focusOn(w, here.addrs[hit.map]);
}

/** The maps in the picture, the middle one first. */
function onScreen(w: World): { addrs: number[][]; maps: SubMap[] } {
  const addrs = [path as number[], ...neighbourMapsOf(w, path)];
  return { addrs, maps: addrs.map((a) => w.subMap(a)) };
}


/**
 * The deltas that fall inside the view, grouped by the cell they sit in.
 *
 * On the globe a delta three layers down still has to show, so its address is
 * truncated to the region and claims are counted there. That is what makes a
 * settlement visible from orbit as a coloured border rather than only when you
 * have zoomed all the way in on it.
 */
function visibleOverlays(
  w: World, at: readonly number[] = path,
): { owned: Map<number, number>; populated: Map<number, number> } {
  const owned = new Map<number, number>();
  const populated = new Map<number, number>();
  const depth = at.length;

  for (const d of w.allDeltas()) {
    const address = fromKey(d.key);
    if (address.length <= depth) continue;
    let matches = true;
    for (let i = 0; i < depth; i++) if (address[i] !== at[i]) { matches = false; break; }
    if (!matches) continue;

    const cell = address[depth];
    if (d.owner !== undefined && d.owner >= 0) {
      // Owner is a polity now, not a player. An NPC kingdom draws its border
      // exactly the way a player's does, because to every rule in the
      // simulation they are the same kind of thing.
      const house = polities.find((p) => p.id === d.owner)?.house ?? d.owner;
      owned.set(cell, house);
    }
    if (d.population) populated.set(cell, (populated.get(cell) ?? 0) + d.population);
  }
  return { owned, populated };
}

/**
 * Every map's overlays at one depth, built in a single pass.
 *
 * The same grouping visibleOverlays does for one map, done once for all of
 * them: a delta's address says which map it belongs to, so one walk over the
 * deltas fills every map's buckets at once. What was a hundred and twenty
 * walks of a growing list per frame is one.
 */
function overlayIndex(
  w: World, depth: number,
): Map<string, { owned: Map<number, number>; populated: Map<number, number> }> {
  const out = new Map<string, { owned: Map<number, number>; populated: Map<number, number> }>();
  for (const d of w.allDeltas()) {
    const address = fromKey(d.key);
    if (address.length <= depth) continue;
    const key = toKey(address.slice(0, depth));
    let bucket = out.get(key);
    if (bucket === undefined) {
      bucket = { owned: new Map<number, number>(), populated: new Map<number, number>() };
      out.set(key, bucket);
    }
    const cell = address[depth];
    if (d.owner !== undefined && d.owner >= 0) {
      const house = polities.find((p) => p.id === d.owner)?.house ?? d.owner;
      bucket.owned.set(cell, house);
    }
    if (d.population) bucket.populated.set(cell, (bucket.populated.get(cell) ?? 0) + d.population);
  }
  return out;
}

/**
 * What colour a cell should be, given the land one layer below it.
 *
 * Each cell is painted as itself -- one hexagon -- but coloured by the average
 * of its own 91 children, so a region that is half desert and half steppe
 * reads as neither. That puts real geography on the world map without it
 * resolving anything below the layer beneath it.
 *
 * Cached by address, because the blend never changes: the children are a pure
 * function of the seed. Without the cache this would regenerate 91 sub-maps
 * per visible cell per frame.
 */
const tintCache = new Map<string, string>();

function tintFor(w: World, at: number[]): CellTint | null {
  if (at.length >= MAX_DEPTH - 1) return null;

  return (cell: number) => {
    const address = [...at, cell];
    const key = toKey(address);
    const hit = tintCache.get(key);
    if (hit !== undefined) return hit;

    let map;
    try {
      map = w.subMap(address);
    } catch {
      return null;
    }

    // The map's own cell count, not 91. A pentagon's map holds 76, and reading
    // past the end blended fifteen undefined biomes into every pentagon's
    // colour.
    const colours: string[] = [];
    for (let c = 0; c < map.patch.count; c++) {
      colours.push(map.elevationM[c] < 0 ? OCEAN_COLOUR : BIOME_COLOURS[map.biome[c]]);
    }
    const blended = blendColours(colours);
    tintCache.set(key, blended);
    return blended;
  };
}

/** The colour water is drawn in, so a blend can mix it like any other cover. */
const OCEAN_COLOUR = BIOME_COLOURS[Biome.Ocean];

/**
 * The map one layer below a cell, for drawing that cell out of its own tiles.
 *
 * The renderer is not allowed to reach into the world -- see
 * docs/architecture.md -- so it asks, and this answers. It hands back the
 * generated sub-map directly rather than a copy: the renderer only reads it,
 * and the World's own cache is what keeps a second frame cheap.
 *
 * Nothing is cached here on purpose. `World.subMap` already holds 16,384 maps,
 * which is several screens' worth, and a second cache in front of it would
 * only be a way to get the two out of step.
 */
function childrenFor(w: World, at: number[]): ChildLookup | null {
  if (at.length >= MAX_DEPTH - 1) return null;
  return (cell: number) => {
    try {
      return w.subMap([...at, cell]);
    } catch {
      return null;
    }
  };
}

/**
 * The fields a selected settlement is actually working, for the renderer.
 *
 * Only computed when a populated tile is selected on a ground map, because a
 * catchment is tens of thousands of tiles and rebuilding it every frame would
 * be absurd. The World caches it, so panning around a selected settlement is
 * free after the first frame.
 */
function workedOverlay(w: World): Map<number, number> | null {
  if (path.length !== GROUND_DEPTH || selected < 0) return null;
  const address = [...path, selected];
  const tile = w.tile(address);
  if (tile.population <= 0) return null;
  const delta = w.getDelta(address);
  const farmShare = delta?.farmShare ?? 1;
  const yearIron = tile.population * IRON_PER_PERSON_KG_PER_YEAR;
  const ironSupply = yearIron <= 0 ? 1 : Math.min(1, (delta?.ironStock ?? 0) / yearIron);
  return workedCells(
    w.catchmentFor(address, tile.population), tile.population, 0,
    ironSupply, farmShare, neighboursOf(w, address));
}

// --- drawing ----------------------------------------------------------------

function resize(): void {
  invalidate();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.floor(window.innerWidth * dpr);
  canvas.height = Math.floor(window.innerHeight * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

/**
 * Whether the picture needs drawing again.
 *
 * The loop used to redraw every frame whether or not anything had changed,
 * which on the world view is 23,500 filled polygons and 30 ms of geometry
 * sixty times a second, for a picture identical to the one already on screen.
 * A globe sitting still cost as much as one being dragged.
 *
 * Everything that can change what is on screen sets this. Nothing else draws.
 */
let dirty = true;

function invalidate(): void {
  dirty = true;
}

/**
 * THE TILES ARE NEVER RATIONED, and the note is here because they were.
 *
 * A view that was moving used to be drawn without its mosaic -- cells in their
 * blended colour instead of out of their own children -- on the reasoning that
 * a tile a few pixels across is not distinguishable from that blend while it
 * is sliding past. The reasoning is fine and the result was not: the world
 * view is the one place a player most wants to see the ground it is made of,
 * and rationing it there meant sometimes not seeing it at all.
 *
 * It is affordable now without the trade. Two changes paid for it -- nothing
 * redraws unless something changed, and tilePolygons stopped taking half a
 * million transcendentals a frame -- which took the world view from 29.8 ms a
 * frame to 11.8, and an idle one from 29.8 to nothing.
 */

/** Called by anything that moves the view: pan, zoom, spin. */
function moved(): void {
  invalidate();
}

/** Said once, the first time the world view is drawn. */
let saidGlobe = false;

function frame(): void {
  requestAnimationFrame(frame);

  // The countdown is DOM and costs nothing, so it keeps ticking whether or not
  // the canvas is redrawn.
  const remaining = Math.max(0, Math.round((nextTurnAt - performance.now()) / 1000));
  (document.getElementById('next') as HTMLElement).textContent = `${remaining}s`;

  if (!dirty) return;
  dirty = false;

  try {
    draw();
  } catch (err) {
    // A THROWN FRAME USED TO FREEZE THE PICTURE, and that is a hazard the
    // dirty flag introduced. Before it, every frame redrew, so a one-off
    // failure healed itself on the next one and nobody ever saw it; now the
    // frame that throws has already cleared `dirty`, so nothing draws again
    // until the next input and the canvas keeps whatever was on it when the
    // exception happened -- which looks exactly like a feature quietly not
    // working rather than like an error.
    ctx.fillStyle = '#e06c5a';
    ctx.font = '13px ui-monospace, monospace';
    ctx.fillText(`frame failed: ${(err as Error).message}`, 20, 40);
    if (!saidError) {
      saidError = true;
      log(`frame failed: ${(err as Error).message}`);
    }
  }
}

/** Said once, so a failing frame does not fill the log sixty times a second. */
let saidError = false;

function draw(): void {

  const w = window.innerWidth;
  const h = window.innerHeight;
  ctx.fillStyle = '#14161a';
  ctx.fillRect(0, 0, w, h);

  if (world === null) {
    ctx.fillStyle = '#6b665d';
    ctx.font = '13px ui-monospace, monospace';
    ctx.fillText('building the world...', 20, h - 20);
    invalidate();
    return;
  }

  const { owned, populated } = visibleOverlays(world);

  if (path.length === 0) {
    const drawn = drawGlobe(ctx, world.planet, cam, globeView(w, h), selected, owned,
      tintFor(world, []), childrenFor(world, []));
    // ONCE, not every frame. "The world view is not showing its tiles" and
    // "the world view is showing its tiles" look identical from here, and
    // three attempts to tell them apart by reading the code were all wrong.
    if (!saidGlobe) {
      saidGlobe = true;
      log(`world view: ${drawn.regions} regions, ${drawn.mosaics} drawn from their own`
        + ` tiles, tile ${drawn.tilePx.toFixed(1)} px, lookup ${drawn.offered ? 'given' : 'MISSING'}`);
    }
  } else {
    const view = flatView(w, h, cam);
    const frame = frameFor(world);

    // NEIGHBOURS, EXCEPT AT THE REGION LAYER, and the exception is the whole
    // of what can honestly be done about layer 2 for now.
    //
    // Every layer below this one draws neighbours that are children of the
    // same map, so they and the middle map are ONE lattice and they mesh:
    // measured, two adjoining maps inside a region are 0.02 degrees out of
    // parallel at the median and 0.11 at the worst.
    //
    // A region's neighbours are other REGIONS, children of the globe, and the
    // globe is not a lattice -- its neighbour bearings depart from a 60-degree
    // lattice by up to 20.45 degrees. So those maps arrive turned against this
    // one by up to 23 degrees and offset by several tiles, and drawing them is
    // drawing a tiling that does not exist. Four ways of choosing a better
    // orientation were tried and measured; the best halved it and none removed
    // it, and the reason is structural rather than a bug to find. See
    // docs/fix-attempts.md.
    //
    // So at the region layer the picture shows the region, exactly, and stops.
    // A hard edge is a true statement about where this grid can still tile;
    // tiles at 23 degrees to their neighbours are not. Everything below draws
    // its neighbours as before, because there they are real.
    //
    // Navigation is untouched: onScreen still returns the neighbouring maps, so
    // scrolling onto one still hands it the middle and clicking one still
    // finds it. They are not DRAWN, they are still there.
    if (path.length > 1) {
      // ONE PASS OVER THE DELTAS FOR ALL THE MAPS, not one pass each.
      //
      // visibleOverlays walks every delta in the world to find the ones under
      // a given map. Called per drawn map that is a hundred and twenty walks
      // of the same list every frame, and the list is the part of the world
      // that grows as the game is played -- so the view would get slower the
      // longer anyone played it, which is the wrong way round.
      const index = overlayIndex(world, path.length);
      const empty = { owned: new Map<number, number>(), populated: new Map<number, number>() };
      for (const nb of drawnMapsOf(world, path)) {
        const map = world.subMap(nb);
        // Off screen entirely: no placement, no overlay lookup, no cell loop.
        if (!mapIsVisible(map, frame, view, w, h)) continue;
        const side = index.get(toKey(nb)) ?? empty;
        drawSubMap(ctx, map, view, -1, side.owned, side.populated,
          null, tintFor(world, nb), childrenFor(world, nb), frame);
      }
    }

    drawSubMap(ctx, world.subMap(path), view, selected, owned, populated,
      workedOverlay(world), tintFor(world, path), childrenFor(world, path), frame);
  }

}

// --- interaction ------------------------------------------------------------

let dragging = false;
let dragged = false;
let lastX = 0;
let lastY = 0;

canvas.addEventListener('mousedown', (e) => {
  dragging = true; dragged = false; lastX = e.clientX; lastY = e.clientY;
});

window.addEventListener('mouseup', () => { dragging = false; });

window.addEventListener('mousemove', (e) => {
  if (!dragging) return;
  const dx = e.clientX - lastX;
  const dy = e.clientY - lastY;
  // A few pixels of slop, so a click with a shaky hand is still a click.
  if (Math.abs(dx) + Math.abs(dy) > 2) dragged = true;
  lastX = e.clientX; lastY = e.clientY;

  if (path.length === 0) {
    cam.yaw -= dx * 0.006;
    cam.pitch = Math.max(-1.4, Math.min(1.4, cam.pitch + dy * 0.006));
  } else {
    cam.panX += dx;
    cam.panY += dy;
    // Scroll far enough and the tile you are looking at is a different one.
    if (world !== null) followTheView(world);
  }
  moved();
});

canvas.addEventListener('wheel', (e) => {
  if (path.length === 0) return;
  e.preventDefault();
  const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
  cam.zoom = Math.max(0.35, Math.min(24, cam.zoom * factor));
  moved();
}, { passive: false });

canvas.addEventListener('click', (e) => {
  if (dragged || world === null) return;
  const w = window.innerWidth;
  const h = window.innerHeight;

  if (path.length === 0) {
    const dir = pickGlobe(cam, globeView(w, h), e.clientX, e.clientY);
    if (dir === null) { selected = -1; refresh(); return; }
    selected = world.regionAt(dir[0], dir[1], dir[2]);
  } else {
    // Asked of the WORLD rather than of the middle map's lattice. Picking used
    // to invert one map's flat hex grid, which can only ever name a cell of
    // THAT map -- so with neighbours on screen, clicking one would name
    // whichever cell of the middle map lay in the same direction, or nothing
    // at all. Descending from the globe names the tile that is actually there,
    // in whichever map holds it, and the view then moves to that map.
    const d = directionAt(world, e.clientX, e.clientY);
    const here = onScreen(world);
    const hit = pickAmong(here.maps, d[0], d[1], d[2]);
    if (hit === null) {
      selected = -1;
    } else {
      // Clicking a neighbour hands it the middle, which is the same move
      // scrolling into it makes -- one way to change what you are looking at,
      // reached two ways.
      focusOn(world, here.addrs[hit.map]);
      selected = hit.cell;
    }
  }
  refresh();
});

canvas.addEventListener('dblclick', (e) => {
  if (world === null || selected < 0) return;
  e.preventDefault();
  descend();
});

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' || e.key === 'Backspace') { ascend(); }
  if (e.key === 'Enter') descend();
});

function descend(): void {
  if (world === null || selected < 0) return;
  // Down to the finest layer the ladder has. Below the plot layer nothing is
  // simulated -- a yard and a pace are generated ground with no economy on
  // them -- but they are real cells and can be looked at.
  if (path.length >= MAX_DEPTH - 1) {
    log(`${LAYER_NAMES[MAX_DEPTH - 1]} is the finest layer there is`);
    return;
  }
  path = [...path, selected];
  cam.panX = 0; cam.panY = 0; cam.zoom = 1; cam.rot = 0;
  selected = -1;

  // Opening a region is the moment to check that we and the server built the
  // same one. Once per region per session; the answer cannot change.
  if (path.length === 1 && !checkedRegions.has(path[0])) {
    checkedRegions.add(path[0]);
    const hash = regionFingerprint(world, path[0]);
    socket?.send(JSON.stringify({ t: 'hash', region: path[0], hash }));
  }
  refresh();
}

function ascend(): void {
  if (path.length === 0) return;
  selected = path[path.length - 1];
  path = path.slice(0, -1);
  cam.panX = 0; cam.panY = 0; cam.zoom = 1; cam.rot = 0;
  refresh();
}

// --- panels -----------------------------------------------------------------

const LAYER_LABEL = ['world', 'region', 'realm', 'ground'];

function refresh(): void {
  invalidate();
  drawCrumbs();
  drawInspector();
  drawLegend();

  (document.getElementById('turn') as HTMLElement).textContent = String(turn);
  if (world !== null) {
    let people = 0;
    let settled = 0;
    for (const d of world.allDeltas()) {
      people += d.population ?? 0;
      if (d.owner !== undefined && d.owner >= 0) settled++;
    }
    (document.getElementById('people') as HTMLElement).textContent =
      Math.round(people).toLocaleString('en');
    (document.getElementById('tiles') as HTMLElement).textContent = String(settled);
    const mine = polities.find((p) => p.player === playerId);
    const el = document.getElementById('realm');
    if (el !== null) {
      el.textContent = mine !== undefined
        ? `${mine.name} (${world!.settlementsOf(mine.id).length} towns)`
        : 'none';
      el.style.color = mine !== undefined ? houseColour(mine.house) : '';
    }
    const k = document.getElementById('kingdoms');
    if (k !== null) k.textContent = String(polities.length);
  }
}

function drawCrumbs(): void {
  const el = document.getElementById('crumbs')!;
  el.textContent = '';
  const make = (label: string, depth: number): void => {
    if (el.childElementCount > 0) {
      const sep = document.createElement('span');
      sep.className = 'sep';
      sep.textContent = '/';
      el.appendChild(sep);
    }
    const b = document.createElement('button');
    b.textContent = label;
    b.onclick = () => {
      path = path.slice(0, depth);
      cam.panX = 0; cam.panY = 0; cam.zoom = 1; cam.rot = 0;
      selected = -1;
      refresh();
    };
    el.appendChild(b);
  };
  make('world', 0);
  for (let i = 0; i < path.length; i++) make(`${LAYER_LABEL[i + 1]} ${path[i]}`, i + 1);
}

function row(label: string, value: string): string {
  return `<tr><td>${label}</td><td>${value}</td></tr>`;
}

function drawInspector(): void {
  const title = document.getElementById('sel-title')!;
  const addrEl = document.getElementById('sel-addr')!;
  const body = document.getElementById('sel-body')!;
  const actions = document.getElementById('actions')!;
  const hint = document.getElementById('hint')!;
  actions.textContent = '';
  hint.textContent = '';

  if (world === null || selected < 0) {
    title.textContent = 'nothing selected';
    addrEl.textContent = path.length === 0 ? 'drag to turn the globe, click a region' : 'click a cell';
    body.innerHTML = '';
    return;
  }

  const address = [...path, selected];
  addrEl.textContent = `${LAYER_LABEL[address.length]} ${toKey(address)}`;

  if (address.length === 1) {
    // A region: read it off the planet, which is already built.
    const c = selected;
    const p = world.planet;
    title.textContent = `${BIOME_NAMES[p.biome[c]]}${c < 12 ? '  (pentagon)' : ''}`;
    body.innerHTML = `<table>
      ${row('elevation', `${Math.round(p.elevationM[c])} m`)}
      ${row('temperature', `${p.temperatureC[c].toFixed(1)} C`)}
      ${row('rainfall', `${Math.round(p.precipMm[c])} mm/yr`)}
      ${row('productivity', `${Math.round(p.nppGm2[c])} g/m2/yr`)}
      ${row('plate', String(p.plate[c]))}
      ${row('to the sea', `${p.oceanDistance[c]} cell(s)`)}
      ${row('area', `${Math.round(world.cellAreaAt(0) / 1e6).toLocaleString('en')} km2`)}
      ${row('holds', `${SUBCELL_COUNT} ${LAYER_NAMES[1]}s`)}
    </table>`;
    hint.textContent = 'double-click or Enter to open this region';
    return;
  }

  // A realm or a ground tile: the full record.
  const tile = world.tile(address);
  title.textContent = `${BIOME_NAMES[tile.biome]} ${LANDFORM_NAMES[tile.landform]}`;

  const ore = tile.deposits.length === 0
    ? '<span class="none">none</span>'
    : tile.deposits.map((d) => `${MINERAL_NAMES[d.kind]} ${(d.richness * 100).toFixed(0)}%`).join('<br>');

  const crown = polities.find((p) => p.id === tile.owner);
  const steeredBy = crown?.player !== null && crown?.player !== undefined
    ? players.find((p) => p.id === crown.player)?.name ?? `player ${crown.player}`
    : null;
  const owner = tile.owner < 0
    ? '<span class="none">unclaimed</span>'
    : `<span style="color:${houseColour(crown?.house ?? tile.owner)}">`
      + `${crown?.name ?? `polity ${tile.owner}`}</span>`
      + (steeredBy !== null ? `<br><span class="none">${steeredBy}</span>` : '');

  const areaHa = world.cellAreaAt(address.length) / 10000;

  body.innerHTML = `<table>
    ${row('elevation', `${Math.round(tile.elevationM)} m`)}
    ${row('slope', tile.slope.toFixed(3))}
    ${row('temperature', `${tile.temperatureC.toFixed(1)} C`)}
    ${row('rainfall', `${Math.round(tile.precipMm)} mm/yr`)}
    ${row('aridity', tile.aridity.toFixed(2))}
    ${row('river', tile.dischargeM3S >= NAVIGABLE_M3_PER_S
      ? `${tile.dischargeM3S.toFixed(0)} m3/s, navigable`
      : tile.dischargeM3S >= 0.5
        ? `${tile.dischargeM3S.toFixed(1)} m3/s`
        : 'none')}
    ${row('catchment', `${(tile.catchmentM2 / 1e6).toFixed(1)} km2`)}
    ${row('fresh water', tile.freshWater.toFixed(2))}
    </table>
    <div class="group">GROUND</div><table>
    ${row('rock', ROCK_NAMES[tile.rock])}
    ${row('soil over rock', tile.regolithM > 0 ? `${tile.regolithM.toFixed(2)} m` : 'bare rock')}
    ${row('wearing away', `${(tile.erosionMPerYr * 1e6).toFixed(0)} mm per 1000 yr`)}
    ${row('slope holds', !tile.hillslopesResolved
      ? 'not resolved at this scale'
      : tile.stability >= 50 ? 'nothing to slide'
      : tile.stability < 1 ? `UNSTABLE (${tile.stability.toFixed(2)})`
      : tile.stability < 1.3 ? `marginal (${tile.stability.toFixed(2)}) - held by its cover`
      : `yes (${tile.stability.toFixed(2)})`)}
    </table>
    <div class="group">SOIL</div><table>
    ${row('depth', `${Math.round(tile.soil.depthCm)} cm`)}
    ${row('fertility', tile.soil.fertility.toFixed(2))}
    ${row('health', tile.soil.health.toFixed(2))}
    ${row('moisture', tile.soil.moisture.toFixed(2))}
    ${row('leaching', tile.soil.leaching.toFixed(2))}
    </table>
    <div class="group">WHAT IT YIELDS</div><table>
    ${row('area', `${areaHa.toFixed(3)} ha`)}
    ${row('grain', `${Math.round(tile.flora.grainKgPerHa)} kg/ha/yr`)}
    ${row('feeds', tile.flora.grainKgPerHa > 0
      ? `${(tile.flora.grainKgPerHa * areaHa / 317).toFixed(2)} people`
      : '<span class="none">nobody</span>')}
    ${row('timber', `${Math.round(tile.flora.timberTPerHa)} t/ha`)}
    ${row('game', `${tile.fauna.gameHeadPerKm2.toFixed(1)}/km2`)}
    </table>
    <div class="group">UNDER IT</div><table>
    ${row('deposits', ore)}
    </table>
    <div class="group">WHO</div><table>
    ${row('kingdom', owner)}
    ${row('people', tile.population > 0 ? Math.round(tile.population).toLocaleString('en') : '<span class="none">nobody</span>')}
    ${tile.population > 0 ? row('condition', tile.populationHealth.toFixed(2)) : ''}
    </table>
    ${tile.population > 0 ? supplyPanel(world, address, tile.population) : ''}`;

  // Only the plot layer has an economy on it. Everything between the globe and
  // it is a place you pass through on the way down.
  if (address.length < GROUND_DEPTH + 1) {
    hint.textContent = `double-click or Enter to open this ${LAYER_NAMES[address.length - 1]}`;
    return;
  }

  // Ground tiles are the only ones you can act on.
  const button = (label: string, fn: () => void, enabled = true): void => {
    const b = document.createElement('button');
    b.textContent = label;
    b.disabled = !enabled;
    b.onclick = fn;
    actions.appendChild(b);
  };
  const key = toKey(address);
  const mine = tile.owner === playerId;

  button('claim', () => order('claim', key), tile.owner < 0 && tile.elevationM >= 0);
  button('settle 20', () => order('settle', key, 20), mine);
  button('abandon', () => order('abandon', key), mine);

  hint.textContent = tile.elevationM < 0
    ? 'open water cannot be claimed'
    : `orders resolve at the end of turn ${turn + 1}`
      + (address.length < MAX_DEPTH ? ' \u00b7 Enter to go deeper' : '');
}

/**
 * What the settlement is living on: how far it reaches, what it works, and
 * which of the two limits it is against.
 *
 * "limited by" is the number a player should be reading. Labour-limited means
 * more hands would help; land-limited means they would not, and the settlement
 * has to spread out or move.
 */
function supplyPanel(w: World, address: number[], population: number): string {
  const delta = w.getDelta(address);
  const farmShare = delta?.farmShare ?? 1;
  const grainStock = delta?.grainStock ?? 0;
  const ironStock = delta?.ironStock ?? 0;

  const yearGrain = population * GRAIN_PER_PERSON_YEAR;
  const yearIron = population * IRON_PER_PERSON_KG_PER_YEAR;
  const ironSupply = yearIron <= 0 ? 1 : Math.min(1, ironStock / yearIron);
  const months = yearGrain <= 0 ? 0 : (grainStock / yearGrain) * 12;

  const h = w.harvestFor(address, population, ironSupply, farmShare, neighboursOf(w, address));
  const surplus = h.netKgPerYear - h.needKgPerYear;

  const state = months >= 9 ? 'well provisioned'
    : months >= 3 ? 'getting by'
    : months >= 1 ? 'short of food' : 'starving';
  const trade = farmShare < 0.4 ? 'ironworks &mdash; lives on imported grain'
    : farmShare < 0.85 ? 'farms and mines'
    : surplus > 0 ? 'farms, with grain to sell' : 'farms for itself';

  const ore = w.tile(address).deposits.find((d) => d.kind === Mineral.Iron);
  const catchment = w.catchmentFor(address, population);
  const idleDays = (population * 2.5) / 5 * 250 * (1 - farmShare);
  const ironMade = ironOutputKgPerYear(idleDays, ore?.richness ?? 0, catchment.timberKgPerYear);

  return `<div class="group">WHAT IT LIVES ON</div><table>
    ${row('condition', `<b style="color:${months >= 3 ? '#7ba05b' : '#d0563a'}">${state}</b>`)}
    ${row('granary', `${Math.round(grainStock).toLocaleString('en')} kg &mdash; ${months.toFixed(1)} months`)}
    ${row('trade', trade)}
    ${row('hands farming', `${(farmShare * 100).toFixed(0)}%`)}
    ${row('limited by', h.limitedBy === 'labour'
      ? 'hands &mdash; more people would help'
      : h.limitedBy === 'land' ? 'land &mdash; it must spread out' : 'nothing')}
    ${row('fields worked', `${h.hectaresWorked.toFixed(0)} ha`)}
    ${row('furthest field', `${(h.furthestWorkedM / 1000).toFixed(2)} km`)}
    ${row('lost to neighbours', h.tilesLostToNeighbours > 0
      ? `${h.tilesLostToNeighbours.toLocaleString('en')} tiles`
      : '<span class="none">none</span>')}
    ${row('haulage', h.usedWater ? 'river &mdash; 43x cheaper' : 'cart')}
    ${row('harvest', `${Math.round(h.netKgPerYear).toLocaleString('en')} kg/yr net`)}
    ${row('surplus', `${surplus >= 0 ? '+' : ''}${Math.round(surplus).toLocaleString('en')} kg/yr`)}
    ${row('land could feed', `${Math.round(h.potentialPopulation).toLocaleString('en')} people`)}
    </table>
    <div class="group">IRON</div><table>
    ${row('ore here', ore !== undefined
      ? `richness ${(ore.richness * 100).toFixed(0)}%`
      : '<span class="none">none</span>')}
    ${row('tools in hand', `${Math.round(ironStock).toLocaleString('en')} kg &mdash; ${(ironSupply * 100).toFixed(0)}% shod`)}
    ${row('making', ironMade > 0.5
      ? `${Math.round(ironMade).toLocaleString('en')} kg/yr`
      : '<span class="none">nothing</span>')}
    ${row('woods grow', `${Math.round(catchment.timberKgPerYear / 1000).toLocaleString('en')} t/yr`)}
    ${row('iron saves', `${(IRON_LABOUR_SAVING * 100).toFixed(0)}% of the farming year`)}
    </table>`;
}

/**
 * Every other settlement, as competitors for land.
 *
 * A tile goes to whoever is nearest it, so the inspector has to know about the
 * neighbours or it will report fields the settlement does not actually have.
 */
function neighboursOf(w: World, address: number[]): { x: number; y: number; z: number }[] {
  const me = toKey(address);
  const out: { x: number; y: number; z: number }[] = [];
  for (const d of w.allDeltas()) {
    if (d.key === me || !d.population) continue;
    const dir = w.tile(fromKey(d.key)).dir;
    out.push({ x: dir[0], y: dir[1], z: dir[2] });
  }
  return out;
}

function drawLegend(): void {
  const el = document.getElementById('legend')!;
  if (el.childElementCount > 0) return;
  const shown = [
    Biome.Ocean, Biome.Ice, Biome.Tundra, Biome.Taiga, Biome.TemperateGrassland,
    Biome.TemperateForest, Biome.Desert, Biome.Savanna, Biome.TropicalRainforest,
  ];
  for (const b of shown) {
    const d = document.createElement('div');
    const i = document.createElement('i');
    i.style.background = BIOME_COLOURS[b];
    d.appendChild(i);
    d.appendChild(document.createTextNode(BIOME_NAMES[b]));
    el.appendChild(d);
  }
}

// --- go ---------------------------------------------------------------------

window.addEventListener('resize', resize);
resize();
requestAnimationFrame(frame);
connect();
refresh();
