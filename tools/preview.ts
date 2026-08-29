// Draw the game's own renderer to a PNG, so it can be looked at without a browser.
//
// The renderer takes a CanvasRenderingContext2D and calls a dozen methods on
// it. Nothing about it needs a browser except the object on the other end of
// those calls, so this supplies one: a software rasteriser that writes a PNG.
//
// It exists because "the hexes don't fit together neatly" is not a thing a
// test suite notices. Every measurement can pass -- no NaNs, the right number
// of shapes, the arithmetic exact to 1e-9 -- while the picture is visibly
// wrong, because the suite checks what the renderer was ASKED to draw and not
// what it looks like once drawn. This closes that gap by producing the actual
// pixels.
//
//   node tools/preview.ts                    the globe
//   node tools/preview.ts --sub 4            a sub-map of region 4
//   node tools/preview.ts --zoom 3 --out x.png
//
// Deliberately small and slow. It fills convex and concave polygons by
// scanline, strokes by walking segments, and clips with a pixel mask; it has
// no antialiasing, which is a feature here -- a jagged edge in the output is a
// jagged edge in the geometry rather than a smoothing artefact hiding one.

import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { World } from '../sim/world.ts';
import { CELL_COUNT } from '../sim/geo/sphere.ts';
import { SUBCELL_COUNT } from '../sim/geo/hexgrid.ts';
import {
  newCamera, globeView, flatView, drawGlobe, drawSubMap,
} from '../client/src/render.ts';

type Pt = { x: number; y: number };

class Raster {
  width: number;
  height: number;
  pix: Uint8ClampedArray;
  canvas: { width: number; height: number };

  fillStyle = '#000';
  strokeStyle = '#000';
  lineWidth = 1;
  font = '';

  private path: Pt[][] = [];
  private current: Pt[] = [];
  private clipMask: Uint8Array | null = null;
  private stack: (Uint8Array | null)[] = [];

  constructor(width: number, height: number, background: string) {
    this.width = width;
    this.height = height;
    this.canvas = { width, height };
    this.pix = new Uint8ClampedArray(width * height * 3);
    const [r, g, b] = parseColour(background);
    for (let i = 0; i < width * height; i++) {
      this.pix[i * 3] = r; this.pix[i * 3 + 1] = g; this.pix[i * 3 + 2] = b;
    }
  }

  // --- path building -------------------------------------------------------
  beginPath(): void { this.path = []; this.current = []; }
  moveTo(x: number, y: number): void {
    if (this.current.length > 0) this.path.push(this.current);
    this.current = [{ x, y }];
  }
  lineTo(x: number, y: number): void { this.current.push({ x, y }); }
  closePath(): void {
    if (this.current.length > 0) { this.path.push(this.current); this.current = []; }
  }
  arc(x: number, y: number, r: number, a0 = 0, a1 = Math.PI * 2): void {
    if (this.current.length > 0) { this.path.push(this.current); this.current = []; }
    const steps = Math.max(12, Math.min(512, Math.ceil(r)));
    const ring: Pt[] = [];
    for (let i = 0; i <= steps; i++) {
      const t = a0 + ((a1 - a0) * i) / steps;
      ring.push({ x: x + r * Math.cos(t), y: y + r * Math.sin(t) });
    }
    this.path.push(ring);
  }

  private subpaths(): Pt[][] {
    return this.current.length > 0 ? [...this.path, this.current] : this.path;
  }

  // --- painting ------------------------------------------------------------
  fill(): void {
    const [r, g, b, a] = parseColour(String(this.fillStyle));
    scan(this.subpaths(), this.width, this.height, (x, y) => this.blend(x, y, r, g, b, a));
  }

  stroke(): void {
    const [r, g, b, a] = parseColour(String(this.strokeStyle));
    const w = Math.max(1, Math.round(this.lineWidth));
    for (const sp of this.subpaths()) {
      for (let i = 0; i + 1 < sp.length; i++) {
        this.line(sp[i], sp[i + 1], r, g, b, a, w);
      }
      // Sub-paths from closePath are already closed by the caller's lineTo
      // sequence; ring paths from arc() close on themselves.
    }
  }

  fillRect(x: number, y: number, w: number, h: number): void {
    const [r, g, b, a] = parseColour(String(this.fillStyle));
    for (let yy = Math.floor(y); yy < y + h; yy++) {
      for (let xx = Math.floor(x); xx < x + w; xx++) this.blend(xx, yy, r, g, b, a);
    }
  }

  fillText(): void {}
  setTransform(): void {}

  // --- clipping ------------------------------------------------------------
  clip(): void {
    const mask = new Uint8Array(this.width * this.height);
    scan(this.subpaths(), this.width, this.height, (x, y) => { mask[y * this.width + x] = 1; });
    if (this.clipMask !== null) {
      for (let i = 0; i < mask.length; i++) mask[i] &= this.clipMask[i];
    }
    this.clipMask = mask;
  }

  save(): void { this.stack.push(this.clipMask); }
  restore(): void { this.clipMask = this.stack.length > 0 ? this.stack.pop()! : null; }

