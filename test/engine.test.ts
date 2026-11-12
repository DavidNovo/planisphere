import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_FILTERS, type EngineStats, type VaultGraph } from "../src/contract";
import { SkyEngine } from "../src/engine";
import { buildGraph } from "../src/model";
import { positionsOf, settle } from "../src/layout";
import { toScreen } from "../src/render";
import { fakePort, lcg, type FakeNote } from "./fakes";

/** Three folders of 12 notes, chained inside, with a long path a -> ... for local mode tests. */
function vault(): VaultGraph {
  const rnd = lcg(5);
  const notes: FakeNote[] = [];
  const folders = ["Projects", "Reading", "Recipes"];
  for (const f of folders) {
    for (let i = 0; i < 12; i++) {
      const links: string[] = [];
      if (i + 1 < 12) links.push(`${f}/n${i + 1}.md`);
      for (let j = 0; j < 3; j++) links.push(`${f}/n${Math.floor(rnd() * 12)}.md`);
      notes.push({ path: `${f}/n${i}.md`, links, tags: f === "Recipes" ? ["food"] : [] });
    }
  }
  notes.push({ path: "People/Ada.md", tags: ["people"], fm: { avatar: "![[ada.png|96]]" }, links: ["Projects/n0.md"] });
  notes.push({ path: "Projects/n0.md", links: ["People/Ada.md", "Reading/n0.md"] }); // overwritten below
  const dedup = new Map(notes.map((n) => [n.path, n]));
  dedup.get("Projects/n0.md")!.links!.push("Projects/n1.md", "Reading/n0.md", "People/Ada.md");
  notes.length = 0;
  notes.push(...dedup.values());
  return buildGraph(fakePort(notes), { ...DEFAULT_FILTERS, showOrphans: true });
}

function makeEngine() {
  const e = new SkyEngine({ theme: "night", labelMode: "auto", resolveAvatar: () => undefined });
  const sel: Array<string | null> = [];
  const open: string[] = [];
  const stats: EngineStats[] = [];
  e.onSelect((id) => sel.push(id));
  e.onOpen((id) => open.push(id));
  e.onStats((s) => stats.push(s));
  return { e, sel, open, stats };
}

