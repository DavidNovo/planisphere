import { describe, expect, it } from "vitest";
import type { NoteNode, VaultGraph } from "../src/contract";
import {
  LOOSE_NAME,
  buildLayout,
  detectCommunities,
  groupCommunities,
  isSettled,
  nameClusters,
  splitCamel,
  nodeRadius,
  positionsOf,
  prettyName,
  rearrange,
  settle,
  tick,
} from "../src/layout";
import { lcg } from "./fakes";

function node(id: string, extra: Partial<NoteNode> = {}): NoteNode {
  const slash = id.lastIndexOf("/");
  return {
    id,
    title: id.slice(slash + 1).replace(/\.md$/, ""),
    folder: slash >= 0 ? id.slice(0, slash) : "",
    tags: [],
    inDegree: 0,
    outDegree: 0,
    isPerson: false,
    mentions: 0,
    mtime: 0,
    ...extra,
  };
}

/** Planted partition: `blocks` blocks of `size` notes, dense inside, a few links between. */
function planted(blocks: number, size: number, seed = 3, folder = (b: number) => `Block${b}`): VaultGraph {
  const rnd = lcg(seed);
  const nodes: NoteNode[] = [];
  const edges: { from: string; to: string }[] = [];
  for (let b = 0; b < blocks; b++) for (let i = 0; i < size; i++) nodes.push(node(`${folder(b)}/n${b}_${i}.md`));
  const id = (b: number, i: number) => nodes[b * size + i].id;
  for (let b = 0; b < blocks; b++) {
    for (let i = 0; i < size; i++) {
      for (let j = i + 1; j < size; j++) if (rnd() < 0.3 || j === i + 1) edges.push({ from: id(b, i), to: id(b, j) });
    }
    if (b + 1 < blocks) for (let k = 0; k < 2; k++) edges.push({ from: id(b, k), to: id(b + 1, size - 1 - k) });
  }
  return { nodes, edges, truncated: false, totalNotes: nodes.length };
}

describe("community detection", () => {
  it("finds planted communities", () => {
    const g = planted(4, 30);
    const L = buildLayout(g);
    const real = L.clusters.filter((c) => !c.loose);
    expect(real.length).toBe(4);
    // every block lands in exactly one cluster
    for (let b = 0; b < 4; b++) {
      const labels = new Set(L.nodes.filter((n) => n.id.startsWith(`Block${b}/`)).map((n) => n.cluster));
      expect(labels.size).toBe(1);
    }
    expect(L.clusters.some((c) => c.loose)).toBe(false);
  });

  it("is deterministic", () => {
    const adj: number[][] = [[1, 2], [0, 2], [0, 1, 3], [2, 4, 5], [3, 5], [3, 4]];
    expect(detectCommunities(6, adj, 7)).toEqual(detectCommunities(6, adj, 7));
  });

  it("puts isolated notes and tiny islands in the loose group, which has the highest label", () => {
    const g = planted(2, 12);
    g.nodes.push(node("Lone/a.md"), node("Lone/b.md"), node("Lone/c.md"), node("Pair/x.md"), node("Pair/y.md"));
    g.edges.push({ from: "Pair/x.md", to: "Pair/y.md" });
    const L = buildLayout(g);
    const loose = L.clusters.filter((c) => c.loose);
    expect(loose.length).toBe(1);
    expect(loose[0].id).toBe(L.clusters.length - 1);
    expect(loose[0].name).toBe(LOOSE_NAME);
    for (const id of ["Lone/a.md", "Lone/b.md", "Lone/c.md", "Pair/x.md", "Pair/y.md"]) expect(L.nodes[L.byId.get(id)!].cluster).toBe(loose[0].id);
  });

  it("folds small linked communities into the cluster they attach to", () => {
    const adj: number[][] = Array.from({ length: 9 }, () => []);
    const link = (a: number, b: number) => (adj[a].push(b), adj[b].push(a));
    // a triangle-rich core of 6 plus a pendant pair attached to it
    [[0, 1], [0, 2], [1, 2], [2, 3], [3, 4], [4, 5], [3, 5], [5, 6], [6, 7], [0, 3]].forEach(([a, b]) => link(a, b));
    const r = groupCommunities(9, adj, 7, 4, 24);
    expect(r.labels[8]).toBe(r.looseLabel); // node 8 has no links
    for (let i = 0; i < 8; i++) expect(r.labels[i]).not.toBe(r.looseLabel);
  });

  it("caps the number of clusters", () => {
    const g = planted(10, 8);
    const adj: number[][] = Array.from({ length: g.nodes.length }, () => []);
    const idx = new Map(g.nodes.map((n, i) => [n.id, i]));
    for (const e of g.edges) {
      adj[idx.get(e.from)!].push(idx.get(e.to)!);
      adj[idx.get(e.to)!].push(idx.get(e.from)!);
    }
    const r = groupCommunities(g.nodes.length, adj, 7, 3, 4);
    expect(new Set(r.labels.filter((l) => l !== r.looseLabel)).size).toBeLessThanOrEqual(4);
  });
});

