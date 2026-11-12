// Pure canvas drawing for Planisphere. No obsidian import, no DOM besides canvas creation.
import { mulberry32, type LayoutState, type LNode, type RGB } from "./layout";
import type { LabelMode, ThemeName } from "./contract";

/* ---------------- themes ---------------- */

export interface Theme {
  name: ThemeName;
  serif: string;
  sans: string;
  /** additive blending for halos and edges (night sky) vs plain (paper) */
  additive: boolean;
  skyStops: [number, string][];
  skyCenter: [number, number];
  band: string | null;
  vignette: string | null;
  star: RGB;
  starAlpha: number;
  twinkle: boolean;
  graticule: RGB;
  graticuleAlpha: [number, number, number]; // odd rings, even rings, spokes
  edgeIntra: number;
  edgeCross: number;
  edgeCrossColor: RGB;
  edgeHot: number;
  edgeSel: number;
  hotTint: RGB;
  dim: number;
  haloAlpha: number;
  ringBg: string;
  labelInk: string;
  labelInkDim: string;
  labelStroke: string;
  clusterAlpha: number;
  clusterStroke: string;
  selectInk: string;
  gold: RGB;
  /** colour used for rings, halos, cluster names given a cluster hue */
  tone(hue: RGB): RGB;
  /** colour of edges inside a cluster */
  edgeTone(hue: RGB): RGB;
  /** colour of a star's bright core */
  core(hue: RGB): RGB;
}

const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const rgba = (c: RGB, a: number) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
const WHITE: RGB = [233, 236, 248];
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const TAU = Math.PI * 2;

const SERIF = `"Iowan Old Style","Palatino Linotype",Palatino,"Book Antiqua",Charter,"Bitstream Charter",Georgia,serif`;
const SANS = `-apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Roboto,"Helvetica Neue",Arial,sans-serif`;

export const NIGHT: Theme = {
  name: "night",
  serif: SERIF,
  sans: SANS,
  additive: true,
  skyStops: [
    [0, "#141c40"],
    [0.45, "#0c1330"],
    [1, "#060918"],
  ],
  skyCenter: [0.5, 0.42],
  band: "rgba(120,130,220,.06)",
  vignette: null,
  star: [220, 228, 255],
  starAlpha: 1,
  twinkle: true,
  graticule: [150, 165, 235],
  graticuleAlpha: [0.045, 0.03, 0.03],
  edgeIntra: 0.1,
  edgeCross: 0.06,
  edgeCrossColor: [170, 180, 235],
  edgeHot: 0.6,
  edgeSel: 0.4,
  hotTint: WHITE,
  dim: 0.13,
  haloAlpha: 0.55,
  ringBg: "#0b1028",
  labelInk: "rgba(244,246,252,1)",
  labelInkDim: "rgba(214,220,245,.86)",
  labelStroke: "rgba(8,11,28,.85)",
  clusterAlpha: 0.8,
  clusterStroke: "rgba(6,9,24,.55)",
  selectInk: "rgba(233,236,248,",
  gold: [243, 198, 98],
  tone: (h) => h,
  edgeTone: (h) => mix(h, WHITE, 0.35),
  core: (h) => mix(h, WHITE, 0.5),
};

const INK: RGB = [46, 36, 26];
export const PAPER: Theme = {
  name: "paper",
  serif: SERIF,
  sans: SANS,
  additive: false,
  skyStops: [
    [0, "#f8f3e7"],
    [0.6, "#f1ead9"],
    [1, "#e3d9c1"],
  ],
  skyCenter: [0.5, 0.45],
  band: null,
  vignette: "rgba(120,92,50,.10)",
  star: [110, 88, 58],
  starAlpha: 0.55,
  twinkle: false,
  graticule: [120, 92, 56],
  graticuleAlpha: [0.14, 0.1, 0.08],
  edgeIntra: 0.2,
  edgeCross: 0.09,
  edgeCrossColor: [110, 92, 70],
  edgeHot: 0.75,
  edgeSel: 0.55,
  hotTint: INK,
  dim: 0.2,
  haloAlpha: 0.34,
  ringBg: "#f8f3e7",
  labelInk: "rgba(40,30,20,1)",
  labelInkDim: "rgba(70,56,40,.9)",
  labelStroke: "rgba(248,243,231,.9)",
  clusterAlpha: 0.92,
  clusterStroke: "rgba(248,243,231,.75)",
  selectInk: "rgba(46,36,26,",
  gold: [190, 132, 28],
  tone: (h) => mix(h, INK, 0.38),
  edgeTone: (h) => mix(h, INK, 0.45),
  core: (h) => mix(h, INK, 0.5),
};

export function themeFor(name: ThemeName, sans?: string): Theme {
  const t = name === "paper" ? PAPER : NIGHT;
  return sans ? { ...t, sans } : t;
}

/* ---------------- view state ---------------- */

export interface Camera {
  x: number;
  y: number;
  k: number;
}

