// The interactive canvas: owns the canvas element, size, the animation loop and all pointer input.
// Everything that is not drawing or DOM lives in plain fields so it can be tested without a canvas.
import type { ClusterInfo, EngineOptions, EngineStats, LabelMode, SkyEngineApi, ThemeName, VaultGraph } from "./contract";
import { AvatarStore } from "./avatars";
import { buildLayout, isSettled, positionsOf, reheat, rearrange as rearrangeLayout, settle, tick, updateRadius, type LayoutState } from "./layout";
import { egoNetwork, subgraphOf } from "./model";
import {
  createViewState,
  draw,
  fitCamera,
  hitTest,
  setLayout,
  stepView,
  themeFor,
  toWorld,
  LOD_HUGE,
  MAX_ZOOM,
  MIN_ZOOM,
  type Theme,
  type ViewState,
} from "./render";

const EMPTY: VaultGraph = { nodes: [], edges: [], truncated: false, totalNotes: 0 };

export interface EngineInspect {
  selected: string | null;
  /** ids lit by find, or null when find is clear */
  highlighted: string[] | null;
  local: { center: string; depth: 1 | 2 | 3 } | null;
  /** name of the constellation shown alone, or null */
  constellation: string | null;
  nodeIds: string[];
  edgeCount: number;
  theme: ThemeName;
  labelMode: LabelMode;
}

export class SkyEngine implements SkyEngineApi {
  private opts: EngineOptions;
  private host?: HTMLElement;
  private canvas?: HTMLCanvasElement;
  private ctx?: CanvasRenderingContext2D | null;
  private avatars?: AvatarStore;
  private hostPosition?: string;
  private mounted = false;

  private graph: VaultGraph = EMPTY;
  private full: LayoutState;
  private layout: LayoutState;
  private st: ViewState;
  private theme: Theme;
  private themeName: ThemeName;

  private localCenter: string | null = null;
  private localDepth: 1 | 2 | 3 = 2;
  private savedCam?: { cam: { x: number; y: number; k: number }; target: { x: number; y: number; k: number } };
  private constellation: string | null = null;
  private savedCamC?: { cam: { x: number; y: number; k: number }; target: { x: number; y: number; k: number } };
  private query = "";
  private autoFit = true;
  private needsFit = false;

  private raf = 0;
  private ro?: ResizeObserver;
  private cleanups: Array<() => void> = [];
  private lastFrame = 0;
  private lastDraw = 0;
  private frames = 0;
  private interacting = false;
  private dirty = true;

  private selectCb: (id: string | null) => void = () => {};
  private openCb: (id: string) => void = () => {};
  private statsCb: (s: EngineStats) => void = () => {};

  constructor(opts: EngineOptions) {
    this.opts = opts;
    this.themeName = opts.theme === "paper" ? "paper" : "night";
    this.theme = themeFor(this.themeName);
    this.full = buildLayout(EMPTY);
    this.layout = this.full;
    this.st = createViewState(this.layout, (i, size) => this.portrait(i, size));
    this.st.labelMode = opts.labelMode;
  }

  /* ---------------- lifecycle ---------------- */

  mount(host: HTMLElement): void {
    if (this.mounted) return;
    this.host = host;
    const canvas = document.createElement("canvas");
    canvas.tabIndex = 0;
    canvas.setAttribute("aria-label", "Planisphere: a graph of your notes drawn as stars. Press Enter to open the selected note.");
    canvas.style.cssText = "position:absolute;left:0;top:0;display:block;outline:none;touch-action:none;cursor:default;";
    try {
      if (getComputedStyle(host).position === "static") {
        this.hostPosition = host.style.position || "";
        host.style.position = "relative";
      }
    } catch {
      /* no computed style available */
    }
    host.appendChild(canvas);
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.mounted = true;
    this.theme = themeFor(this.themeName, this.sansFont());
    this.avatars = new AvatarStore({
      resolve: (p) => this.opts.resolveAvatar(p),
      onLoad: () => (this.dirty = true),
      hueOf: (id) => {
        const i = this.layout.byId.get(id);
        return i === undefined ? [134, 178, 236] : this.layout.clusters[this.layout.nodes[i].cluster].hue;
      },
      sans: this.theme.sans,
    });
    this.wire();
    if (typeof ResizeObserver !== "undefined") {
      this.ro = new ResizeObserver(() => this.resize());
      this.ro.observe(host);
    } else if (typeof window !== "undefined") {
      const f = () => this.resize();
      window.addEventListener("resize", f);
      this.cleanups.push(() => window.removeEventListener("resize", f));
    }
    this.resize();
    this.lastFrame = nowMs();
    this.raf = requestAnimationFrame(this.frame);
  }