describe("cluster naming", () => {
  const mk = (n: number, f: (i: number) => Partial<NoteNode>): NoteNode[] => Array.from({ length: n }, (_, i) => node(`x/${i}.md`, f(i)));

  it("uses the dominant top-level folder", () => {
    const names = nameClusters([mk(10, (i) => ({ folder: i < 7 ? "01 Projects/Kith" : "Misc", title: `t${i}` }))]);
    expect(names).toEqual(["Projects"]);
  });

  it("falls back to the most common tag when no folder dominates", () => {
    const names = nameClusters([mk(10, (i) => ({ folder: `F${i % 5}`, tags: i < 6 ? ["reading-list", "x"] : ["x2"], title: `t${i}` }))]);
    expect(names).toEqual(["Reading list"]);
  });

  it("then uses distinctive title words", () => {
    const a = mk(8, (i) => ({ folder: `F${i}`, title: i % 2 ? "Sourdough starter" : "Sourdough loaf" }));
    const b = mk(8, (i) => ({ folder: `G${i}`, title: i % 2 ? "Kubernetes pods" : "Kubernetes ingress" }));
    const names = nameClusters([a, b]);
    expect(names[0].toLowerCase()).toContain("sourdough");
    expect(names[1].toLowerCase()).toContain("kubernetes");
  });

  it("skips one-letter folders for title words, as in People/A ... People/Z", () => {
    const big = mk(12, (i) => ({ folder: "People", title: `person${i}` }));
    const s = mk(8, (i) => ({ folder: "People/S", title: i % 2 ? "Sagan stars" : "Sagan cosmos" }));
    const names = nameClusters([big, s]);
    expect(names[0]).toBe("People");
    expect(names[1].toLowerCase()).toContain("sagan");
  });

  it("joins a one-letter folder to its parent when nothing better exists", () => {
    const big = mk(12, (i) => ({ folder: "People", title: `p${i}` }));
    const s = mk(6, (i) => ({ folder: "People/S", title: `${i}` }));
    expect(nameClusters([big, s])).toEqual(["People", "People · S"]);
  });

  it("does the same for one-letter tags, and keeps two-letter names", () => {
    const t = mk(6, (i) => ({ folder: `F${i}`, tags: ["index/s"], title: `${i}` }));
    expect(nameClusters([t])).toEqual(["Index · S"]);
    const ai = mk(6, (i) => ({ folder: "AI", title: `${i}` }));
    expect(nameClusters([ai])).toEqual(["AI"]);
  });

  it("names a cluster under a one-letter top folder after its best connected note", () => {
    const g = mk(8, (i) => ({
      folder: i < 3 ? "S/SimplenoteSource" : `S/Other${i}`,
      title: i === 0 ? "OutliersByGLadwell" : `Clip${i}`,
      inDegree: i === 0 ? 6 : 1,
    }));
    expect(nameClusters([g])).toEqual(["Outliers By GLadwell"]);
  });

  it("keeps the bare letter only when no note title has words", () => {
    const g = mk(4, (i) => ({ folder: "S", title: `${i}` }));
    expect(nameClusters([g])).toEqual(["S"]);
  });

  it("splits run-together titles into words", () => {
    const a = mk(8, (i) => ({ folder: `F${i}`, title: i % 2 ? "SourdoughStarter" : "SourdoughLoaf" }));
    const b = mk(8, (i) => ({ folder: `G${i}`, title: i % 2 ? "KubernetesPods" : "KubernetesIngress" }));
    const names = nameClusters([a, b]);
    expect(names[0].toLowerCase()).toContain("sourdough");
    expect(names[1].toLowerCase()).toContain("kubernetes");
    expect(splitCamel("OutliersByGLadwell")).toBe("Outliers By GLadwell");
    expect(splitCamel("HTMLParser2Go", true)).toBe("HTML Parser2 Go");
  });

  it("falls back to Circle N", () => {
    const names = nameClusters([mk(3, (i) => ({ folder: `F${i}`, title: `${i}` })), mk(3, (i) => ({ folder: `G${i}`, title: `2025-01-0${i + 1}` }))]);
    expect(names).toEqual(["Circle 1", "Circle 2"]);
  });

  it("names the loose group Loose notes", () => {
    const names = nameClusters([mk(5, () => ({ folder: "Projects" })), mk(4, () => ({ folder: "Projects" }))], [false, true]);
    expect(names[1]).toBe(LOOSE_NAME);
  });

  it("keeps names unique when one folder covers several clusters", () => {
    const groups = [0, 1, 2, 3].map((g) => mk(9, (i) => ({ folder: g === 0 ? "Projects" : `Projects/Sub${g}`, title: `thing${g} word${g} ${i % 3 ? "alpha" : "beta"}${g}` })));
    const names = nameClusters(groups);
    expect(new Set(names.map((n) => n.toLowerCase())).size).toBe(4);
    expect(names[0]).toBe("Projects"); // biggest wins the plain folder name
  });

  it("keeps names unique even for identical clusters", () => {
    const g = () => mk(6, () => ({ folder: "Same", tags: ["same"], title: "same same" }));
    const names = nameClusters([g(), g(), g(), g()]);
    expect(new Set(names.map((n) => n.toLowerCase())).size).toBe(4);
  });

  it("prettyName strips ordering prefixes and separators", () => {
    expect(prettyName("01 Projects")).toBe("Projects");
    expect(prettyName("reading_list")).toBe("Reading list");
    expect(prettyName("2025")).toBe("2025");
  });

  it("names are unique across a whole built layout", () => {
    const g = planted(6, 14, 5, (b) => (b < 4 ? "Notes" : `Area${b}`));
    const L = buildLayout(g);
    const names = L.clusters.map((c) => c.name.toLowerCase());
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("layout and simulation", () => {
  it("handles 0, 1 and 2 nodes", () => {
    const e = buildLayout({ nodes: [], edges: [], truncated: false, totalNotes: 0 });
    expect(e.nodes.length).toBe(0);
    expect(settle(e)).toBe(false);
    expect(tick(e)).toBe(false);

    const one = buildLayout({ nodes: [node("a.md")], edges: [], truncated: false, totalNotes: 1 });
    settle(one);
    expect(one.nodes[0].x).toBeCloseTo(0, 5);
    expect(one.clusters.length).toBe(1);
    expect(one.clusters[0].name).toBe(LOOSE_NAME);

    const two = buildLayout({ nodes: [node("a.md"), node("b.md")], edges: [{ from: "a.md", to: "b.md" }], truncated: false, totalNotes: 2 });
    settle(two);
    for (const n of two.nodes) expect(Number.isFinite(n.x) && Number.isFinite(n.y)).toBe(true);
    expect(Math.hypot(two.nodes[0].x - two.nodes[1].x, two.nodes[0].y - two.nodes[1].y)).toBeGreaterThan(2);
  });

  it("is deterministic: same graph, same pictures and names", () => {
    const g = planted(4, 25);
    const a = buildLayout(g);
    const b = buildLayout(g);
    settle(a, 1e9);
    settle(b, 1e9);
    expect(a.clusters.map((c) => c.name)).toEqual(b.clusters.map((c) => c.name));
    expect(a.nodes.map((n) => [n.x, n.y])).toEqual(b.nodes.map((n) => [n.x, n.y]));
  });

  it("stops simulating once settled", () => {
    const L = buildLayout(planted(3, 20));
    settle(L, 1e9, 5000);
    expect(isSettled(L)).toBe(true);
    const before = positionsOf(L);
    expect(tick(L)).toBe(false);
    L.nodes.forEach((n) => expect(before.get(n.id)).toEqual({ x: n.x, y: n.y }));
  });

  it("separates clusters and keeps members together", () => {
    const L = buildLayout(planted(3, 30));
    settle(L, 1e9);
    const centre = L.clusters.map((c) => {
      const m = c.members.map((i) => L.nodes[i]);
      return [m.reduce((a, n) => a + n.x, 0) / m.length, m.reduce((a, n) => a + n.y, 0) / m.length];
    });
    for (let i = 0; i < centre.length; i++)
      for (let j = i + 1; j < centre.length; j++) expect(Math.hypot(centre[i][0] - centre[j][0], centre[i][1] - centre[j][1])).toBeGreaterThan(120);
    // within-cluster spread is smaller than between-cluster distance
    const c0 = L.clusters[0].members.map((i) => L.nodes[i]);
    const spread = Math.max(...c0.map((n) => Math.hypot(n.x - centre[0][0], n.y - centre[0][1])));
    expect(spread).toBeLessThan(Math.hypot(centre[0][0] - centre[1][0], centre[0][1] - centre[1][1]));
  });

  it("incremental updates keep existing positions and put new notes near their neighbours", () => {
    const g = planted(3, 20);
    const L = buildLayout(g);
    settle(L, 1e9);
    const prev = positionsOf(L);
    const g2: VaultGraph = { ...g, nodes: [...g.nodes, node("Block1/new.md")], edges: [...g.edges, { from: "Block1/new.md", to: g.nodes[25].id }] };
    const L2 = buildLayout(g2, { previous: prev });
    // before any tick, old notes are exactly where they were
    for (const n of L2.nodes) if (prev.has(n.id)) expect({ x: n.x, y: n.y }).toEqual(prev.get(n.id));
    const nb = L2.nodes[L2.byId.get(g.nodes[25].id)!];
    const nw = L2.nodes[L2.byId.get("Block1/new.md")!];
    expect(Math.hypot(nw.x - nb.x, nw.y - nb.y)).toBeLessThan(150);
    settle(L2, 1e9);
    let moved = 0;
    for (const n of L2.nodes) {
      const p = prev.get(n.id);
      if (p) moved = Math.max(moved, Math.hypot(n.x - p.x, n.y - p.y));
    }
    expect(moved).toBeLessThan(250);
  });

  it("inherit keeps cluster names and colours for a subgraph", () => {
    const g = planted(3, 20);
    const full = buildLayout(g);
    const ids = g.nodes.filter((n) => n.id.startsWith("Block2/")).map((n) => n.id);
    const set = new Set(ids);
    const sub: VaultGraph = { ...g, nodes: g.nodes.filter((n) => set.has(n.id)), edges: g.edges.filter((e) => set.has(e.from) && set.has(e.to)) };
    const L = buildLayout(sub, { inherit: full });
    expect(L.clusters.length).toBe(1);
    const old = full.clusters[full.nodes[full.byId.get(ids[0])!].cluster];
    expect(L.clusters[0].name).toBe(old.name);
    expect(L.clusters[0].hue).toEqual(old.hue);
  });

  it("rearrange restarts from the seeded layout", () => {
    const L = buildLayout(planted(3, 15));
    settle(L, 1e9);
    const first = positionsOf(L);
    L.nodes[0].x += 500;
    rearrange(L);
    settle(L, 1e9);
    L.nodes.forEach((n) => expect(n.x).toBeCloseTo(first.get(n.id)!.x, 6));
  });

  it("people are bigger than notes, and size grows with degree", () => {
    expect(nodeRadius(true, 0)).toBeGreaterThan(nodeRadius(false, 50));
    expect(nodeRadius(false, 40)).toBeGreaterThan(nodeRadius(false, 2));
    expect(nodeRadius(false, 0)).toBeGreaterThan(0);
  });

  it("dedupes edges and ignores unknown ids", () => {
    const L = buildLayout({ nodes: [node("a.md"), node("b.md")], edges: [{ from: "a.md", to: "b.md" }, { from: "b.md", to: "a.md" }, { from: "a.md", to: "a.md" }, { from: "a.md", to: "zzz.md" }], truncated: false, totalNotes: 2 });
    expect(L.edges.length).toBe(1);
  });

  it("5,000 notes and 20,000 links build and settle well inside the time budget", () => {
    const rnd = lcg(11);
    const N = 5000;
    const nodes: NoteNode[] = Array.from({ length: N }, (_, i) => node(`F${i % 9}/n${i}.md`));
    const edges: { from: string; to: string }[] = [];
    while (edges.length < 20000) {
      const a = Math.floor(rnd() * N);
      const near = rnd() < 0.8;
      const b = near ? (Math.floor(a / 50) * 50 + Math.floor(rnd() * 50)) % N : Math.floor(rnd() * N);
      if (a !== b) edges.push({ from: nodes[a].id, to: nodes[b].id });
    }
    const g: VaultGraph = { nodes, edges, truncated: false, totalNotes: N };
    const t0 = performance.now();
    const L = buildLayout(g);
    settle(L, 1e9, 5000);
    const ms = performance.now() - t0;
    expect(isSettled(L)).toBe(true);
    expect(ms).toBeLessThan(2000);
    for (const n of L.nodes) expect(Number.isFinite(n.x) && Number.isFinite(n.y)).toBe(true);
    const names = L.clusters.map((c) => c.name.toLowerCase());
    expect(new Set(names).size).toBe(names.length);
    expect(L.clusters.filter((c) => !c.loose).length).toBeLessThanOrEqual(24);
  });
});
