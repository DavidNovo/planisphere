import { describe, expect, it } from "vitest";
import type { NoteNode, VaultGraph } from "../src/contract";
import { buildLayout, settle } from "../src/layout";
import { MAX_ZOOM, MIN_ZOOM, NIGHT, boundsOf, createViewState, fitCamera, focusSet, hitTest, nodeScale, setLayout, stepView, toScreen, toWorld } from "../src/render";

const note = (id: string, extra: Partial<NoteNode> = {}): NoteNode => ({ id, title: id, folder: "", tags: [], inDegree: 0, outDegree: 0, isPerson: false, mentions: 0, mtime: 0, ...extra });

function view() {
  const g: VaultGraph = {
    nodes: [note("a"), note("b"), note("c"), note("p", { isPerson: true }), note("far")],
    edges: [
      { from: "a", to: "b" },
      { from: "b", to: "c" },
      { from: "a", to: "p" },
    ],
    truncated: false,
    totalNotes: 5,
  };
  const L = buildLayout(g);
  settle(L, 1e9);
  const st = createViewState(L, () => ({}) as CanvasImageSource);
  st.width = 800;
  st.height = 600;
  return { st, L };
}

describe("camera maths", () => {
  it("toScreen and toWorld are inverses", () => {
    const { st } = view();
    st.cam = { x: 37, y: -12, k: 0.7 };
    const [sx, sy] = toScreen(st, 100, 50);
    const [wx, wy] = toWorld(st, sx, sy);
    expect(wx).toBeCloseTo(100);
    expect(wy).toBeCloseTo(50);
  });

  it("fitCamera frames every node inside the padding", () => {
    const { st, L } = view();
    fitCamera(st, { top: 50, bottom: 50, left: 50, right: 50 }, true);
    for (const n of L.nodes) {
      const [x, y] = toScreen(st, n.x, n.y);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(800);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(600);
    }
    expect(st.cam.k).toBeGreaterThanOrEqual(MIN_ZOOM);
    expect(st.cam.k).toBeLessThanOrEqual(MAX_ZOOM);
  });

  it("fitCamera on a subset caps the zoom", () => {
    const { st } = view();
    fitCamera(st, undefined, true, [0], 1.3);
    expect(st.cam.k).toBeLessThanOrEqual(1.3);
    expect(boundsOf(st, [0])).not.toBeNull();
  });

  it("stepView converges on the target and reports motion until then", () => {
    const { st } = view();
    st.camTarget = { x: 100, y: 100, k: 2 };
    let moving = true;
    let n = 0;
    while (moving && n++ < 500) moving = stepView(st, 16, NIGHT);
    expect(moving).toBe(false);
    expect(st.cam).toEqual({ x: 100, y: 100, k: 2 });
  });
});

describe("hit testing", () => {
  it("finds the node under the pointer and nothing in empty space", () => {
    const { st, L } = view();
    fitCamera(st, undefined, true);
    for (const n of L.nodes) {
      const [x, y] = toScreen(st, n.x, n.y);
      expect(hitTest(st, x, y)).toBe(n.i);
    }
    expect(hitTest(st, -500, -500)).toBeNull();
  });

  it("small stars get a minimum target of a few pixels", () => {
    const { st, L } = view();
    fitCamera(st, undefined, true);
    const n = L.nodes[0];
    const [x, y] = toScreen(st, n.x, n.y);
    expect(hitTest(st, x + 5, y)).toBe(n.i);
  });

  it("node radius grows with zoom more slowly than distance", () => {
    expect(nodeScale(2) / nodeScale(1)).toBeLessThan(2);
    expect(nodeScale(0.5)).toBeGreaterThan(0.5);
  });
});

describe("focus", () => {
  it("hover beats selection beats find", () => {
    const { st, L } = view();
    const a = L.byId.get("a")!;
    const c = L.byId.get("c")!;
    st.focus = new Set([L.byId.get("far")!]);
    expect(Array.from(focusSet(st)!)).toEqual([L.byId.get("far")!]);
    st.selected = a;
    expect(focusSet(st)!.has(L.byId.get("b")!)).toBe(true);
    expect(focusSet(st)!.has(c)).toBe(false);
    st.hovered = c;
    expect(focusSet(st)!.has(L.byId.get("b")!)).toBe(true);
    expect(focusSet(st)!.has(a)).toBe(false);
    st.hovered = null;
    st.selected = null;
    st.focus = null;
    expect(focusSet(st)).toBeNull();
  });

  it("setLayout drops stale indices", () => {
    const { st } = view();
    st.hovered = 4;
    st.selected = 4;
    setLayout(st, buildLayout({ nodes: [note("x")], edges: [], truncated: false, totalNotes: 1 }));
    expect(st.hovered).toBeNull();
    expect(st.selected).toBeNull();
    expect(st.nodeAlpha.length).toBe(1);
  });
});