  destroy(): void {
    if (!this.mounted) return;
    this.mounted = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.ro?.disconnect();
    this.ro = undefined;
    for (const c of this.cleanups) c();
    this.cleanups = [];
    this.avatars?.destroy();
    this.avatars = undefined;
    this.canvas?.remove();
    this.canvas = undefined;
    this.ctx = undefined;
    if (this.host && this.hostPosition !== undefined) this.host.style.position = this.hostPosition;
    this.host = undefined;
  }

  /* ---------------- data ---------------- */

  setData(graph: VaultGraph): void {
    this.graph = graph;
    const keepId = this.selectedId();
    const first = this.full.nodes.length === 0;
    const prev = first ? undefined : positionsOf(this.full);
    const L = buildLayout(graph, { previous: prev });
    settle(L, graph.nodes.length > 1500 ? 260 : 320);
    this.full = L;

    const sub = this.constellation !== null ? this.buildConstellation(this.constellation) : null;
    if (this.localCenter !== null && L.byId.has(this.localCenter)) this.useLayout(this.buildLocal(this.localCenter, this.localDepth));
    else if (sub) {
      this.localCenter = null;
      this.savedCam = undefined;
      this.useLayout(sub);
    } else {
      this.localCenter = null;
      this.savedCam = undefined;
      this.constellation = null;
      this.savedCamC = undefined;
      this.useLayout(L);
    }

    const i = keepId === null ? undefined : this.layout.byId.get(keepId);
    this.st.selected = i === undefined ? null : i;
    this.applyFocus();
    this.avatars?.invalidatePlaceholders();
    if (first && graph.nodes.length) {
      this.autoFit = true;
      this.needsFit = true;
      this.applyFit(true);
    } else if (this.localCenter !== null || this.constellation !== null) this.applyFit(false);
    this.dirty = true;
    if (keepId !== null && i === undefined) this.selectCb(null);
    this.statsCb(this.getStats());
  }

  setTheme(theme: ThemeName): void {
    this.themeName = theme === "paper" ? "paper" : "night";
    this.theme = themeFor(this.themeName, this.mounted ? this.sansFont() : undefined);
    this.dirty = true;
  }

  setLabelMode(mode: LabelMode): void {
    this.st.labelMode = mode;
    this.dirty = true;
  }