describe("engine logic without a canvas", () => {
  it("setData reports stats and fires onStats", () => {
    const { e, stats } = makeEngine();
    const g = vault();
    e.setData(g);
    expect(stats.length).toBe(1);
    expect(stats[0].nodes).toBe(g.nodes.length);
    expect(stats[0].edges).toBeGreaterThan(20);
    expect(stats[0].clusters.length).toBeGreaterThanOrEqual(3);
    expect(stats[0].clusters.reduce((a, c) => a + c.count, 0)).toBe(g.nodes.length);
    expect(stats[0].clusters[0].color).toMatch(/^rgb\(\d+,\d+,\d+\)$/);
    expect(new Set(stats[0].clusters.map((c) => c.name)).size).toBe(stats[0].clusters.length);
    expect(e.getStats()).toEqual(stats[0]);
  });

  it("starts empty", () => {
    const { e } = makeEngine();
    expect(e.getStats()).toEqual({ nodes: 0, edges: 0, clusters: [] });
    expect(e.inspect().selected).toBeNull();
  });

  it("select fires onSelect on change only and clears on unknown ids", () => {
    const { e, sel } = makeEngine();
    e.setData(vault());
    e.select("Projects/n3.md");
    e.select("Projects/n3.md");
    expect(sel).toEqual(["Projects/n3.md"]);
    expect(e.inspect().selected).toBe("Projects/n3.md");
    e.select("Reading/n2.md", { pan: true });
    expect(sel).toEqual(["Projects/n3.md", "Reading/n2.md"]);
    e.select("does/not/exist.md");
    expect(e.inspect().selected).toBeNull();
    expect(sel[sel.length - 1]).toBeNull();
    e.select(null);
    expect(sel.length).toBe(3);
  });

  it("pan moves the camera target onto the node", () => {
    const { e } = makeEngine();
    e.setData(vault());
    e.select("Recipes/n5.md", { pan: true });
    const { st, layout } = e.internals();
    const n = layout.nodes[layout.byId.get("Recipes/n5.md")!];
    expect(st.camTarget.x).toBeCloseTo(n.x);
    expect(st.camTarget.y).toBeCloseTo(n.y);
    expect(st.camTarget.k).toBeGreaterThanOrEqual(1.1);
  });

  it("selection survives setData when the node is still there and clears when it is gone", () => {
    const { e, sel } = makeEngine();
    const g = vault();
    e.setData(g);
    e.select("Projects/n3.md");
    e.setData(g);
    expect(e.inspect().selected).toBe("Projects/n3.md");
    const g2 = { ...g, nodes: g.nodes.filter((n) => n.id !== "Projects/n3.md"), edges: g.edges.filter((x) => x.from !== "Projects/n3.md" && x.to !== "Projects/n3.md") };
    e.setData(g2);
    expect(e.inspect().selected).toBeNull();
    expect(sel[sel.length - 1]).toBeNull();
  });

  it("setData keeps positions of notes that were already there", () => {
    const { e } = makeEngine();
    const g = vault();
    e.setData(g);
    settle(e.internals().layout, 1e9);
    const before = positionsOf(e.internals().layout);
    e.setData({ ...g, nodes: [...g.nodes, { ...g.nodes[0], id: "Projects/brand-new.md", title: "brand-new" }], edges: [...g.edges, { from: "Projects/brand-new.md", to: "Projects/n2.md" }] });
    const L = e.internals().layout;
    let maxMove = 0;
    for (const n of L.nodes) {
      const p = before.get(n.id);
      if (p) maxMove = Math.max(maxMove, Math.hypot(n.x - p.x, n.y - p.y));
    }
    expect(maxMove).toBeLessThan(200);
    expect(L.byId.has("Projects/brand-new.md")).toBe(true);
  });

  it("highlight dims everything that does not match, and clears", () => {
    const { e } = makeEngine();
    e.setData(vault());
    e.highlight("recipes/n1");
    const h = e.inspect().highlighted!;
    expect(h.sort()).toEqual(["Recipes/n1.md", "Recipes/n10.md", "Recipes/n11.md"].sort());
    e.highlight("ada");
    expect(e.inspect().highlighted).toEqual(["People/Ada.md"]);
    expect(e.internals().st.camTarget.k).toBeGreaterThanOrEqual(1.1);
    e.highlight("zzzzz");
    expect(e.inspect().highlighted).toEqual([]);
    e.highlight("");
    expect(e.inspect().highlighted).toBeNull();
    e.highlight("   ");
    expect(e.inspect().highlighted).toBeNull();
  });

  it("theme and label mode are stored", () => {
    const { e } = makeEngine();
    e.setTheme("paper");
    e.setLabelMode("always");
    expect(e.inspect()).toMatchObject({ theme: "paper", labelMode: "always" });
    expect(e.internals().theme.name).toBe("paper");
  });

  describe("local mode", () => {
    it("shows the ego network to the requested depth, computed from the full graph", () => {
      const { e, stats } = makeEngine();
      const g = vault();
      e.setData(g);
      const full = e.getStats();
      e.setLocal("Projects/n5.md", 1);
      const d1 = e.inspect();
      expect(d1.local).toEqual({ center: "Projects/n5.md", depth: 1 });
      expect(d1.nodeIds).toContain("Projects/n5.md");
      expect(d1.nodeIds.length).toBeLessThan(full.nodes);
      for (const id of d1.nodeIds) {
        const linked = id === "Projects/n5.md" || g.edges.some((x) => (x.from === id && x.to === "Projects/n5.md") || (x.to === id && x.from === "Projects/n5.md"));
        expect(linked).toBe(true);
      }
      e.setLocal("Projects/n5.md", 2);
      const d2 = e.inspect().nodeIds.length;
      e.setLocal("Projects/n5.md", 3);
      const d3 = e.inspect().nodeIds.length;
      expect(d2).toBeGreaterThan(d1.nodeIds.length);
      expect(d3).toBeGreaterThanOrEqual(d2);
      expect(stats[stats.length - 1].nodes).toBe(d3);
      expect(e.getStats().nodes).toBe(d3);
    });

    it("leaving local mode restores the full graph and exactly the same positions", () => {
      const { e } = makeEngine();
      e.setData(vault());
      settle(e.internals().layout, 1e9);
      const before = positionsOf(e.internals().layout);
      const fullStats = e.getStats();
      e.setLocal("Reading/n4.md", 2);
      expect(e.getStats().nodes).toBeLessThan(fullStats.nodes);
      e.setLocal(null, 2);
      expect(e.inspect().local).toBeNull();
      expect(e.getStats()).toEqual(fullStats);
      for (const n of e.internals().layout.nodes) expect({ x: n.x, y: n.y }).toEqual(before.get(n.id));
    });

    it("keeps cluster names and colours from the full graph", () => {
      const { e } = makeEngine();
      e.setData(vault());
      const fullNames = new Map(e.getStats().clusters.map((c) => [c.name, c.color]));
      e.setLocal("Recipes/n2.md", 1);
      for (const c of e.getStats().clusters) expect(fullNames.get(c.name)).toBe(c.color);
    });

    it("ignores unknown centres, and leaving when not local does nothing", () => {
      const { e, stats } = makeEngine();
      e.setData(vault());
      const n = stats.length;
      e.setLocal(null, 2);
      e.setLocal("nope.md", 2);
      expect(stats.length).toBe(n);
      expect(e.inspect().local).toBeNull();
    });

    it("drops a selection that is not in the local graph", () => {
      const { e, sel } = makeEngine();
      e.setData(vault());
      e.select("Recipes/n11.md");
      e.setLocal("Projects/n0.md", 1);
      expect(e.inspect().selected).toBeNull();
      expect(sel[sel.length - 1]).toBeNull();
    });

    it("marks the centre and survives setData", () => {
      const { e } = makeEngine();
      const g = vault();
      e.setData(g);
      e.setLocal("Projects/n0.md", 2);
      const { st, layout } = e.internals();
      expect(layout.nodes[st.center!].id).toBe("Projects/n0.md");
      e.setData(g);
      expect(e.inspect().local).toEqual({ center: "Projects/n0.md", depth: 2 });
      expect(e.internals().layout.nodes.some((n) => n.id === "Recipes/n11.md")).toBe(false);
    });

    it("falls back to the full graph when setData removes the centre", () => {
      const { e } = makeEngine();
      const g = vault();
      e.setData(g);
      e.setLocal("Projects/n0.md", 1);
      e.setData({ ...g, nodes: g.nodes.filter((n) => n.id !== "Projects/n0.md"), edges: g.edges.filter((x) => x.from !== "Projects/n0.md" && x.to !== "Projects/n0.md") });
      expect(e.inspect().local).toBeNull();
    });
  });

  describe("one constellation", () => {
    it("shows only that constellation's notes, and keeps listing every constellation", () => {
      const { e, stats } = makeEngine();
      e.setData(vault());
      const full = e.getStats();
      const target = full.clusters[0];
      e.setConstellation(target.name);
      const st = e.getStats();
      expect(e.inspect().constellation).toBe(target.name);
      expect(st.constellation).toBe(target.name);
      expect(st.nodes).toBe(target.count);
      expect(st.nodes).toBeLessThan(full.nodes);
      expect(st.clusters).toEqual(full.clusters);
      expect(stats[stats.length - 1]).toEqual(st);
      const { full: F } = e.internals();
      const members = new Set(F.clusters.find((c) => c.name === target.name)!.members.map((i) => F.nodes[i].id));
      for (const id of e.inspect().nodeIds) expect(members.has(id)).toBe(true);
    });

    it("null restores the full graph, its positions and the camera", () => {
      const { e } = makeEngine();
      e.setData(vault());
      settle(e.internals().layout, 1e9);
      const before = positionsOf(e.internals().layout);
      const fullStats = e.getStats();
      const target = { ...e.internals().st.camTarget };
      e.setConstellation(fullStats.clusters[1].name);
      e.setConstellation(null);
      expect(e.inspect().constellation).toBeNull();
      expect(e.getStats()).toEqual(fullStats);
      expect(e.internals().st.camTarget).toEqual(target);
      for (const n of e.internals().layout.nodes) expect({ x: n.x, y: n.y }).toEqual(before.get(n.id));
    });

    it("ignores unknown names, and clearing when nothing is shown alone does nothing", () => {
      const { e, stats } = makeEngine();
      e.setData(vault());
      const n = stats.length;
      e.setConstellation(null);
      e.setConstellation("No such sky");
      expect(stats.length).toBe(n);
      expect(e.inspect().constellation).toBeNull();
    });

    it("drops a selection outside the constellation and keeps one inside", () => {
      const { e, sel } = makeEngine();
      e.setData(vault());
      const { full: F } = e.internals();
      const c = F.clusters.find((k) => k.size > 1)!;
      const inside = F.nodes[c.members[0]].id;
      const outside = F.nodes.find((nd) => nd.cluster !== c.id)!.id;
      e.select(inside);
      e.setConstellation(c.name);
      expect(e.inspect().selected).toBe(inside);
      e.setConstellation(null);
      e.select(outside);
      e.setConstellation(c.name);
      expect(e.inspect().selected).toBeNull();
      expect(sel[sel.length - 1]).toBeNull();
    });

    it("entering local mode clears it, and it survives setData", () => {
      const { e } = makeEngine();
      const g = vault();
      e.setData(g);
      const name = e.getStats().clusters[0].name;
      e.setConstellation(name);
      e.setData(g);
      expect(e.inspect().constellation).toBe(name);
      e.setLocal("Projects/n0.md", 1);
      expect(e.inspect().constellation).toBeNull();
      expect(e.getStats().constellation).toBeUndefined();
      e.setConstellation(name);
      expect(e.inspect().local).toBeNull();
      expect(e.inspect().constellation).toBe(name);
    });
  });

  it("rearrange and fit do not throw and keep the data", () => {
    const { e } = makeEngine();
    e.setData(vault());
    const n = e.getStats().nodes;
    e.rearrange();
    e.fit();
    expect(e.getStats().nodes).toBe(n);
  });

  it("destroy is safe without mount and twice", () => {
    const { e } = makeEngine();
    e.destroy();
    e.destroy();
  });
});