export interface ViewState {
  layout: LayoutState;
  width: number; // CSS px
  height: number;
  dpr: number;
  cam: Camera;
  camTarget: Camera;
  hovered: number | null;
  selected: number | null;
  /** local mode centre, drawn with a dashed ring */
  center: number | null;
  /** find results; dims everyone else */
  focus: Set<number> | null;
  labelMode: LabelMode;
  /** portrait for node i at a pixel size (64, 96 or 144). Only called for visible people. */
  getAvatar: (i: number, size: number) => CanvasImageSource;
  nodeAlpha: Float32Array;
  // private caches
  _order?: { version: number; stars: number[]; people: number[] };
  _sx?: Float32Array;
  _sy?: Float32Array;
  _vis?: Uint8Array;
  /** debugging aid: when set, draw() records the milliseconds spent in each section (forces a raster flush between them) */
  prof?: Record<string, number>;
  _hoverSet?: { i: number; version: number; set: Set<number> };
  _selSet?: { i: number; version: number; set: Set<number> };
}

export const MIN_ZOOM = 0.04;
export const MAX_ZOOM = 5;

export function createViewState(layout: LayoutState, getAvatar: ViewState["getAvatar"]): ViewState {
  return {
    layout,
    width: 800,
    height: 600,
    dpr: 1,
    cam: { x: 0, y: 0, k: 1 },
    camTarget: { x: 0, y: 0, k: 1 },
    hovered: null,
    selected: null,
    center: null,
    focus: null,
    labelMode: "auto",
    getAvatar,
    nodeAlpha: new Float32Array(layout.nodes.length).fill(1),
  };
}

export function setLayout(st: ViewState, layout: LayoutState): void {
  st.layout = layout;
  st.nodeAlpha = new Float32Array(layout.nodes.length).fill(1);
  st._order = undefined;
  st._hoverSet = undefined;
  st._selSet = undefined;
  if (st.hovered !== null && st.hovered >= layout.nodes.length) st.hovered = null;
  if (st.selected !== null && st.selected >= layout.nodes.length) st.selected = null;
  if (st.center !== null && st.center >= layout.nodes.length) st.center = null;
}

export const toScreen = (st: ViewState, x: number, y: number): [number, number] => [
  (x - st.cam.x) * st.cam.k + st.width / 2,
  (y - st.cam.y) * st.cam.k + st.height / 2,
];
export const toWorld = (st: ViewState, sx: number, sy: number): [number, number] => [
  (sx - st.width / 2) / st.cam.k + st.cam.x,
  (sy - st.height / 2) / st.cam.k + st.cam.y,
];

/** Node radius scales with zoom more gently than distances do. */
export const nodeScale = (k: number) => Math.pow(k, 0.55);