  // --- pixels --------------------------------------------------------------
  private blend(x: number, y: number, r: number, g: number, b: number, a: number): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const i = y * this.width + x;
    if (this.clipMask !== null && this.clipMask[i] === 0) return;
    const o = i * 3;
    if (a >= 1) {
      this.pix[o] = r; this.pix[o + 1] = g; this.pix[o + 2] = b;
    } else {
      this.pix[o] = this.pix[o] * (1 - a) + r * a;
      this.pix[o + 1] = this.pix[o + 1] * (1 - a) + g * a;
      this.pix[o + 2] = this.pix[o + 2] * (1 - a) + b * a;
    }
  }

  private line(p: Pt, q: Pt, r: number, g: number, b: number, a: number, w: number): void {
    const dx = q.x - p.x, dy = q.y - p.y;
    const n = Math.max(1, Math.ceil(Math.hypot(dx, dy)));
    const half = (w - 1) / 2;
    for (let i = 0; i <= n; i++) {
      const x = p.x + (dx * i) / n;
      const y = p.y + (dy * i) / n;
      for (let oy = -half; oy <= half; oy++) {
        for (let ox = -half; ox <= half; ox++) {
          this.blend(Math.round(x + ox), Math.round(y + oy), r, g, b, a);
        }
      }
    }
  }

  toPNG(): Buffer {
    const raw = Buffer.alloc(this.height * (this.width * 3 + 1));
    for (let y = 0; y < this.height; y++) {
      raw[y * (this.width * 3 + 1)] = 0; // filter: none
      for (let x = 0; x < this.width * 3; x++) {
        raw[y * (this.width * 3 + 1) + 1 + x] = this.pix[y * this.width * 3 + x];
      }
    }
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(this.width, 0);
    ihdr.writeUInt32BE(this.height, 4);
    ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
    return Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr),
      chunk('IDAT', deflateSync(raw)),
      chunk('IEND', Buffer.alloc(0)),
    ]);
  }
}

/** Even-odd scanline fill over a set of sub-paths. */
function scan(
  subpaths: Pt[][],
  width: number,
  height: number,
  put: (x: number, y: number) => void,
): void {
  let lo = Infinity, hi = -Infinity;
  for (const sp of subpaths) for (const p of sp) {
    if (p.y < lo) lo = p.y;
    if (p.y > hi) hi = p.y;
  }
  if (!isFinite(lo)) return;
  const y0 = Math.max(0, Math.floor(lo));
  const y1 = Math.min(height - 1, Math.ceil(hi));

  const xs: number[] = [];
  for (let y = y0; y <= y1; y++) {
    const yc = y + 0.5;
    xs.length = 0;
    for (const sp of subpaths) {
      for (let i = 0; i < sp.length; i++) {
        const a = sp[i];
        const b = sp[(i + 1) % sp.length];
        if (a.y === b.y) continue;
        if ((yc >= a.y && yc < b.y) || (yc >= b.y && yc < a.y)) {
          xs.push(a.x + ((yc - a.y) / (b.y - a.y)) * (b.x - a.x));
        }
      }
    }
    if (xs.length < 2) continue;
    xs.sort((p, q) => p - q);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const sx = Math.max(0, Math.ceil(xs[i] - 0.5));
      const ex = Math.min(width - 1, Math.floor(xs[i + 1] - 0.5));
      for (let x = sx; x <= ex; x++) put(x, y);
    }
  }
}

function parseColour(css: string): [number, number, number, number] {
  const s = css.trim();
  if (s.startsWith('#')) {
    const h = s.slice(1);
    if (h.length === 3) {
      return [parseInt(h[0] + h[0], 16), parseInt(h[1] + h[1], 16), parseInt(h[2] + h[2], 16), 1];
    }
    const n = parseInt(h.slice(0, 6), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
  }
  const m = s.match(/rgba?\(([^)]+)\)/);
  if (m) {
    const parts = m[1].split(',').map((v) => parseFloat(v));
    return [parts[0], parts[1], parts[2], parts.length > 3 ? parts[3] : 1];
  }
  return [255, 0, 255, 1];
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0, 0);
  return Buffer.concat([len, body, crc]);
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ---------------------------------------------------------------------------

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback;
}

const W = Number(arg('width', '900'));
const H = Number(arg('height', '900'));
const out = arg('out', 'preview.png');
const seed = Number(arg('seed', '20260826'));
const zoom = Number(arg('zoom', '1'));
const sub = arg('sub', '');

const world = new World({ seed });
const raster = new Raster(W, H, '#0a0e14');
const ctx = raster as unknown as CanvasRenderingContext2D;
const cam = newCamera();
cam.zoom = zoom;

if (sub === '') {
  drawGlobe(ctx, world.planet, cam, globeView(W, H), -1, new Map(), null,
    (cell) => world.subMap([cell]));
} else {
  const path = sub.split(',').map((v) => Number(v));
  drawSubMap(ctx, world.subMap(path), flatView(W, H, cam), -1,
    new Map(), new Map(), null, null,
    (cell) => {
      try { return world.subMap([...path, cell]); } catch { return null; }
    });
}

writeFileSync(out, raster.toPNG());
console.log(`${out}  ${W}x${H}  ${sub === '' ? 'globe' : `sub-map [${sub}]`}  seed ${seed}`);