/* ---- input handling through a minimal fake DOM ---- */

type Handler = (e: Record<string, unknown>) => void;
function fakeDom() {
  const handlers = new Map<string, Handler[]>();
  const style: Record<string, string> = {};
  const canvas = {
    style,
    width: 0,
    height: 0,
    tabIndex: -1,
    attrs: {} as Record<string, string>,
    isConnected: true,
    removed: false,
    setAttribute(k: string, v: string) {
      this.attrs[k] = v;
    },
    addEventListener(t: string, f: Handler) {
      handlers.set(t, [...(handlers.get(t) || []), f]);
    },
    removeEventListener(t: string, f: Handler) {
      handlers.set(t, (handlers.get(t) || []).filter((x) => x !== f));
    },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    getContext: () => null,
    focus() {},
    remove() {
      this.removed = true;
    },
  };
  const hostStyle: Record<string, string> = {};
  const host = {
    style: hostStyle,
    children: [] as unknown[],
    appendChild(c: unknown) {
      this.children.push(c);
    },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
  };
  const fire = (type: string, ev: Record<string, unknown> = {}) => (handlers.get(type) || []).forEach((h) => h({ preventDefault() {}, stopPropagation() {}, button: 0, pointerId: 1, ...ev }));
  const count = () => Array.from(handlers.values()).reduce((a, l) => a + l.length, 0);
  return { canvas, host, fire, count };
}