export interface Padding {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export function boundsOf(st: ViewState, ids?: Iterable<number>): { x0: number; y0: number; x1: number; y1: number } | null {
  const nodes = st.layout.nodes;
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  const visit = (n: LNode) => {
    if (n.x < x0) x0 = n.x;
    if (n.x > x1) x1 = n.x;
    if (n.y < y0) y0 = n.y;
    if (n.y > y1) y1 = n.y;
  };
  if (ids) for (const i of ids) visit(nodes[i]);
  else for (const n of nodes) visit(n);
  return isFinite(x0) ? { x0, y0, x1, y1 } : null;
}

export function fitCamera(st: ViewState, pad: Padding = { top: 56, bottom: 48, left: 40, right: 40 }, immediate = false, ids?: Iterable<number>, maxK = 1.6): void {
  const b = boundsOf(st, ids) || { x0: -100, y0: -100, x1: 100, y1: 100 };
  const availW = Math.max(100, st.width - pad.left - pad.right);
  const availH = Math.max(100, st.height - pad.top - pad.bottom);
  const k = clamp(Math.min(availW / (b.x1 - b.x0 + 120), availH / (b.y1 - b.y0 + 120), maxK), MIN_ZOOM, MAX_ZOOM);
  const cx = (b.x0 + b.x1) / 2;
  const cy = (b.y0 + b.y1) / 2;
  st.camTarget = { k, x: cx - (pad.left - pad.right) / 2 / k, y: cy - (pad.top - pad.bottom) / 2 / k };
  if (immediate) st.cam = { ...st.camTarget };
}

/** Advance camera and focus fades. Returns true while anything is still moving. */
export function stepView(st: ViewState, dtMs: number, th: Theme = NIGHT): boolean {
  const dt = Math.min(64, Math.max(0, dtMs));
  let moving = false;
  const e = 1 - Math.pow(0.0001, (dt / 1000) * 1.6);
  const c = st.cam;
  const t = st.camTarget;
  const dx = t.x - c.x,
    dy = t.y - c.y,
    dk = t.k - c.k;
  if (Math.abs(dx) * c.k > 0.1 || Math.abs(dy) * c.k > 0.1 || Math.abs(dk) > 0.0005) {
    c.x += dx * e;
    c.y += dy * e;
    c.k += dk * e;
    moving = true;
  } else {
    c.x = t.x;
    c.y = t.y;
    c.k = t.k;
  }
  const F = focusSet(st);
  const a = 1 - Math.exp(-dt / 85);
  const dimTo = th.dim;
  if (st.nodeAlpha.length !== st.layout.nodes.length) st.nodeAlpha = new Float32Array(st.layout.nodes.length).fill(1);
  const na = st.nodeAlpha;
  for (let i = 0; i < na.length; i++) {
    const target = !F || F.has(i) ? 1 : dimTo;
    const d = target - na[i];
    if (Math.abs(d) > 0.004) {
      na[i] += d * a;
      moving = true;
    } else na[i] = target;
  }
  return moving;
}

/** Lit set: hovered node and neighbours, else selected node and neighbours, else the find results. */
export function focusSet(st: ViewState): Set<number> | null {
  const L = st.layout;
  const around = (idx: number, key: "_hoverSet" | "_selSet") => {
    const c = st[key];
    if (c && c.i === idx && c.version === L.version) return c.set;
    const s = new Set<number>(L.adj[idx]);
    s.add(idx);
    st[key] = { i: idx, version: L.version, set: s };
    return s;
  };
  if (st.hovered !== null && st.hovered < L.nodes.length) return around(st.hovered, "_hoverSet");
  if (st.selected !== null && st.selected < L.nodes.length) return around(st.selected, "_selSet");
  return st.focus;
}

/* ---------------- hit testing ---------------- */

export function hitTest(st: ViewState, x: number, y: number): number | null {
  const zs = nodeScale(st.cam.k);
  const nodes = st.layout.nodes;
  const { k, x: cx, y: cy } = st.cam;
  const hw = st.width / 2;
  const hh = st.height / 2;
  let best: number | null = null;
  let bd = Infinity;
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    const dx = (n.x - cx) * k + hw - x;
    if (dx > 40 || dx < -40) continue;
    const dy = (n.y - cy) * k + hh - y;
    const r = Math.max(n.r * zs + 3, 7);
    if (dx * dx + dy * dy >= r * r) continue;
    // prefer the node whose centre is nearest, with people winning ties against stars beneath them
    const d = Math.hypot(dx, dy) - (n.person ? n.r * zs * 0.5 : 0);
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  return best;
}

/* ---------------- sprites and sky ---------------- */

const haloCache = new Map<string, HTMLCanvasElement>();
function halo(rgb: RGB): HTMLCanvasElement {
  const key = `${rgb[0] | 0},${rgb[1] | 0},${rgb[2] | 0}`;
  let c = haloCache.get(key);
  if (c) return c;
  const s = 128;
  c = document.createElement("canvas");
  c.width = c.height = s;
  const g = c.getContext("2d")!;
  const gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  gr.addColorStop(0, `rgba(${key},.6)`);
  gr.addColorStop(0.3, `rgba(${key},.2)`);
  gr.addColorStop(0.6, `rgba(${key},.05)`);
  gr.addColorStop(1, `rgba(${key},0)`);
  g.fillStyle = gr;
  g.fillRect(0, 0, s, s);
  haloCache.set(key, c);
  return c;
}

interface Star {
  x: number;
  y: number;
  r: number;
  a: number;
  tw: number;
  d: number;
}
interface StarGroup {
  a: number;
  stars: Star[];
}
let skyCache: { key: string; canvas: HTMLCanvasElement; groups: StarGroup[] } | null = null;

function skyLayer(W: number, H: number, dpr: number, th: Theme) {
  const key = `${th.name}|${W}|${H}|${dpr}`;
  if (skyCache && skyCache.key === key) return skyCache;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(W * dpr));
  canvas.height = Math.max(1, Math.round(H * dpr));
  const g = canvas.getContext("2d")!;
  g.scale(dpr, dpr);
  const bg = g.createRadialGradient(W * th.skyCenter[0], H * th.skyCenter[1], 0, W * th.skyCenter[0], H * th.skyCenter[1], Math.max(W, H) * 0.75);
  th.skyStops.forEach(([o, c]) => bg.addColorStop(o, c));
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);
  if (th.band) {
    g.save();
    g.translate(W * 0.5, H * 0.5);
    g.rotate(-0.42);
    const band = g.createLinearGradient(0, -H * 0.35, 0, H * 0.35);
    band.addColorStop(0, "rgba(120,130,220,0)");
    band.addColorStop(0.5, th.band);
    band.addColorStop(1, "rgba(120,130,220,0)");
    g.fillStyle = band;
    g.fillRect(-W, -H * 0.35, W * 2, H * 0.7);
    g.restore();
  }
  const sr = mulberry32(42);
  if (th.name === "paper") {
    for (let i = 0; i < Math.round((W * H) / 90); i++) {
      g.fillStyle = `rgba(${90 + ((sr() * 40) | 0)},${70 + ((sr() * 30) | 0)},${40},${0.02 + sr() * 0.035})`;
      g.fillRect(sr() * W, sr() * H, 1 + sr() * 1.4, 1 + sr() * 1.4);
    }
    g.strokeStyle = "rgba(110,84,50,.16)";
    g.lineWidth = 1;
    g.strokeRect(14.5, 14.5, W - 29, H - 29);
    g.strokeStyle = "rgba(110,84,50,.08)";
    g.strokeRect(19.5, 19.5, W - 39, H - 39);
  }
  if (th.vignette) {
    const v = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.8);
    v.addColorStop(0, "rgba(120,92,50,0)");
    v.addColorStop(1, th.vignette);
    g.fillStyle = v;
    g.fillRect(0, 0, W, H);
  }
  const stars: Star[] = [];
  const count = Math.round((W * H) / (th.name === "paper" ? 5200 : 2600));
  for (let i = 0; i < count; i++) {
    stars.push({ x: sr() * W, y: sr() * H, r: sr() < 0.93 ? 0.4 + sr() * 0.6 : 1 + sr() * 0.6, a: 0.15 + sr() * 0.5, tw: sr() * TAU, d: 0.02 + sr() * 0.05 });
  }
  const groups: StarGroup[] = [0.2, 0.32, 0.44, 0.56, 0.68].map((a) => ({ a, stars: [] }));
  for (const st of stars) groups[Math.min(4, Math.floor(((st.a - 0.15) / 0.5) * 5))].stars.push(st);
  skyCache = { key, canvas, groups };
  return skyCache;
}