  /** Optional extras for the shell. */
  zoomBy(factor: number): void {
    const t = this.st.camTarget;
    t.k = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, t.k * factor));
    this.autoFit = false;
    this.dirty = true;
  }

  /* ---------------- local mode ---------------- */

  setLocal(centerId: string | null, depth: 1 | 2 | 3 = 2): void {
    const d = (depth === 1 || depth === 3 ? depth : 2) as 1 | 2 | 3;
    if (centerId === null || !this.full.byId.has(centerId)) {
      if (this.localCenter === null) return;
      this.leaveLocal();
      return;
    }
    const entering = this.localCenter === null;
    if (!entering && this.localCenter === centerId && this.localDepth === d) return;
    if (entering) this.savedCam = this.savedCamC ?? { cam: { ...this.st.cam }, target: { ...this.st.camTarget } };
    this.constellation = null;
    this.savedCamC = undefined;
    this.localCenter = centerId;
    this.localDepth = d;
    const keep = this.selectedId();
    this.useLayout(this.buildLocal(centerId, d));
    const i = keep === null ? undefined : this.layout.byId.get(keep);
    this.st.selected = i === undefined ? null : i;
    this.st.center = this.layout.byId.get(centerId) ?? null;
    this.applyFocus();
    this.autoFit = true;
    this.applyFit(false);
    this.dirty = true;
    if (keep !== null && i === undefined) this.selectCb(null);
    this.statsCb(this.getStats());
  }

  private leaveLocal(): void {
    const keep = this.selectedId();
    this.localCenter = null;
    this.useLayout(this.full);
    const i = keep === null ? undefined : this.layout.byId.get(keep);
    this.st.selected = i === undefined ? null : i;
    this.applyFocus();
    if (this.savedCam) {
      this.st.camTarget = { ...this.savedCam.target };
      this.autoFit = false;
    } else this.applyFit(false);
    this.savedCam = undefined;
    this.dirty = true;
    this.statsCb(this.getStats());
  }

  /* ---------------- one constellation ---------------- */

  setConstellation(name: string | null): void {
    const sub = name === null ? null : this.buildConstellation(name);
    if (!sub) {
      if (this.constellation === null) return;
      this.leaveConstellation();
      return;
    }
    if (this.constellation === name && this.localCenter === null) return;
    if (this.localCenter !== null) {
      // the shell normally leaves local mode first; if not, keep the camera it saved
      this.localCenter = null;
      this.savedCamC = this.savedCam;
      this.savedCam = undefined;
    } else if (this.constellation === null) {
      this.savedCamC = { cam: { ...this.st.cam }, target: { ...this.st.camTarget } };
    }
    this.constellation = name;
    const keep = this.selectedId();
    this.useLayout(sub);
    const i = keep === null ? undefined : this.layout.byId.get(keep);
    this.st.selected = i === undefined ? null : i;
    this.applyFocus();
    this.autoFit = true;
    this.applyFit(false);
    this.dirty = true;
    if (keep !== null && i === undefined) this.selectCb(null);
    this.statsCb(this.getStats());
  }

  private leaveConstellation(): void {
    const keep = this.selectedId();
    this.constellation = null;
    this.useLayout(this.full);
    const i = keep === null ? undefined : this.layout.byId.get(keep);
    this.st.selected = i === undefined ? null : i;
    this.applyFocus();
    if (this.savedCamC) {
      this.st.camTarget = { ...this.savedCamC.target };
      this.autoFit = false;
    } else {
      this.autoFit = true;
      this.applyFit(false);
    }
    this.savedCamC = undefined;
    this.dirty = true;
    this.statsCb(this.getStats());
  }

  /** The notes of the full graph's constellation called `name`, laid out on their own. null if there is none. */
  private buildConstellation(name: string): LayoutState | null {
    const c = this.full.clusters.find((k) => k.name === name && k.size > 0);
    if (!c) return null;
    const ids = c.members.map((i) => this.full.nodes[i].id);
    const L = buildLayout(subgraphOf(this.graph, ids), { inherit: this.full });
    settle(L, 300);
    return L;
  }

  private buildLocal(centerId: string, depth: number): LayoutState {
    const ids = egoNetwork(this.graph, centerId, depth);
    const L = buildLayout(subgraphOf(this.graph, ids), { inherit: this.full });
    settle(L, 300);
    return L;
  }

  /* ---------------- selection, find, camera ---------------- */

  select(id: string | null, opts?: { pan?: boolean }): void {
    const i = id === null ? undefined : this.layout.byId.get(id);
    this.setSelected(i === undefined ? null : i, !!opts?.pan);
  }

  private setSelected(i: number | null, pan: boolean): void {
    const before = this.selectedId();
    this.st.selected = i;
    const after = this.selectedId();
    if (i !== null && pan) {
      const n = this.layout.nodes[i];
      this.st.camTarget = { x: n.x, y: n.y, k: Math.max(this.st.camTarget.k, 1.1) };
      this.autoFit = false;
    }
    this.dirty = true;
    if (before !== after) this.selectCb(after);
  }

  highlight(query: string): void {
    this.query = query;
    this.applyFocus();
    const f = this.st.focus;
    if (f && f.size) {
      const q = this.query.trim().toLowerCase();
      const nodes = this.layout.nodes;
      const rank = (i: number) => {
        const t = nodes[i].note.title.toLowerCase();
        return t === q ? 0 : t.startsWith(q) ? 1 : 2;
      };
      const matches = Array.from(f).sort((a, b) => rank(a) - rank(b) || nodes[b].deg - nodes[a].deg || a - b);
      this.autoFit = false;
      if (matches.length === 1) {
        const n = nodes[matches[0]];
        this.st.camTarget = { x: n.x, y: n.y, k: Math.max(this.st.camTarget.k, 1.1) };
      } else {
        // several matches: frame them all, but never zoom in past a comfortable level
        fitCamera(this.st, this.padding(), false, f, 1.3);
      }
    }
    this.dirty = true;
  }

  fit(): void {
    this.autoFit = true;
    this.applyFit(false);
    this.dirty = true;
  }

  rearrange(): void {
    rearrangeLayout(this.layout);
    settle(this.layout, 250);
    updateRadius(this.layout);
    this.autoFit = true;
    this.applyFit(false);
    this.dirty = true;
  }

  getStats(): EngineStats {
    const L = this.layout;
    const one = this.constellation !== null;
    const clusters: ClusterInfo[] = (one ? this.full : L).clusters
      .filter((c) => c.size > 0)
      .map((c) => ({ id: c.id, name: c.name, count: c.size, color: `rgb(${c.hue.map(Math.round).join(",")})` }))
      .sort((a, b) => b.count - a.count || a.id - b.id);
    const stats: EngineStats = { nodes: L.nodes.length, edges: L.edges.length, clusters };
    if (one) stats.constellation = this.constellation!;
    return stats;
  }

  onSelect(cb: (id: string | null) => void): void {
    this.selectCb = cb;
  }
  onOpen(cb: (id: string) => void): void {
    this.openCb = cb;
  }
  onStats(cb: (stats: EngineStats) => void): void {
    this.statsCb = cb;
  }

  /** A plain snapshot of the logical state, for tests and debugging. */
  inspect(): EngineInspect {
    const L = this.layout;
    return {
      selected: this.selectedId(),
      highlighted: this.st.focus ? Array.from(this.st.focus).map((i) => L.nodes[i].id) : null,
      local: this.localCenter === null ? null : { center: this.localCenter, depth: this.localDepth },
      constellation: this.constellation,
      nodeIds: L.nodes.map((n) => n.id),
      edgeCount: L.edges.length,
      theme: this.themeName,
      labelMode: this.st.labelMode,
    };
  }

  /** Test and harness access to the internals. Not part of the contract. */
  internals(): { st: ViewState; layout: LayoutState; full: LayoutState; theme: Theme; draw(time?: number): void } {
    return {
      st: this.st,
      layout: this.layout,
      full: this.full,
      theme: this.theme,
      draw: (time = 0) => {
        if (this.ctx) draw(this.ctx, this.st, this.theme, time);
      },
    };
  }

  /* ---------------- helpers ---------------- */

  private selectedId(): string | null {
    const s = this.st.selected;
    return s === null ? null : this.layout.nodes[s]?.id ?? null;
  }

  private portrait(i: number, size: number): CanvasImageSource {
    const n = this.layout.nodes[i].note;
    return this.avatars!.get(n, size);
  }

  private useLayout(L: LayoutState): void {
    this.layout = L;
    setLayout(this.st, L);
    this.st.hovered = null;
    this.st.selected = null;
    this.st.center = null;
  }

  private applyFocus(): void {
    const q = this.query.trim().toLowerCase();
    if (q) {
      const s = new Set<number>();
      for (const n of this.layout.nodes) {
        if (n.note.title.toLowerCase().includes(q) || n.id.toLowerCase().includes(q)) s.add(n.i);
      }
      this.st.focus = s;
    } else this.st.focus = null;
    this.dirty = true;
  }

  private padding() {
    return { top: 56, bottom: 52, left: 40, right: 40 };
  }

  private applyFit(immediate: boolean): void {
    const ready = this.st.width > 4 && this.st.height > 4 && (!this.mounted || this.sized);
    if (!ready) {
      this.needsFit = true;
      return;
    }
    this.needsFit = false;
    fitCamera(this.st, this.padding(), immediate, undefined, this.localCenter !== null || this.constellation !== null ? 1.3 : 1.6);
  }

  private sized = false;

  private sansFont(): string {
    try {
      const f = getComputedStyle(document.body).getPropertyValue("--font-interface").trim();
      return f ? `${f},sans-serif` : themeFor("night").sans;
    } catch {
      return themeFor("night").sans;
    }
  }

  private resize(): void {
    if (!this.mounted || !this.host || !this.canvas) return;
    const r = this.host.getBoundingClientRect();
    const W = Math.max(1, Math.round(r.width));
    const H = Math.max(1, Math.round(r.height));
    if (W < 4 || H < 4) return;
    const dpr = Math.min(2, (typeof window !== "undefined" && window.devicePixelRatio) || 1);
    if (this.canvas.width !== Math.round(W * dpr) || this.canvas.height !== Math.round(H * dpr)) {
      this.canvas.width = Math.round(W * dpr);
      this.canvas.height = Math.round(H * dpr);
    }
    this.canvas.style.width = W + "px";
    this.canvas.style.height = H + "px";
    this.st.width = W;
    this.st.height = H;
    this.st.dpr = dpr;
    const wasSized = this.sized;
    this.sized = true;
    if ((this.needsFit || !wasSized) && this.layout.nodes.length) this.applyFit(true);
    this.dirty = true;
  }

  /* ---------------- input ---------------- */

  private wire(): void {
    const c = this.canvas!;
    let drag: { id: number | null; sx: number; sy: number; cx: number; cy: number; moved: boolean } | null = null;
    const pos = (e: PointerEvent | WheelEvent | MouseEvent): [number, number] => {
      const r = c.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top];
    };
    const on = <T extends Event>(el: EventTarget, type: string, fn: (e: T) => void, o?: AddEventListenerOptions) => {
      el.addEventListener(type, fn as EventListener, o);
      this.cleanups.push(() => el.removeEventListener(type, fn as EventListener, o));
    };
    const setHover = (id: number | null) => {
      if (id === this.st.hovered) return;
      this.st.hovered = id;
      c.style.cursor = id !== null ? "pointer" : "default";
      this.dirty = true;
    };

    on<PointerEvent>(c, "pointerdown", (e) => {
      if (e.button !== undefined && e.button > 0) return;
      const [x, y] = pos(e);
      const id = hitTest(this.st, x, y);
      drag = { id, sx: x, sy: y, cx: this.st.camTarget.x, cy: this.st.camTarget.y, moved: false };
      this.interacting = true;
      try {
        c.setPointerCapture?.(e.pointerId);
      } catch {
        /* synthetic pointer */
      }
      c.focus({ preventScroll: true });
      if (id === null) c.style.cursor = "grabbing";
    });
    on<PointerEvent>(c, "pointermove", (e) => {
      const [x, y] = pos(e);
      if (drag) {
        const dx = x - drag.sx;
        const dy = y - drag.sy;
        if (Math.hypot(dx, dy) > 3) drag.moved = true;
        if (!drag.moved) return;
        this.autoFit = false;
        if (drag.id !== null) {
          const n = this.layout.nodes[drag.id];
          const [wx, wy] = toWorld(this.st, x, y);
          n.x = wx;
          n.y = wy;
          n.pinned = true;
          reheat(this.layout, 0.25);
        } else {
          const k = this.st.cam.k;
          this.st.camTarget.x = drag.cx - dx / k;
          this.st.camTarget.y = drag.cy - dy / k;
          this.st.cam.x = this.st.camTarget.x;
          this.st.cam.y = this.st.camTarget.y;
        }
        this.dirty = true;
        return;
      }
      setHover(hitTest(this.st, x, y));
    });
    const end = (e: PointerEvent) => {
      this.interacting = false;
      c.style.cursor = this.st.hovered !== null ? "pointer" : "default";
      if (!drag) return;
      if (drag.id !== null) this.layout.nodes[drag.id].pinned = false;
      if (!drag.moved) {
        if (drag.id !== null) this.setSelected(drag.id, false);
        else if (this.st.selected !== null) this.setSelected(null, false);
      }
      drag = null;
      try {
        c.releasePointerCapture?.(e.pointerId);
      } catch {
        /* not captured */
      }
    };
    on<PointerEvent>(c, "pointerup", end);
    on<PointerEvent>(c, "pointercancel", end);
    on<PointerEvent>(c, "pointerleave", () => {
      if (!drag) setHover(null);
    });
    on<MouseEvent>(c, "dblclick", (e) => {
      const [x, y] = pos(e);
      const id = hitTest(this.st, x, y);
      if (id !== null) this.openCb(this.layout.nodes[id].id);
    });
    on<WheelEvent>(
      c,
      "wheel",
      (e) => {
        e.preventDefault();
        const [sx, sy] = pos(e);
        const [wx, wy] = toWorld(this.st, sx, sy);
        const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
        const speed = e.ctrlKey ? 0.01 : 0.0015;
        const k = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, this.st.camTarget.k * Math.exp(-e.deltaY * unit * speed)));
        const t = this.st.camTarget;
        t.k = k;
        t.x = wx - (sx - this.st.width / 2) / k;
        t.y = wy - (sy - this.st.height / 2) / k;
        this.st.cam = { ...t };
        this.autoFit = false;
        this.dirty = true;
      },
      { passive: false }
    );
    on<KeyboardEvent>(c, "keydown", (e) => {
      if (e.key === "Enter") {
        const id = this.selectedId();
        if (id !== null) {
          e.preventDefault();
          this.openCb(id);
        }
      } else if (e.key === "Escape") {
        if (this.st.selected !== null) {
          e.stopPropagation();
          this.setSelected(null, false);
        }
      } else if (e.key === "+" || e.key === "=") this.zoomBy(1.25);
      else if (e.key === "-" || e.key === "_") this.zoomBy(1 / 1.25);
      else if (e.key === "0") this.fit();
    });
  }

  /* ---------------- frame loop ---------------- */

  private frame = (now: number): void => {
    if (!this.mounted) return;
    this.raf = requestAnimationFrame(this.frame);
    const canvas = this.canvas;
    if (!canvas || !this.ctx || !canvas.isConnected || this.st.width < 4) return;
    const dt = now - this.lastFrame;
    this.lastFrame = now;
    let active = false;
    if (!isSettled(this.layout)) {
      const t0 = nowMs();
      let n = 0;
      while (n < 3 && (n === 0 || nowMs() - t0 < 6)) {
        tick(this.layout);
        n++;
      }
      active = true;
      if (this.autoFit && (++this.frames & 15) === 0) {
        updateRadius(this.layout);
        fitCamera(this.st, this.padding(), false, undefined, this.localCenter !== null || this.constellation !== null ? 1.3 : 1.6);
      }
    }
    const moving = stepView(this.st, dt, this.theme);
    const idle = !active && !moving && !this.interacting && !this.dirty;
    // small skies twinkle at a low frame rate while idle; big ones sit still
    if (idle && (this.layout.nodes.length > LOD_HUGE || now - this.lastDraw < 90)) return;
    this.lastDraw = now;
    this.dirty = false;
    draw(this.ctx, this.st, this.theme, now);
  };
}

function nowMs(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}
