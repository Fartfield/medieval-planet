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
  toKey, fromKey, GROUND_DEPTH, MAX_DEPTH, LAYER_NAMES,
} from '../../sim/geo/address.ts';
import { CELL_COUNT } from '../../sim/geo/sphere.ts';
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
  pickGlobe, pickSubMap, houseColour, blendColours, TINT_MIN_PX,
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
 * The deltas that fall inside the view, grouped by the cell they sit in.
 *
 * On the globe a delta three layers down still has to show, so its address is
 * truncated to the region and claims are counted there. That is what makes a
 * settlement visible from orbit as a coloured border rather than only when you
 * have zoomed all the way in on it.
 */
function visibleOverlays(w: World): { owned: Map<number, number>; populated: Map<number, number> } {
  const owned = new Map<number, number>();
  const populated = new Map<number, number>();
  const depth = path.length;

  for (const d of w.allDeltas()) {
    const address = fromKey(d.key);
    if (address.length <= depth) continue;
    let matches = true;
    for (let i = 0; i < depth; i++) if (address[i] !== path[i]) { matches = false; break; }
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

    const colours: string[] = [];
    for (let c = 0; c < SUBCELL_COUNT; c++) {
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
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.floor(window.innerWidth * dpr);
  canvas.height = Math.floor(window.innerHeight * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function frame(): void {
  requestAnimationFrame(frame);
  const w = window.innerWidth;
  const h = window.innerHeight;
  ctx.fillStyle = '#14161a';
  ctx.fillRect(0, 0, w, h);

  if (world === null) {
    ctx.fillStyle = '#6b665d';
    ctx.font = '13px ui-monospace, monospace';
    ctx.fillText('building the world...', 20, h - 20);
    return;
  }

  const { owned, populated } = visibleOverlays(world);

  if (path.length === 0) {
    drawGlobe(ctx, world.planet, cam, globeView(w, h), selected, owned, tintFor(world, []));
  } else {
    drawSubMap(ctx, world.subMap(path), flatView(w, h, cam), selected, owned, populated,
      workedOverlay(world), tintFor(world, path));
  }

  const remaining = Math.max(0, Math.round((nextTurnAt - performance.now()) / 1000));
  (document.getElementById('next') as HTMLElement).textContent = `${remaining}s`;
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
  }
});

canvas.addEventListener('wheel', (e) => {
  if (path.length === 0) return;
  e.preventDefault();
  const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
  cam.zoom = Math.max(0.35, Math.min(24, cam.zoom * factor));
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
    selected = pickSubMap(flatView(w, h, cam), e.clientX, e.clientY);
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
  cam.panX = 0; cam.panY = 0; cam.zoom = 1;
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
  cam.panX = 0; cam.panY = 0; cam.zoom = 1;
  refresh();
}

// --- panels -----------------------------------------------------------------

const LAYER_LABEL = ['world', 'region', 'realm', 'ground'];

function refresh(): void {
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
      cam.panX = 0; cam.panY = 0; cam.zoom = 1;
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
