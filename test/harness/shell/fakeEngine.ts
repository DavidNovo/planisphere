// Throwaway stand-in for src/engine.ts. Draws a plausible fake sky. Not shipped.
import type { ClusterInfo, EngineOptions, EngineStats, LabelMode, SkyEngineApi, ThemeName, VaultGraph } from "../../../src/contract";

const COLORS = ["#8fb4ff", "#c79bff", "#7fe0c4", "#ffc27a", "#ff8fa8", "#b4e07a", "#7fd0ff"];
function hash(s: string) { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return (h >>> 0) / 4294967295; }

export class SkyEngine implements SkyEngineApi {
  private cv!: HTMLCanvasElement; private ctx!: CanvasRenderingContext2D; private host!: HTMLElement;
  private g: VaultGraph = { nodes: [], edges: [], truncated: false, totalNotes: 0 };
  private pos = new Map<string, { x: number; y: number }>();
  private cluster = new Map<string, number>();
  private clusters: ClusterInfo[] = [];
  private visible: Set<string> | null = null;
  private one: string | null = null;
  private sel: string | null = null; private q = "";
  private cbSel: (id: string | null) => void = () => {}; private cbOpen: (id: string) => void = () => {}; private cbStats: (s: EngineStats) => void = () => {};
  private ro?: ResizeObserver; private opts: EngineOptions; private imgs = new Map<string, HTMLImageElement>();
  constructor(o: EngineOptions) { this.opts = o; }
  mount(host: HTMLElement) {
    this.host = host; this.cv = document.createElement("canvas"); host.appendChild(this.cv); this.ctx = this.cv.getContext("2d")!;
    this.ro = new ResizeObserver(() => this.draw()); this.ro.observe(host);
    this.cv.addEventListener("click", (e) => {
      const r = this.cv.getBoundingClientRect(); const x = e.clientX - r.left, y = e.clientY - r.top;
      let best: string | null = null, bd = 18;
      for (const n of this.nodes()) { const p = this.xy(n.id); const d = Math.hypot(p.x - x, p.y - y); if (d < bd) { bd = d; best = n.id; } }
      this.select(best);
    });
  }
  destroy() { this.ro?.disconnect(); this.cv?.remove(); }
  private nodes() { return this.g.nodes.filter((n) => !this.visible || this.visible.has(n.id)); }
  private xy(id: string) { const w = this.host.clientWidth, h = this.host.clientHeight; const p = this.pos.get(id)!; return { x: p.x * w, y: 60 + p.y * (h - 100) }; }
  setData(g: VaultGraph) {
    this.g = g;
    const tops = [...new Set(g.nodes.map((n) => n.folder.split("/")[0] || "Loose notes"))];
    this.clusters = tops.map((t, i) => ({ id: i, name: t, count: 0, color: COLORS[i % COLORS.length] }));
    g.nodes.forEach((n) => {
      const t = n.folder.split("/")[0] || "Loose notes"; const ci = tops.indexOf(t); this.cluster.set(n.id, ci); this.clusters[ci].count++;
      const a = (ci / tops.length) * Math.PI * 2 + 0.4, cx = 0.5 + Math.cos(a) * 0.26, cy = 0.5 + Math.sin(a) * 0.3;
      const r = 0.1 * Math.sqrt(hash(n.id + "r")), b = hash(n.id + "a") * Math.PI * 2;
      this.pos.set(n.id, { x: cx + Math.cos(b) * r * 1.3, y: cy + Math.sin(b) * r * 1.5 });
    });
    this.draw(); this.emitStats();
  }
  private emitStats() { this.cbStats(this.getStats()); }
  getStats(): EngineStats { const ns = this.nodes(); const ids = new Set(ns.map((n) => n.id)); return { nodes: ns.length, edges: this.g.edges.filter((e) => ids.has(e.from) && ids.has(e.to)).length, clusters: this.clusters.filter((c) => c.count > 0), ...(this.one ? { constellation: this.one } : {}) }; }
  setTheme(t: ThemeName) { this.opts.theme = t; this.draw(); }
  setLabelMode(m: LabelMode) { this.opts.labelMode = m; this.draw(); }
  setLocal(c: string | null, d: 1 | 2 | 3) {
    if (c) this.one = null;
    if (!c || !this.g.nodes.some((n) => n.id === c)) { this.visible = null; } else {
      const adj = new Map<string, string[]>(); for (const e of this.g.edges) { (adj.get(e.from) ?? adj.set(e.from, []).get(e.from)!).push(e.to); (adj.get(e.to) ?? adj.set(e.to, []).get(e.to)!).push(e.from); }
      const seen = new Set([c]); let fr = [c]; for (let i = 0; i < d; i++) { const nx: string[] = []; for (const x of fr) for (const y of adj.get(x) ?? []) if (!seen.has(y)) { seen.add(y); nx.push(y); } fr = nx; }
      this.visible = seen;
      // spread local nodes on rings around the centre
      const ring = [...seen].filter((x) => x !== c); this.pos.set(c, { x: 0.5, y: 0.5 });
      ring.forEach((id, i) => { const a = (i / ring.length) * Math.PI * 2, r = 0.16 + 0.14 * hash(id); this.pos.set(id, { x: 0.5 + Math.cos(a) * r * 1.2, y: 0.5 + Math.sin(a) * r * 1.3 }); });
    }
    this.draw(); this.emitStats();
  }
  setConstellation(name: string | null) {
    const ci = name === null ? -1 : this.clusters.findIndex((c) => c.name === name);
    this.one = ci < 0 ? null : name;
    this.visible = ci < 0 ? null : new Set(this.g.nodes.filter((n) => this.cluster.get(n.id) === ci).map((n) => n.id));
    this.draw(); this.emitStats();
  }
  select(id: string | null) { this.sel = id; this.draw(); this.cbSel(id); }
  highlight(q: string) { this.q = q.trim().toLowerCase(); this.draw(); }
  fit() {} rearrange() {}
  onSelect(cb: (id: string | null) => void) { this.cbSel = cb; } onOpen(cb: (id: string) => void) { this.cbOpen = cb; } onStats(cb: (s: EngineStats) => void) { this.cbStats = cb; }
  private img(path: string) { let i = this.imgs.get(path); if (!i) { const u = this.opts.resolveAvatar(path); if (!u) return null; i = new Image(); i.onload = () => this.draw(); i.src = u; this.imgs.set(path, i); } return i.complete && i.naturalWidth ? i : null; }
  private draw() {
    if (!this.cv) return; const W = this.host.clientWidth, H = this.host.clientHeight; if (!W) return;
    const dpr = 1; this.cv.width = W * dpr; this.cv.height = H * dpr; const c = this.ctx; const night = this.opts.theme === "night";
    c.fillStyle = night ? "#070a1a" : "#f1ead9"; c.fillRect(0, 0, W, H);
    for (let i = 0; i < 160; i++) { c.fillStyle = night ? `rgba(220,230,255,${0.1 + hash("s" + i) * 0.35})` : `rgba(110,84,50,${0.05 + hash("s" + i) * 0.1})`; c.fillRect(hash("x" + i) * W, hash("y" + i) * H, 1.2, 1.2); }
    const ns = this.nodes(); const ids = new Set(ns.map((n) => n.id)); const nb = new Set<string>();
    if (this.sel) for (const e of this.g.edges) { if (e.from === this.sel) nb.add(e.to); if (e.to === this.sel) nb.add(e.from); }
    c.lineWidth = 1;
    for (const e of this.g.edges) { if (!ids.has(e.from) || !ids.has(e.to)) continue; const a = this.xy(e.from), b = this.xy(e.to); const lit = this.sel && (e.from === this.sel || e.to === this.sel);
      c.strokeStyle = lit ? (night ? "rgba(200,215,255,.7)" : "rgba(90,60,30,.7)") : night ? "rgba(150,170,255,.13)" : "rgba(110,84,50,.16)"; c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke(); }
    for (const n of ns) {
      const p = this.xy(n.id); const col = this.clusters[this.cluster.get(n.id) ?? 0]?.color ?? "#fff"; const deg = n.inDegree + n.outDegree;
      const dim = (this.q && !(n.title.toLowerCase().includes(this.q) || n.id.toLowerCase().includes(this.q))) || (this.sel && n.id !== this.sel && !nb.has(n.id));
      c.globalAlpha = dim ? 0.2 : 1;
      if (n.isPerson) { const R = 13; const im = n.avatarPath ? this.img(n.avatarPath) : null; c.save(); c.beginPath(); c.arc(p.x, p.y, R, 0, 7); c.clip(); if (im) c.drawImage(im, p.x - R, p.y - R, R * 2, R * 2); else { c.fillStyle = col; c.fillRect(p.x - R, p.y - R, R * 2, R * 2); } c.restore();
        c.strokeStyle = n.mentions > 0 ? "#e8c46a" : col; c.lineWidth = 2; c.beginPath(); c.arc(p.x, p.y, R + 1.5, 0, 7); c.stroke(); }
      else { const r = 2 + Math.sqrt(deg) * 1.2; const gr = c.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 4); gr.addColorStop(0, col + "aa"); gr.addColorStop(1, col + "00"); c.fillStyle = gr; c.beginPath(); c.arc(p.x, p.y, r * 4, 0, 7); c.fill(); c.fillStyle = night ? "#fff" : "#3a2c1c"; c.beginPath(); c.arc(p.x, p.y, r, 0, 7); c.fill(); }
      if (n.id === this.sel) { c.strokeStyle = night ? "#fff" : "#2e241a"; c.lineWidth = 1.5; c.beginPath(); c.arc(p.x, p.y, 20, 0, 7); c.stroke(); }
      c.globalAlpha = 1;
      if (this.opts.labelMode !== "never" && (deg >= 5 || n.id === this.sel || n.isPerson || this.opts.labelMode === "always") && !dim) { c.font = "12px Georgia, serif"; c.fillStyle = night ? "rgba(225,232,255,.9)" : "rgba(46,36,26,.9)"; c.textAlign = "center"; c.fillText(n.title, p.x, p.y + (n.isPerson ? 28 : 16)); }
    }
  }
}