/* ---------------- drawing ---------------- */

interface LabelBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
const overlaps = (a: LabelBox, b: LabelBox) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;

function drawingOrder(st: ViewState) {
  const L = st.layout;
  if (st._order && st._order.version === L.version && st._order.stars.length + st._order.people.length === L.nodes.length) return st._order;
  const byR = (a: number, b: number) => L.nodes[a].r - L.nodes[b].r || a - b;
  const stars: number[] = [];
  const people: number[] = [];
  L.nodes.forEach((n, i) => (n.person ? people : stars).push(i));
  stars.sort(byR);
  people.sort(byR);
  st._order = { version: L.version, stars, people };
  return st._order;
}

/** Level of detail thresholds, by node count. */
export const LOD_BIG = 600;
export const LOD_HUGE = 1500;

const BUCKETS = 9;
let bucketLists: number[][] = [];

function trunc(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1).trimEnd() + "…" : s;
}

export function draw(ctx: CanvasRenderingContext2D, st: ViewState, th: Theme, time: number): void {
  const { width: W, height: H, dpr } = st;
  const L = st.layout;
  const nodes = L.nodes;
  const cam = st.cam;
  const sky = skyLayer(W, H, dpr, th);
  const N = nodes.length;
  const huge = N > LOD_HUGE;
  const big = N > LOD_BIG;

  let tMark = nowMs();
  const mark = (name: string) => {
    if (!st.prof) return;
    ctx.getImageData(0, 0, 1, 1);
    const t = nowMs();
    st.prof[name] = (st.prof[name] || 0) + (t - tMark);
    tMark = t;
  };
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  ctx.drawImage(sky.canvas, 0, 0);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // background stars with slight parallax, drawn in five twinkle groups so each group is one fill
  const t = time / 1000;
  const groups = sky.groups;
  for (let g = 0; g < groups.length; g++) {
    const grp = groups[g];
    const tw = th.twinkle && !huge ? 0.78 + 0.22 * Math.sin(t * 1.3 + g * 1.9) : 1;
    ctx.fillStyle = rgba(th.star, grp.a * th.starAlpha * tw);
    ctx.beginPath();
    for (let q = 0; q < grp.stars.length; q++) {
      const s = grp.stars[q];
      let x = (s.x - cam.x * s.d * cam.k) % W;
      if (x < 0) x += W;
      let y = (s.y - cam.y * s.d * cam.k) % H;
      if (y < 0) y += H;
      if (s.r < 1) ctx.rect(x - s.r, y - s.r, s.r * 2, s.r * 2);
      else {
        ctx.moveTo(x + s.r, y);
        ctx.arc(x, y, s.r, 0, TAU);
      }
    }
    ctx.fill();
  }

  // graticule: atlas rings
  const [ox, oy] = toScreen(st, 0, 0);
  const step = 150;
  const rings = clamp(Math.ceil((L.radius * 1.25) / step), 4, 14);
  ctx.lineWidth = 1;
  for (let i = 1; i <= rings; i++) {
    const rr = i * step * cam.k;
    if (rr < 8 || rr > Math.max(W, H) * 6) continue;
    ctx.strokeStyle = rgba(th.graticule, i % 2 ? th.graticuleAlpha[0] : th.graticuleAlpha[1]);
    ctx.setLineDash(i % 2 ? [] : [2, 6]);
    ctx.beginPath();
    ctx.arc(ox, oy, rr, 0, TAU);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.strokeStyle = rgba(th.graticule, th.graticuleAlpha[2]);
  ctx.beginPath();
  for (let i = 0; i < 12; i++) {
    const a = (i * Math.PI) / 6;
    ctx.moveTo(ox + Math.cos(a) * step * cam.k, oy + Math.sin(a) * step * cam.k);
    ctx.lineTo(ox + Math.cos(a) * step * rings * cam.k, oy + Math.sin(a) * step * rings * cam.k);
  }
  ctx.stroke();

  mark("sky");
  if (!N) return;

  // screen positions and visibility, once per frame
  if (!st._sx || st._sx.length !== N) {
    st._sx = new Float32Array(N);
    st._sy = new Float32Array(N);
    st._vis = new Uint8Array(N);
  }
  const SX = st._sx;
  const SY = st._sy!;
  const VIS = st._vis!;
  const zs = nodeScale(cam.k);
  const pad = 28;
  for (let i = 0; i < N; i++) {
    const x = (nodes[i].x - cam.x) * cam.k + W / 2;
    const y = (nodes[i].y - cam.y) * cam.k + H / 2;
    SX[i] = x;
    SY[i] = y;
    const p = nodes[i].r * zs * 4 + pad;
    VIS[i] = x > -p && x < W + p && y > -p && y < H + p ? 1 : 0;
  }

  const hov = st.hovered;
  const sel = st.selected;
  const F = focusSet(st);
  const K = L.clusters.length;
  const toneOf = (n: LNode) => th.tone(L.clusters[n.cluster].hue);
  const anchor = hov !== null ? hov : sel;
  const rOf = (i: number) => nodes[i].r * zs * (i === hov ? 1.2 : 1);

  /* ---- edges ---- */
  const straight = huge;
  const edgeCap = huge ? 4000 : 8000;
  const stride = L.edges.length > edgeCap ? Math.ceil(L.edges.length / edgeCap) : 1;
  const segment = (e: number): boolean => {
    const [a, b] = L.edges[e];
    const x1 = SX[a],
      y1 = SY[a],
      x2 = SX[b],
      y2 = SY[b];
    if ((x1 < -50 && x2 < -50) || (x1 > W + 50 && x2 > W + 50) || (y1 < -50 && y2 < -50) || (y1 > H + 50 && y2 > H + 50)) return false;
    ctx.moveTo(x1, y1);
    if (straight) ctx.lineTo(x2, y2);
    else {
      const bend = nodes[a].cluster === nodes[b].cluster ? 0.08 : 0.16;
      ctx.quadraticCurveTo((x1 + x2) / 2 - (y2 - y1) * bend, (y1 + y2) / 2 + (x2 - x1) * bend, x2, y2);
    }
    return true;
  };
  const hot = (e: number) => {
    const [a, b] = L.edges[e];
    if (anchor !== null) return a === anchor || b === anchor;
    return !!F && F.has(a) && F.has(b);
  };
  // additive blending looks best but is costly in software rasterisers, so only small skies get it
  const density = N > 300 ? 1.15 : 1;
  ctx.globalCompositeOperation = th.additive && N <= 300 ? "lighter" : "source-over";
  ctx.lineWidth = 1;
  ctx.lineCap = "round";
  const hasHot = anchor !== null || !!F;
  for (let g = 0; g <= K; g++) {
    const list = L.edgeGroups[g];
    if (!list || !list.length) continue;
    const base = (g < K ? th.edgeIntra : th.edgeCross) * density;
    const col = g < K ? th.edgeTone(L.clusters[g].hue) : th.edgeCrossColor;
    ctx.strokeStyle = rgba(col, hasHot ? base * 0.3 : base);
    ctx.beginPath();
    for (let q = 0; q < list.length; q += stride) {
      const e = list[q];
      if (hasHot && hot(e)) continue;
      segment(e);
    }
    ctx.stroke();
  }
  if (hasHot) {
    ctx.lineWidth = 1.4;
    for (let g = 0; g <= K; g++) {
      for (const e of L.edgeGroups[g] || []) {
        if (!hot(e)) continue;
        const [a] = L.edges[e];
        const owner = anchor !== null ? nodes[anchor] : nodes[a];
        ctx.strokeStyle = rgba(mix(th.tone(L.clusters[owner.cluster].hue), th.hotTint, 0.25), th.edgeHot);
        ctx.beginPath();
        if (segment(e)) ctx.stroke();
      }
    }
  }
  ctx.lineWidth = 1;

  mark("edges");
  /* ---- halos ---- */
  const order = drawingOrder(st);
  // smallest star that gets a sprite halo: the busier the sky, the fewer sprites
  const minHaloR = huge ? 4 : N > 1000 ? 3 : big ? 2.1 : 0;
  const lowAlpha = (i: number) => st.nodeAlpha[i] < 0.2;
  // when something is highlighted, the lit notes swell a little so they stand out from the dimmed sky
  const lit = (i: number) => hasHot && !!F && F.has(i) && st.nodeAlpha[i] > 0.8 && i !== hov;
  for (const i of order.stars) {
    if (!VIS[i]) continue;
    const r = nodes[i].r * zs;
    const isLit = lit(i);
    if (!isLit && i !== hov && i !== sel) {
      if (r < minHaloR) continue;
    }
    if (lowAlpha(i) && big) continue;
    const hs = r * (isLit ? 6.4 : 5.6);
    ctx.globalAlpha = st.nodeAlpha[i] * th.haloAlpha * (i === hov ? 1.5 : isLit ? 1.1 : 0.9);
    ctx.drawImage(halo(toneOf(nodes[i])), SX[i] - hs, SY[i] - hs, hs * 2, hs * 2);
  }
  for (const i of order.people) {
    if (!VIS[i]) continue;
    const r = nodes[i].r * zs;
    if (big && lowAlpha(i)) continue;
    const hs = r * 3.4;
    ctx.globalAlpha = st.nodeAlpha[i] * th.haloAlpha;
    ctx.drawImage(halo(nodes[i].note.mentions > 0 ? th.gold : toneOf(nodes[i])), SX[i] - hs, SY[i] - hs, hs * 2, hs * 2);
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";

  mark("halos");
  /* ---- stars: cores batched by cluster and fade bucket ---- */
  const night = th.name === "night";
  const nb = (K + 1) * BUCKETS;
  while (bucketLists.length < nb) bucketLists.push([]);
  for (let b = 0; b < nb; b++) bucketLists[b].length = 0;
  for (const i of order.stars) {
    if (!VIS[i] || i === hov || i === sel) continue;
    const bk = Math.max(0, Math.min(BUCKETS - 1, Math.round(st.nodeAlpha[i] * (BUCKETS - 1))));
    bucketLists[nodes[i].cluster * BUCKETS + bk].push(i);
  }
  for (let c = 0; c < K; c++) {
    const hue = L.clusters[c].hue;
    const core = th.core(hue);
    for (let bk = 0; bk < BUCKETS; bk++) {
      const list = bucketLists[c * BUCKETS + bk];
      if (!list.length) continue;
      ctx.fillStyle = rgba(core, bk / (BUCKETS - 1));
      ctx.beginPath();
      for (const i of list) {
        const r = Math.max(1.05, nodes[i].r * zs * (lit(i) ? 0.85 : 0.68));
        if (r < 1.6) ctx.rect(SX[i] - r, SY[i] - r, r * 2, r * 2);
        else {
          ctx.moveTo(SX[i] + r, SY[i]);
          ctx.arc(SX[i], SY[i], r, 0, TAU);
        }
      }
      ctx.fill();
    }
  }
  // diffraction spikes on the biggest stars
  ctx.lineCap = "round";
  for (const i of order.stars) {
    if (!VIS[i] || st.nodeAlpha[i] < 0.5) continue;
    const r = nodes[i].r * zs;
    if (r < 4.6) continue;
    const len = r * (2.6 + 0.35 * Math.sin(t * 1.4 + i * 1.7));
    const core = th.core(L.clusters[nodes[i].cluster].hue);
    ctx.strokeStyle = rgba(core, (night ? 0.5 : 0.35) * st.nodeAlpha[i]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(SX[i] - len, SY[i]);
    ctx.lineTo(SX[i] + len, SY[i]);
    ctx.moveTo(SX[i], SY[i] - len);
    ctx.lineTo(SX[i], SY[i] + len);
    ctx.stroke();
  }

  /* ---- selection / hover marks ---- */
  const drawSelRing = (i: number, R: number) => {
    const x = SX[i];
    const y = SY[i];
    ctx.strokeStyle = th.selectInk + ".85)";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(x, y, R, 0, TAU);
    ctx.stroke();
    const rot = time / 2400;
    ctx.strokeStyle = th.selectInk + ".5)";
    ctx.beginPath();
    for (let k = 0; k < 4; k++) {
      const an = rot + (k * Math.PI) / 2;
      ctx.moveTo(x + Math.cos(an) * (R + 3), y + Math.sin(an) * (R + 3));
      ctx.lineTo(x + Math.cos(an) * (R + 8), y + Math.sin(an) * (R + 8));
    }
    ctx.stroke();
  };
  const drawStarTop = (i: number) => {
    if (!VIS[i]) return;
    const r = rOf(i);
    ctx.globalAlpha = st.nodeAlpha[i];
    ctx.fillStyle = rgba(th.name === "night" ? WHITE : INK, 0.95);
    ctx.beginPath();
    ctx.arc(SX[i], SY[i], Math.max(1.6, r * 0.7), 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;
    if (i === sel) drawSelRing(i, Math.max(r, 3) + 7);
  };

  mark("stars");
  /* ---- people: round portraits ---- */
  const drawPerson = (i: number) => {
    const n = nodes[i];
    const r = rOf(i);
    if (!VIS[i]) return;
    const a = st.nodeAlpha[i];
    const x = SX[i];
    const y = SY[i];
    const mentioned = n.note.mentions > 0;
    const ringCol = mentioned ? th.gold : toneOf(n);
    const ringW = Math.max(1.3, r * (mentioned ? 0.15 : 0.1));
    ctx.globalAlpha = a;
    ctx.fillStyle = rgba(ringCol, 1);
    ctx.beginPath();
    ctx.arc(x, y, r + ringW, 0, TAU);
    ctx.fill();
    ctx.fillStyle = th.ringBg;
    ctx.beginPath();
    ctx.arc(x, y, r + ringW * 0.28, 0, TAU);
    ctx.fill();
    if (r < 3.5) {
      // too small for a portrait: a dot in the cluster colour, and no avatar is fetched
      ctx.fillStyle = rgba(toneOf(n), 1);
      ctx.beginPath();
      ctx.arc(x, y, r, 0, TAU);
      ctx.fill();
    } else {
      const px = r * 2 * dpr;
      ctx.drawImage(st.getAvatar(i, px <= 56 ? 64 : px <= 90 ? 96 : 144), x - r, y - r, r * 2, r * 2);
    }
    ctx.globalAlpha = 1;
    if (i === sel) drawSelRing(i, r + ringW + 6);
  };
  for (const i of order.people) if (i !== hov && i !== sel) drawPerson(i);
  const top = (i: number | null) => {
    if (i === null) return;
    if (nodes[i].person) drawPerson(i);
    else drawStarTop(i);
  };
  if (sel !== null && sel !== hov) top(sel);
  top(hov);

  if (st.center !== null && st.center < N && VIS[st.center]) {
    const i = st.center;
    const R = Math.max(rOf(i), 4) + (nodes[i].person ? 14 : 12);
    ctx.strokeStyle = th.selectInk + ".55)";
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 4]);
    ctx.beginPath();
    ctx.arc(SX[i], SY[i], R, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  mark("people");
  /* ---- occupancy grid so names and labels keep off the nodes ---- */
  const CELL = 14;
  const gc = Math.ceil(W / CELL) + 1;
  const gr = Math.ceil(H / CELL) + 1;
  const occ = new Uint8Array(gc * gr);
  for (let i = 0; i < N; i++) {
    if (!VIS[i]) continue;
    const r = Math.max(2, nodes[i].r * zs) + 2;
    const cx0 = Math.max(0, Math.floor((SX[i] - r) / CELL));
    const cx1 = Math.min(gc - 1, Math.floor((SX[i] + r) / CELL));
    const cy0 = Math.max(0, Math.floor((SY[i] - r) / CELL));
    const cy1 = Math.min(gr - 1, Math.floor((SY[i] + r) / CELL));
    for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) occ[cy * gc + cx] = 1;
  }
  const occupied = (b: LabelBox): number => {
    const cx0 = Math.max(0, Math.floor(b.x0 / CELL));
    const cx1 = Math.min(gc - 1, Math.floor(b.x1 / CELL));
    const cy0 = Math.max(0, Math.floor(b.y0 / CELL));
    const cy1 = Math.min(gr - 1, Math.floor(b.y1 / CELL));
    let c = 0;
    for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) c += occ[cy * gc + cx];
    return c;
  };

  mark("occupancy");
  /* ---- cluster names: italic serif, placed where they collide least ---- */
  const placed: LabelBox[] = [];
  const fontSize = Math.round(clamp(15 * Math.pow(cam.k, 0.4), 13, 20));
  ctx.font = `italic 400 ${fontSize}px ${th.serif}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  try {
    (ctx as unknown as { letterSpacing: string }).letterSpacing = "1.5px";
  } catch {
    /* older engines */
  }
  const dimFactor = F ? 0.35 : 1;
  const clusterOrder = L.clusters.map((_, c) => c).sort((a, b) => L.clusters[b].size - L.clusters[a].size);
  let shown = 0;
  for (const c of clusterOrder) {
    const cl = L.clusters[c];
    if (shown >= 24) break;
    if (cl.members.length < 2) continue;
    if (cl.loose && cl.members.length < 6) continue;
    // robust extent: centroid and spread, then the box of members within 2.2 sigma
    let mx = 0,
      my = 0;
    for (const i of cl.members) {
      mx += SX[i];
      my += SY[i];
    }
    mx /= cl.members.length;
    my /= cl.members.length;
    let vx = 0,
      vy = 0;
    for (const i of cl.members) {
      vx += (SX[i] - mx) ** 2;
      vy += (SY[i] - my) ** 2;
    }
    const sx = Math.sqrt(vx / cl.members.length) * 2.2 + 6;
    const sy = Math.sqrt(vy / cl.members.length) * 2.2 + 6;
    let topY = Infinity,
      bot = -Infinity,
      left = Infinity,
      right = -Infinity;
    for (const i of cl.members) {
      if (Math.abs(SX[i] - mx) > sx || Math.abs(SY[i] - my) > sy) continue;
      const r = nodes[i].r * zs;
      topY = Math.min(topY, SY[i] - r);
      bot = Math.max(bot, SY[i] + r);
      left = Math.min(left, SX[i] - r);
      right = Math.max(right, SX[i] + r);
    }
    if (!isFinite(topY)) continue;
    if (mx < -40 || mx > W + 40 || my < -40 || my > H + 40) continue;
    const label = cl.name;
    const w = ctx.measureText(label).width + 12;
    const h = fontSize + 6;
    const cands: [number, number, number][] = [
      [mx, topY - 16, 0],
      [mx, topY - 30, 4],
      [mx - (right - left) * 0.25, topY - 16, 8],
      [mx + (right - left) * 0.25, topY - 16, 8],
      [mx, bot + 28, 14],
      [left - w / 2 - 8, (topY + bot) / 2, 24],
      [right + w / 2 + 8, (topY + bot) / 2, 24],
    ];
    let best = cands[0];
    let bestScore = Infinity;
    for (const cd of cands) {
      const box: LabelBox = { x0: cd[0] - w / 2, y0: cd[1] - h + 4, x1: cd[0] + w / 2, y1: cd[1] + 4 };
      let score = cd[2] + occupied(box) * 3;
      for (const p of placed) if (overlaps(box, p)) score += 200;
      if (box.x0 < 8 || box.x1 > W - 8 || box.y0 < 48 || box.y1 > H - 8) score += 60;
      if (score < bestScore) {
        bestScore = score;
        best = cd;
      }
    }
    if (bestScore >= 200 && shown >= 3) continue; // overlaps another name: skip the smaller one
    placed.push({ x0: best[0] - w / 2, y0: best[1] - h + 4, x1: best[0] + w / 2, y1: best[1] + 4 });
    if (best[0] < -w || best[0] > W + w || best[1] < -h || best[1] > H + h) continue;
    shown++;
    const tone = th.tone(cl.hue);
    const col = th.name === "night" ? mix(tone, WHITE, 0.35) : mix(tone, INK, 0.1);
    ctx.lineWidth = big ? 4.5 : 3;
    ctx.lineJoin = "round";
    ctx.strokeStyle = big ? th.clusterStroke.replace(/[\d.]+\)$/, "0.75)") : th.clusterStroke;
    ctx.globalAlpha = dimFactor;
    ctx.strokeText(label, best[0], best[1]);
    ctx.fillStyle = rgba(col, th.clusterAlpha);
    ctx.fillText(label, best[0], best[1]);
    ctx.globalAlpha = 1;
  }
  try {
    (ctx as unknown as { letterSpacing: string }).letterSpacing = "0px";
  } catch {
    /* ignore */
  }

  mark("clusterNames");
  /* ---- node labels ---- */
  const mode = st.labelMode;
  ctx.font = `500 11.5px ${th.sans}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.lineJoin = "round";
  const wanted: { i: number; prio: number }[] = [];
  const findSet = hov === null && sel === null && F && F.size <= 40 ? F : null;
  const selNbrs = sel !== null && hov === null ? F : null;
  for (let i = 0; i < N; i++) {
    if (!VIS[i]) continue;
    const x = SX[i];
    const y = SY[i];
    if (x < -10 || x > W + 10 || y < -10 || y > H + 10) continue;
    const sr = nodes[i].r * zs;
    let prio = -1;
    if (i === hov) prio = 100;
    else if (mode === "never") prio = -1;
    else if (i === sel) prio = 90;
    else if (hov !== null && F && F.has(i)) prio = 50 + sr * 0.1;
    else if (selNbrs && selNbrs.has(i)) prio = 40 + sr * 0.1;
    else if (findSet && findSet.has(i)) prio = 40 + sr * 0.1;
    else if (!F || mode === "always") {
      if (st.nodeAlpha[i] < 0.5) prio = -1;
      else if (mode === "always") prio = 1 + sr + (nodes[i].person ? 6 : 0);
      else if (nodes[i].person) prio = cam.k > 0.7 ? 10 + sr : -1;
      else if ((cam.k > 0.9 && sr >= 5.5) || (cam.k > 1.7 && sr >= 3.6)) prio = sr;
    }
    if (prio >= 0) wanted.push({ i, prio });
  }
  wanted.sort((a, b) => b.prio - a.prio || a.i - b.i);
  const maxLabels = mode === "always" ? 150 : 48;
  const labelBoxes: LabelBox[] = [];
  let drawn = 0;
  for (const { i, prio } of wanted) {
    if (prio < 40 && drawn >= maxLabels) break;
    const n = nodes[i];
    const full = i === hov || i === sel;
    const name = n.note.title;
    const label = trunc(n.person && !full ? name.split(/\s+/)[0] : name, full ? 40 : 26);
    const r = rOf(i);
    const w = ctx.measureText(label).width + 6;
    const gap = n.person ? 5 : Math.max(4, r * 0.4 + 3);
    const box: LabelBox = { x0: SX[i] - w / 2, y0: SY[i] + r + gap - 1, x1: SX[i] + w / 2, y1: SY[i] + r + gap + 14 };
    if (prio < 90) {
      let clash = false;
      for (const b of labelBoxes) {
        if (overlaps(box, b)) {
          clash = true;
          break;
        }
      }
      if (clash) continue;
      if (prio < 40 && occupiedByOthers(box)) continue;
    }
    labelBoxes.push(box);
    drawn++;
    ctx.globalAlpha = st.nodeAlpha[i] < 0.5 ? 0.5 : 1;
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = th.labelStroke;
    ctx.strokeText(label, SX[i], SY[i] + r + gap);
    ctx.fillStyle = full ? th.labelInk : th.labelInkDim;
    ctx.fillText(label, SX[i], SY[i] + r + gap);
  }
  ctx.globalAlpha = 1;

  // a lightly crowded label is fine, a label sitting on top of a dozen stars is not
  function occupiedByOthers(box: LabelBox): boolean {
    return occupied(box) > 7;
  }

  mark("labels");
}

function nowMs(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}