describe("engine input", () => {
  let dom: ReturnType<typeof fakeDom>;
  const g = globalThis as Record<string, unknown>;
  beforeEach(() => {
    dom = fakeDom();
    g.document = { createElement: () => dom.canvas, body: {} };
    g.getComputedStyle = () => ({ position: "static", getPropertyValue: () => "" });
    g.requestAnimationFrame = vi.fn(() => 7);
    g.cancelAnimationFrame = vi.fn();
  });
  afterEach(() => {
    delete g.document;
    delete g.getComputedStyle;
    delete g.requestAnimationFrame;
    delete g.cancelAnimationFrame;
  });

  function mounted() {
    const m = makeEngine();
    m.e.setData(vault());
    m.e.mount(dom.host as unknown as HTMLElement);
    return m;
  }
  const screenOf = (e: SkyEngine, id: string): [number, number] => {
    const { st, layout } = e.internals();
    const n = layout.nodes[layout.byId.get(id)!];
    return toScreen(st, n.x, n.y);
  };

  it("mounts an accessible canvas, positions the host, sizes itself, and destroys cleanly twice", () => {
    const { e } = mounted();
    expect(dom.host.children).toEqual([dom.canvas]);
    expect(dom.canvas.tabIndex).toBe(0);
    expect(dom.canvas.attrs["aria-label"]).toMatch(/Planisphere/);
    expect(dom.host.style.position).toBe("relative");
    expect(dom.canvas.style.width).toBe("800px");
    expect(e.internals().st.width).toBe(800);
    expect(dom.count()).toBeGreaterThan(5);
    e.destroy();
    e.destroy();
    expect(dom.canvas.removed).toBe(true);
    expect(dom.count()).toBe(0);
    expect((g.cancelAnimationFrame as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
    expect(dom.host.style.position).toBe("");
  });

  it("click selects, click on empty space clears", () => {
    const { e, sel } = mounted();
    const [x, y] = screenOf(e, "Reading/n3.md");
    dom.fire("pointerdown", { clientX: x, clientY: y });
    dom.fire("pointerup", { clientX: x, clientY: y });
    expect(e.inspect().selected).toBe("Reading/n3.md");
    dom.fire("pointerdown", { clientX: 2, clientY: 2 });
    dom.fire("pointerup", { clientX: 2, clientY: 2 });
    expect(e.inspect().selected).toBeNull();
    expect(sel).toEqual(["Reading/n3.md", null]);
  });

  it("hover sets and clears, pointer leave clears", () => {
    const { e } = mounted();
    const [x, y] = screenOf(e, "Projects/n2.md");
    dom.fire("pointermove", { clientX: x, clientY: y });
    expect(e.internals().st.hovered).not.toBeNull();
    expect(dom.canvas.style.cursor).toBe("pointer");
    dom.fire("pointerleave");
    expect(e.internals().st.hovered).toBeNull();
  });

  it("double click and Enter open", () => {
    const { e, open } = mounted();
    const [x, y] = screenOf(e, "Recipes/n7.md");
    dom.fire("dblclick", { clientX: x, clientY: y });
    expect(open).toEqual(["Recipes/n7.md"]);
    dom.fire("keydown", { key: "Enter" });
    expect(open).toEqual(["Recipes/n7.md"]); // nothing selected: no open
    e.select("Reading/n1.md");
    dom.fire("keydown", { key: "Enter" });
    expect(open).toEqual(["Recipes/n7.md", "Reading/n1.md"]);
    dom.fire("keydown", { key: "Escape" });
    expect(e.inspect().selected).toBeNull();
  });

  it("dragging a node moves it without selecting; dragging the background pans", () => {
    const { e, sel } = mounted();
    const [x, y] = screenOf(e, "Projects/n4.md");
    const before = { ...e.internals().layout.nodes[e.internals().layout.byId.get("Projects/n4.md")!] };
    dom.fire("pointerdown", { clientX: x, clientY: y });
    dom.fire("pointermove", { clientX: x + 60, clientY: y + 30 });
    const n = e.internals().layout.nodes[e.internals().layout.byId.get("Projects/n4.md")!];
    expect(n.pinned).toBe(true);
    expect(n.x - before.x).toBeGreaterThan(10);
    dom.fire("pointerup", { clientX: x + 60, clientY: y + 30 });
    expect(n.pinned).toBe(false);
    expect(sel).toEqual([]);

    const cam0 = { ...e.internals().st.cam };
    dom.fire("pointerdown", { clientX: 3, clientY: 590 });
    dom.fire("pointermove", { clientX: 43, clientY: 570 });
    dom.fire("pointerup", { clientX: 43, clientY: 570 });
    const cam1 = e.internals().st.cam;
    expect(cam1.x).toBeLessThan(cam0.x);
    expect(cam1.y).toBeGreaterThan(cam0.y);
    expect(cam1.k).toBe(cam0.k);
    expect(sel).toEqual([]);
  });

  it("wheel zooms around the cursor", () => {
    const { e } = mounted();
    const { st } = e.internals();
    const sx = 123;
    const sy = 456;
    const world = (s: typeof st) => [(sx - s.width / 2) / s.cam.k + s.cam.x, (sy - s.height / 2) / s.cam.k + s.cam.y];
    const w0 = world(st);
    const k0 = st.cam.k;
    dom.fire("wheel", { clientX: sx, clientY: sy, deltaY: -300, deltaMode: 0 });
    expect(st.cam.k).toBeGreaterThan(k0);
    const w1 = world(st);
    expect(w1[0]).toBeCloseTo(w0[0], 4);
    expect(w1[1]).toBeCloseTo(w0[1], 4);
    dom.fire("wheel", { clientX: sx, clientY: sy, deltaY: 1e7, deltaMode: 0 });
    expect(st.cam.k).toBeGreaterThanOrEqual(0.04);
  });
});
