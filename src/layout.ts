// Pure layout engine for Planisphere. No DOM, no obsidian.
// Seeded force simulation with a spatial grid, Louvain communities, and soft cluster names.
import type { NoteNode, VaultGraph } from "./contract";

export type RGB = [number, number, number];

export interface LNode {
  id: string;            // vault path
  note: NoteNode;
  i: number;             // index in nodes[]
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;             // base radius in world units
  deg: number;           // distinct neighbours
  cluster: number;       // index in clusters[]
  person: boolean;
  pinned: boolean;       // being dragged
  tx: number;            // gravity target (cluster anchor, or a point of the outer dust ring)
  ty: number;
  g: number;             // gravity strength toward the target
}

export interface LCluster {
  id: number;
  name: string;
  size: number;
  loose: boolean;        // the "Loose notes" bucket
  hue: RGB;
  ax: number;            // anchor (world)
  ay: number;
  rad: number;           // rough world radius, used to keep clusters apart
  members: number[];     // node indices
}

export interface LayoutState {
  nodes: LNode[];
  edges: [number, number][];   // undirected, deduped, lo < hi
  adj: number[][];
  clusters: LCluster[];
  byId: Map<string, number>;
  /** edge indices grouped by cluster (intra), with the last group holding cross-cluster edges */
  edgeGroups: number[][];
  alpha: number;
  alphaMin: number;
  alphaDecay: number;
  seed: number;
  cutoff: number;
  /** bumps whenever topology (nodes, edges, clusters) changes, so caches can invalidate */
  version: number;
  radius: number;        // approximate world radius of the whole layout
  // simulation scratch buffers
  _head?: Int32Array;
  _next?: Int32Array;
}

export const LOOSE_NAME = "Loose notes";

export const PALETTE: RGB[] = [
  [114, 201, 190],
  [134, 178, 236],
  [230, 156, 172],
  [187, 166, 238],
  [170, 206, 126],
  [226, 204, 150],
  [240, 170, 120],
  [120, 210, 232],
  [208, 150, 214],
  [150, 224, 160],
  [236, 140, 140],
  [150, 160, 240],
];
export const LOOSE_HUE: RGB = [154, 162, 190];

const mixRGB = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export function paletteColor(c: number): RGB {
  const base = PALETTE[c % PALETTE.length];
  const round = Math.floor(c / PALETTE.length);
  return round === 0 ? base : mixRGB(base, [255, 255, 255], Math.min(0.5, 0.22 * round));
}

/* ---------------- seeded randomness ---------------- */
export function mulberry32(a: number): () => number {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function gauss(rnd: () => number): number {
  let u = 0,
    v = 0;
  while (!u) u = rnd();
  while (!v) v = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function shuffled(n: number, rnd: () => number): number[] {
  const a = new Array<number>(n);
  for (let i = 0; i < n; i++) a[i] = i;
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const t = a[i];
    a[i] = a[j];
    a[j] = t;
  }
  return a;
}

/* ---------------- community detection (Louvain) ---------------- */

/**
 * Deterministic Louvain over an undirected unweighted graph given as adjacency lists.
 * Returns a label per node, contiguous from 0. Isolated nodes get their own label.
 */
export function detectCommunities(n: number, adj: number[][], seed = 7): number[] {
  if (n === 0) return [];
  const rnd = mulberry32(seed);
  let graph: Map<number, number>[] = adj.map((nb) => {
    const m = new Map<number, number>();
    for (const j of nb) m.set(j, (m.get(j) || 0) + 1);
    return m;
  });
  let membership = Array.from({ length: n }, (_, i) => i);

  for (let level = 0; level < 10; level++) {
    const size = graph.length;
    const k = graph.map((m) => {
      let s = 0;
      m.forEach((w) => (s += w));
      return s;
    });
    const m2 = k.reduce((a, b) => a + b, 0);
    if (m2 === 0) break;
    const comm = Array.from({ length: size }, (_, i) => i);
    const tot = k.slice();
    let movedAny = false;

    for (let pass = 0; pass < 20; pass++) {
      let moved = 0;
      for (const i of shuffled(size, rnd)) {
        const ci = comm[i];
        const wTo = new Map<number, number>();
        graph[i].forEach((w, j) => {
          if (j === i) return;
          const c = comm[j];
          wTo.set(c, (wTo.get(c) || 0) + w);
        });
        tot[ci] -= k[i];
        let best = ci;
        let bestGain = (wTo.get(ci) || 0) - (tot[ci] * k[i]) / m2;
        const cands = Array.from(wTo.keys()).sort((a, b) => a - b);
        for (const c of cands) {
          const gain = (wTo.get(c) || 0) - (tot[c] * k[i]) / m2;
          if (gain > bestGain + 1e-12) {
            bestGain = gain;
            best = c;
          }
        }
        tot[best] += k[i];
        if (best !== ci) {
          comm[i] = best;
          moved++;
        }
      }
      if (moved === 0) break;
      movedAny = true;
    }
    if (!movedAny) break;

    const remap = new Map<number, number>();
    for (const c of comm) if (!remap.has(c)) remap.set(c, remap.size);
    const next: Map<number, number>[] = Array.from({ length: remap.size }, () => new Map());
    for (let i = 0; i < size; i++) {
      const ci = remap.get(comm[i])!;
      graph[i].forEach((w, j) => {
        const cj = remap.get(comm[j])!;
        next[ci].set(cj, (next[ci].get(cj) || 0) + w);
      });
    }
    membership = membership.map((c) => remap.get(comm[c])!);
    if (remap.size === size) break;
    graph = next;
  }

  const final = new Map<number, number>();
  return membership.map((c) => {
    if (!final.has(c)) final.set(c, final.size);
    return final.get(c)!;
  });
}

export interface Grouping {
  labels: number[];
  count: number;
  /** label of the loose group, or -1 when there is none. The loose group always has the highest label. */
  looseLabel: number;
}

/**
 * Detect communities, keep the biggest ones (at least `minSize` members, at most `maxClusters`),
 * fold the small ones into the kept community they link to most, and put whatever is left
 * (isolated notes, tiny islands) into one loose group.
 */
export function groupCommunities(n: number, adj: number[][], seed = 7, minSize = 3, maxClusters = 24): Grouping {
  const raw = detectCommunities(n, adj, seed);
  const sizes = new Map<number, number>();
  raw.forEach((c, i) => {
    if (adj[i].length > 0) sizes.set(c, (sizes.get(c) || 0) + 1);
  });
  const ranked = Array.from(sizes.entries()).sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  let keep = ranked.filter(([, s]) => s >= minSize).slice(0, maxClusters).map(([c]) => c);
  // a small connected graph should not turn entirely into "loose" notes
  if (!keep.length) keep = ranked.filter(([, s]) => s >= 2).slice(0, maxClusters).map(([c]) => c);
  const label = new Map<number, number>();
  keep.forEach((c, i) => label.set(c, i));

  // Fold small communities into the kept community they link to most (two sweeps so chains resolve).
  const assign = raw.map((c, i) => (adj[i].length > 0 && label.has(c) ? label.get(c)! : -1));
  for (let sweep = 0; sweep < 2; sweep++) {
    const votes = new Map<number, Map<number, number>>();
    for (let i = 0; i < n; i++) {
      if (assign[i] !== -1 || adj[i].length === 0) continue;
      const c = raw[i];
      for (const j of adj[i]) {
        if (assign[j] === -1) continue;
        let m = votes.get(c);
        if (!m) votes.set(c, (m = new Map()));
        m.set(assign[j], (m.get(assign[j]) || 0) + 1);
      }
    }
    const target = new Map<number, number>();
    votes.forEach((m, c) => {
      let best = -1;
      let bw = -1;
      Array.from(m.entries())
        .sort((a, b) => a[0] - b[0])
        .forEach(([l, w]) => {
          if (w > bw) {
            bw = w;
            best = l;
          }
        });
      target.set(c, best);
    });
    let changed = false;
    for (let i = 0; i < n; i++) {
      if (assign[i] !== -1 || adj[i].length === 0) continue;
      const t = target.get(raw[i]);
      if (t !== undefined) {
        assign[i] = t;
        changed = true;
      }
    }
    if (!changed) break;
  }

  let hasLoose = false;
  for (const a of assign) if (a === -1) hasLoose = true;
  const looseLabel = hasLoose ? keep.length : -1;
  return { labels: assign.map((l) => (l === -1 ? looseLabel : l)), count: keep.length + (hasLoose ? 1 : 0), looseLabel };
}

/* ---------------- cluster naming ---------------- */

const STOP = new Set(
  (
    "a about above after again against all also am an and any are aren as at be because been before being below between both but by can cannot could did do does doing don down during each few for from further had has have having he her here hers herself him himself his how i if in into is it its itself just let me more most my myself no nor not now of off on once only or other our ours ourselves out over own same she should so some such than that the their theirs them themselves then there these they this those through to too under until up us very was we were what when where which while who whom why will with would you your yours yourself yourselves " +
    "www http https com org net io co md note notes untitled draft todo todos meeting meetings daily weekly monthly idea ideas new old copy version v1 v2 final misc other stuff thing things " +
    "like just really also still always never often make makes making made get gets got want wants need needs try trying yes hello hi hey " +
    "de la le el en un una et der die das und ein"
  ).split(/\s+/)
);

/** "OutliersByGLadwell" -> "Outliers By GLadwell". With `acronyms`, also "HTMLParser" -> "HTML Parser". */
export function splitCamel(text: string, acronyms = false): string {
  let s = text.replace(/(\p{Ll}|\p{N})(\p{Lu})/gu, "$1 $2");
  if (acronyms) s = s.replace(/(\p{Lu})(\p{Lu}\p{Ll})/gu, "$1 $2");
  return s;
}

function tokenize(text: string): string[] {
  const clean = splitCamel(text, true)
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^\p{L}\p{N}'\-\s]/gu, " ");
  const out: string[] = [];
  for (let w of clean.split(/[\s_]+/)) {
    w = w.replace(/^[-']+|[-']+$/g, "").replace(/'s$/, "");
    if (w.length < 3 || w.length > 24) continue;
    if (/\d/.test(w) || /^[ivx]{2,4}$/.test(w)) continue;
    if (STOP.has(w)) continue;
    out.push(w);
  }
  return out;
}

function stem(w: string): string {
  if (w.length > 4 && w.endsWith("ies")) return w.slice(0, -3) + "y";
  if (w.length > 4 && w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
  return w;
}

const cap = (w: string) => (w ? w[0].toUpperCase() + w.slice(1) : w);

/** Folder or tag text to a soft display name: "01 Projects" -> "Projects", "reading-list" -> "Reading list". */
export function prettyName(raw: string): string {
  let s = raw.trim();
  const stripped = s.replace(/^\d+[\s._-]+/, "");
  if (stripped) s = stripped;
  s = s.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  return cap(s);
}

/** Ranked distinctive title words per cluster (TF-IDF over clusters). */
function distinctiveWords(titles: string[][]): { w: string; surface: string; score: number; pf: number }[][] {
  const C = titles.length;
  const stats = titles.map((list) => {
    const pf = new Map<string, number>();
    const surface = new Map<string, Map<string, number>>();
    for (const t of list) {
      const seen = new Set<string>();
      for (const w of tokenize(t || "")) {
        const s = stem(w);
        if (!seen.has(s)) {
          seen.add(s);
          pf.set(s, (pf.get(s) || 0) + 1);
        }
        let m = surface.get(s);
        if (!m) surface.set(s, (m = new Map()));
        m.set(w, (m.get(w) || 0) + 1);
      }
    }
    return { pf, surface };
  });
  const df = new Map<string, number>();
  stats.forEach((s) => s.pf.forEach((_, w) => df.set(w, (df.get(w) || 0) + 1)));
  return stats.map((s, c) => {
    const size = Math.max(1, titles[c].length);
    const minPf = size >= 6 ? 2 : 1;
    const out: { w: string; surface: string; score: number; pf: number }[] = [];
    s.pf.forEach((pf, w) => {
      if (pf < minPf) return;
      const idf = Math.log((C + 1) / (df.get(w) || 1)) + 0.15;
      const surf = Array.from(s.surface.get(w)!.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
      out.push({ w, surface: surf, score: (pf / size) * idf * (1 + 0.15 * Math.log(pf)), pf });
    });
    out.sort((a, b) => b.score - a.score || a.w.localeCompare(b.w));
    return out;
  });
}

/**
 * Soft names for note clusters. Order of preference, per cluster (biggest first):
 *  1. the dominant top-level folder (covers at least half of the cluster),
 *  2. the dominant sub-folder when the top-level name is already taken,
 *  3. the most common tag,
 *  4. the most distinctive title words,
 *  5. a too-short folder or tag name joined to its parent, e.g. "People · S",
 *  6. the title of its best connected note, run-together words split ("Outliers By GLadwell"),
 *  7. a too-short name with no parent ("S"),
 *  8. "Circle N".
 * A folder or tag name with fewer than 2 letters or digits ("S", "A-") says little, so steps 1 to 3 skip it
 * and it only comes back at steps 5 and 7. Names are unique within the result. Clusters flagged loose get LOOSE_NAME.
 */
export function nameClusters(groups: NoteNode[][], loose: boolean[] = []): string[] {
  const C = groups.length;
  const words = distinctiveWords(groups.map((g, c) => (loose[c] ? [] : g.map((n) => n.title))));
  const order = groups.map((_, i) => i).sort((a, b) => groups[b].length - groups[a].length || a - b);
  const names: string[] = new Array(C);
  const used = new Set<string>([LOOSE_NAME.toLowerCase()]);
  const take = (name: string): boolean => {
    const key = name.toLowerCase();
    if (!name || used.has(key)) return false;
    used.add(key);
    return true;
  };
  const usedFirstWords = new Set<string>();
  let circle = 0;
  const meaningful = (name: string) => name.replace(/[^\p{L}\p{N}]/gu, "").length >= 2;

  for (const c of order) {
    if (loose[c]) {
      names[c] = LOOSE_NAME;
      continue;
    }
    const g = groups[c];
    const size = Math.max(1, g.length);
    circle++;
    const fallbacks: string[] = [];
    const bare: string[] = [];

    // folders
    const top = new Map<string, number>();
    for (const n of g) {
      const t = n.folder ? n.folder.split("/")[0] : "";
      if (t) top.set(t, (top.get(t) || 0) + 1);
    }
    const topBest = Array.from(top.entries()).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0];
    const topDominant = topBest && topBest[1] / size >= 0.5 ? topBest[0] : null;

    let chosen: string | null = null;
    if (topDominant) {
      const nm = prettyName(topDominant);
      if (!meaningful(nm)) bare.push(nm);
      else if (take(nm)) chosen = nm;
    }

    if (!chosen && topDominant) {
      const sub = new Map<string, number>();
      for (const n of g) {
        const parts = n.folder.split("/");
        if (parts[0] === topDominant && parts.length > 1) sub.set(parts[1], (sub.get(parts[1]) || 0) + 1);
      }
      const subBest = Array.from(sub.entries()).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0];
      if (subBest && subBest[1] / size >= 0.5) {
        const nm = prettyName(subBest[0]);
        if (!meaningful(nm)) fallbacks.unshift(`${prettyName(topDominant)} · ${nm}`);
        else if (take(nm)) chosen = nm;
      }
    }

    // tags
    if (!chosen) {
      const tc = new Map<string, { n: number; label: string }>();
      for (const n of g) {
        const seen = new Set<string>();
        for (const t of n.tags) {
          const low = t.toLowerCase();
          if (seen.has(low)) continue;
          seen.add(low);
          const e = tc.get(low);
          if (e) e.n++;
          else tc.set(low, { n: 1, label: t });
        }
      }
      const ranked = Array.from(tc.entries())
        .filter(([, v]) => v.n >= Math.max(2, 0.3 * size) || (size < 4 && v.n >= 2))
        .sort((a, b) => b[1].n - a[1].n || (a[0] < b[0] ? -1 : 1));
      for (const [, v] of ranked) {
        const parts = v.label.split("/").filter(Boolean);
        const nm = prettyName(parts.pop() || v.label);
        if (!meaningful(nm)) {
          if (parts.length) fallbacks.push(`${prettyName(parts[parts.length - 1])} · ${nm}`);
          else bare.push(nm);
          continue;
        }
        if (take(nm)) {
          chosen = nm;
          break;
        }
      }
    }

    // distinctive title words
    const list = words[c];
    if (!chosen && list.length) {
      let pick = list.filter((x) => !usedFirstWords.has(x.w));
      if (!pick.length) pick = list;
      const first = pick[0];
      const second = list.find((x) => x.w !== first.w && x.score >= first.score * 0.5 && x.pf >= 2);
      const candidates = [second ? `${cap(first.surface)} and ${second.surface}` : cap(first.surface)];
      if (second) candidates.push(cap(first.surface));
      for (const nm of candidates) {
        if (take(nm)) {
          chosen = nm;
          usedFirstWords.add(first.w);
          break;
        }
      }
    }

    // folder name already taken: add a distinctive word to it
    if (!chosen && topDominant && list.length && meaningful(prettyName(topDominant))) {
      const base = prettyName(topDominant);
      for (const x of list.slice(0, 4)) {
        const nm = `${base} and ${x.surface}`;
        if (take(nm)) {
          chosen = nm;
          break;
        }
      }
    }
    // a short folder or tag name with its parent, then the best connected note, then the short name alone
    const hub = g
      .filter((n) => /\p{L}.*\p{L}/u.test(n.title))
      .sort((a, b) => b.inDegree + b.outDegree - (a.inDegree + a.outDegree) || (a.title < b.title ? -1 : a.title > b.title ? 1 : 0))[0];
    const hubName = hub ? splitCamel(hub.title).replace(/\s+/g, " ").trim() : "";
    if (!chosen) {
      for (const nm of [...fallbacks, hubName, ...bare]) {
        if (take(nm)) {
          chosen = nm;
          break;
        }
      }
    }
    if (!chosen) {
      let k = circle;
      let nm = `Circle ${k}`;
      while (!take(nm)) nm = `Circle ${++k}`;
      chosen = nm;
    }
    names[c] = chosen;
  }
  return names;
}

/* ---------------- sizes ---------------- */

export function nodeRadius(person: boolean, deg: number): number {
  return person ? 11 + Math.sqrt(deg) * 1.7 : 2.4 + Math.log2(1 + deg) * 1.15;
}

/* ---------------- building the layout ---------------- */

export interface BuildOptions {
  seed?: number;
  /** positions to keep for notes that already existed (by id) */
  previous?: Map<string, { x: number; y: number }>;
  /** reuse the cluster assignment, names and colours of another layout (used by local mode) */
  inherit?: LayoutState;
}

function dedupeEdges(graph: VaultGraph, byId: Map<string, number>): [number, number][] {
  const seen = new Set<number>();
  const n = byId.size;
  const out: [number, number][] = [];
  for (const e of graph.edges) {
    const a = byId.get(e.from);
    const b = byId.get(e.to);
    if (a === undefined || b === undefined || a === b) continue;
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    const key = lo * n + hi;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push([lo, hi]);
  }
  return out;
}

export function buildLayout(graph: VaultGraph, opts: BuildOptions = {}): LayoutState {
  const seed = opts.seed ?? 1110;
  const uniq: NoteNode[] = [];
  const byId = new Map<string, number>();
  for (const nd of graph.nodes) {
    if (byId.has(nd.id)) continue;
    byId.set(nd.id, uniq.length);
    uniq.push(nd);
  }
  const n = uniq.length;
  const edges = dedupeEdges(graph, byId);
  const adj: number[][] = Array.from({ length: n }, () => []);
  for (const [a, b] of edges) {
    adj[a].push(b);
    adj[b].push(a);
  }

  let labels: number[];
  let clusters: LCluster[];
  const inherit = opts.inherit;
  if (inherit) {
    // keep the full graph's clusters, renumbered to the ones present here
    const remap = new Map<number, number>();
    labels = uniq.map((nd) => {
      const oi = inherit.byId.get(nd.id);
      const oc = oi === undefined ? -1 : inherit.nodes[oi].cluster;
      if (oc < 0) return -1;
      if (!remap.has(oc)) remap.set(oc, remap.size);
      return remap.get(oc)!;
    });
    if (labels.some((l) => l < 0)) {
      const extra = remap.size;
      labels = labels.map((l) => (l < 0 ? extra : l));
      remap.set(-1, extra);
    }
    const members: number[][] = Array.from({ length: remap.size }, () => []);
    labels.forEach((c, i) => members[c].push(i));
    clusters = [];
    remap.forEach((newIdx, oldIdx) => {
      const old = oldIdx >= 0 ? inherit.clusters[oldIdx] : undefined;
      clusters[newIdx] = {
        id: newIdx,
        name: old ? old.name : LOOSE_NAME,
        size: members[newIdx].length,
        loose: old ? old.loose : true,
        hue: old ? old.hue : LOOSE_HUE,
        ax: 0,
        ay: 0,
        rad: 0,
        members: members[newIdx],
      };
    });
  } else {
    const minSize = Math.max(3, Math.min(12, Math.round(n / 250)));
    const { labels: lab, count, looseLabel } = groupCommunities(n, adj, seed, minSize, 24);
    labels = lab;
    const members: number[][] = Array.from({ length: count }, () => []);
    labels.forEach((c, i) => members[c].push(i));
    const looseFlags = members.map((_, c) => c === looseLabel);
    const names = nameClusters(
      members.map((m) => m.map((i) => uniq[i])),
      looseFlags
    );
    clusters = members.map((mem, c) => ({
      id: c,
      name: names[c],
      size: mem.length,
      loose: looseFlags[c],
      hue: looseFlags[c] ? LOOSE_HUE : paletteColor(c),
      ax: 0,
      ay: 0,
      rad: 0,
      members: mem,
    }));
  }

  const nodes: LNode[] = uniq.map((nd, i) => {
    const deg = adj[i].length;
    const person = nd.isPerson;
    return {
      id: nd.id,
      note: nd,
      i,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      r: nodeRadius(person, deg),
      deg,
      cluster: labels[i],
      person,
      pinned: false,
      tx: 0,
      ty: 0,
      g: 0.08,
    };
  });

  const cutoff = Math.max(70, Math.min(170, 170 - (n - 400) * 0.022));
  const s: LayoutState = {
    nodes,
    edges,
    adj,
    clusters,
    byId,
    edgeGroups: [],
    alpha: 1,
    alphaMin: 0.03,
    alphaDecay: n > 2500 ? 0.972 : n > 1000 ? 0.98 : 0.988,
    seed,
    cutoff,
    version: 1,
    radius: 100,
  };
  buildEdgeGroups(s);
  placeAnchors(s, opts.previous);
  seedPositions(s, opts.previous);
  if (opts.previous && opts.previous.size) s.alpha = 0.45;
  if (n === 0) s.alpha = 0;
  return s;
}

function buildEdgeGroups(s: LayoutState): void {
  const groups: number[][] = Array.from({ length: s.clusters.length + 1 }, () => []);
  s.edges.forEach(([a, b], e) => {
    const ca = s.nodes[a].cluster;
    groups[ca === s.nodes[b].cluster ? ca : s.clusters.length].push(e);
  });
  s.edgeGroups = groups;
}

/**
 * Place cluster anchors: ring start (neighbours by shared links next to each other), then a small
 * relaxation that keeps clusters apart and pulls linked ones together. Existing notes pull their
 * cluster toward where it already was. Loose notes get their own targets on an outer dust ring.
 */
function placeAnchors(s: LayoutState, prev?: Map<string, { x: number; y: number }>): void {
  const K = s.clusters.length;
  const n = s.nodes.length;
  for (const cl of s.clusters) cl.rad = 16 * Math.sqrt(cl.size) + 26;
  const real: number[] = [];
  s.clusters.forEach((cl, c) => {
    if (!cl.loose) real.push(c);
  });
  const R = real.length;

  if (R > 0) {
    const w: number[][] = Array.from({ length: K }, () => new Array(K).fill(0));
    for (const [a, b] of s.edges) {
      const ca = s.nodes[a].cluster;
      const cb = s.nodes[b].cluster;
      if (ca !== cb) {
        w[ca][cb]++;
        w[cb][ca]++;
      }
    }
    // ring start: greedy chain from the biggest cluster
    const chain: number[] = [real[0]];
    const placed = new Set<number>([real[0]]);
    while (chain.length < R) {
      const cur = chain[chain.length - 1];
      let best = -1;
      let bw = -Infinity;
      for (const c of real) {
        if (placed.has(c)) continue;
        const score = w[cur][c] * 1000 + w[c].reduce((a, b) => a + b, 0) - c * 1e-6;
        if (score > bw) {
          bw = score;
          best = c;
        }
      }
      chain.push(best);
      placed.add(best);
    }
    const sumRad = real.reduce((a, c) => a + s.clusters[c].rad * 2 + 50, 0);
    const ringR = Math.max(R === 1 ? 0 : 120, sumRad / (2 * Math.PI));
    let ang = -Math.PI / 2 + 0.25;
    const total = real.reduce((a, c) => a + s.clusters[c].rad, 0);
    for (const c of chain) {
      const span = (s.clusters[c].rad / total) * Math.PI * 2;
      const a = ang + span / 2;
      ang += span;
      s.clusters[c].ax = Math.cos(a) * ringR * 1.3;
      s.clusters[c].ay = Math.sin(a) * ringR * 0.85;
    }
    // where existing notes already are
    let anyPrev = false;
    if (prev && prev.size) {
      for (const c of real) {
        let sx = 0,
          sy = 0,
          cnt = 0;
        for (const i of s.clusters[c].members) {
          const o = prev.get(s.nodes[i].id);
          if (o) {
            sx += o.x;
            sy += o.y;
            cnt++;
          }
        }
        if (cnt >= Math.max(1, s.clusters[c].size * 0.3)) {
          s.clusters[c].ax = sx / cnt;
          s.clusters[c].ay = sy / cnt;
          anyPrev = true;
        }
      }
    }
    if (R > 1) {
      const iters = anyPrev ? 40 : 320;
      const wmax = Math.max(1, ...w.flat());
      for (let it = 0; it < iters; it++) {
        const cool = 1 - it / iters;
        for (let ai = 0; ai < R; ai++) {
          for (let bi = ai + 1; bi < R; bi++) {
            const A = s.clusters[real[ai]];
            const B = s.clusters[real[bi]];
            let dx = B.ax - A.ax;
            let dy = B.ay - A.ay;
            let d = Math.hypot(dx, dy);
            if (d < 1e-3) {
              dx = ((ai * 7 + bi) % 5) - 2 + 0.3;
              dy = ((ai + bi * 3) % 5) - 2 + 0.3;
              d = Math.hypot(dx, dy);
            }
            const want = (A.rad + B.rad) * 1.0 + 60;
            const link = w[real[ai]][real[bi]];
            let f = 0;
            if (d < want) f = (d - want) * 0.5; // overlap: push apart
            else if (link > 0) f = Math.min(1, link / (wmax * 0.5)) * (d - want) * 0.04 * cool; // pull linked clusters
            const ux = dx / d;
            const uy = dy / d;
            A.ax += ux * f;
            A.ay += uy * f;
            B.ax -= ux * f;
            B.ay -= uy * f;
          }
        }
        if (!anyPrev) {
          for (const c of real) {
            s.clusters[c].ax *= 1 - 0.012;
            s.clusters[c].ay *= 1 - 0.03;
          }
        }
      }
    }
  }

  // extent of the real clusters
  let ext = 0;
  for (const c of real) ext = Math.max(ext, Math.hypot(s.clusters[c].ax, s.clusters[c].ay * 1.2) + s.clusters[c].rad);
  const dustR = Math.max(ext * 1.12 + 60, Math.sqrt(n) * 14 + 60);
  s.radius = Math.max(dustR * 1.1, 150);

  const rnd = mulberry32(s.seed ^ 0x51ed270b);
  for (const nd of s.nodes) {
    const cl = s.clusters[nd.cluster];
    if (cl.loose) {
      const ang = rnd() * Math.PI * 2;
      const rr = dustR * (R > 0 ? 0.92 + rnd() * 0.4 : Math.sqrt(rnd()) * Math.min(1, (n - 1) / 40));
      nd.tx = Math.cos(ang) * rr * 1.25;
      nd.ty = Math.sin(ang) * rr * 0.85;
      nd.g = R > 0 ? 0.03 : 0.05;
    } else {
      nd.tx = cl.ax;
      nd.ty = cl.ay;
      nd.g = 0.08;
    }
  }
}

function seedPositions(s: LayoutState, prev?: Map<string, { x: number; y: number }>): void {
  const rnd = mulberry32(s.seed ^ 0x9e3779b9);
  for (const nd of s.nodes) {
    const cl = s.clusters[nd.cluster];
    const spread = cl.loose ? 30 : 12 * Math.sqrt(cl.size) + 16;
    const old = prev?.get(nd.id);
    if (old) {
      nd.x = old.x;
      nd.y = old.y;
    } else {
      let sx = 0,
        sy = 0,
        c = 0;
      if (prev) {
        for (const j of s.adj[nd.i]) {
          const o = prev.get(s.nodes[j].id);
          if (o) {
            sx += o.x;
            sy += o.y;
            c++;
          }
        }
      }
      if (c) {
        nd.x = sx / c + gauss(rnd) * 24;
        nd.y = sy / c + gauss(rnd) * 24;
      } else {
        nd.x = nd.tx + gauss(rnd) * spread;
        nd.y = nd.ty + gauss(rnd) * spread;
      }
    }
    nd.vx = nd.vy = 0;
  }
  if (s.nodes.length === 1) {
    s.nodes[0].x = 0;
    s.nodes[0].y = 0;
  }
}

/* ---------------- simulation ---------------- */

const REPEL = 300;
const GAP = 7;

/** One physics tick. Returns true while the layout is still moving. */
export function tick(s: LayoutState): boolean {
  const { nodes, edges } = s;
  const n = nodes.length;
  if (n === 0 || s.alpha < s.alphaMin) return false;
  const alpha = s.alpha;

  // uniform grid over the current extent
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (let i = 0; i < n; i++) {
    const p = nodes[i];
    if (p.x < x0) x0 = p.x;
    if (p.x > x1) x1 = p.x;
    if (p.y < y0) y0 = p.y;
    if (p.y > y1) y1 = p.y;
  }
  let cell = s.cutoff;
  let cols = Math.floor((x1 - x0) / cell) + 1;
  let rows = Math.floor((y1 - y0) / cell) + 1;
  while (cols * rows > 400000) {
    cell *= 1.5;
    cols = Math.floor((x1 - x0) / cell) + 1;
    rows = Math.floor((y1 - y0) / cell) + 1;
  }
  if (!s._head || s._head.length < cols * rows) s._head = new Int32Array(cols * rows);
  if (!s._next || s._next.length < n) s._next = new Int32Array(n);
  const head = s._head;
  const next = s._next;
  head.fill(-1, 0, cols * rows);
  for (let i = 0; i < n; i++) {
    const p = nodes[i];
    const k = Math.floor((p.y - y0) / cell) * cols + Math.floor((p.x - x0) / cell);
    next[i] = head[k];
    head[k] = i;
  }

  const cut2 = cell * cell;
  const pair = (a: LNode, b: LNode, i: number, j: number) => {
    let dx = b.x - a.x;
    let dy = b.y - a.y;
    let d2 = dx * dx + dy * dy;
    if (d2 >= cut2) return;
    if (d2 < 0.01) {
      dx = ((i * 7 + j) % 5) - 2 + 0.1;
      dy = ((i + j * 3) % 5) - 2 + 0.1;
      d2 = dx * dx + dy * dy;
    }
    const d = Math.sqrt(d2);
    let f = ((-REPEL * alpha) / d2) * (a.cluster === b.cluster ? 1 : 2.4);
    // portraits are drawn larger than their world radius suggests when zoomed out, so keep them apart
    const min = (a.r + b.r) * (a.person || b.person ? 1.3 : 1) + GAP;
    if (d < min) f -= ((min - d) / d) * 0.5;
    dx *= f;
    dy *= f;
    a.vx += dx;
    a.vy += dy;
    b.vx -= dx;
    b.vy -= dy;
  };
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      const base = cy * cols + cx;
      for (let i = head[base]; i !== -1; i = next[i]) {
        const a = nodes[i];
        for (let j = next[i]; j !== -1; j = next[j]) pair(a, nodes[j], i, j);
        if (cx + 1 < cols) for (let j = head[base + 1]; j !== -1; j = next[j]) pair(a, nodes[j], i, j);
        if (cy + 1 < rows) {
          const below = base + cols;
          if (cx > 0) for (let j = head[below - 1]; j !== -1; j = next[j]) pair(a, nodes[j], i, j);
          for (let j = head[below]; j !== -1; j = next[j]) pair(a, nodes[j], i, j);
          if (cx + 1 < cols) for (let j = head[below + 1]; j !== -1; j = next[j]) pair(a, nodes[j], i, j);
        }
      }
    }
  }

  for (let e = 0; e < edges.length; e++) {
    const a = nodes[edges[e][0]];
    const b = nodes[edges[e][1]];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const d = Math.sqrt(dx * dx + dy * dy) || 1;
    const same = a.cluster === b.cluster;
    const L = same ? 34 : 160;
    const k = same ? 0.05 : 0.004;
    const f = ((d - L) / d) * k * alpha;
    a.vx += dx * f;
    a.vy += dy * f;
    b.vx -= dx * f;
    b.vy -= dy * f;
  }
  for (let i = 0; i < n; i++) {
    const p = nodes[i];
    p.vx += (p.tx - p.x) * p.g * alpha;
    p.vy += (p.ty - p.y) * p.g * alpha;
    if (p.pinned) {
      p.vx = p.vy = 0;
      continue;
    }
    p.vx *= 0.58;
    p.vy *= 0.58;
    if (p.vx > 60) p.vx = 60;
    else if (p.vx < -60) p.vx = -60;
    if (p.vy > 60) p.vy = 60;
    else if (p.vy < -60) p.vy = -60;
    p.x += p.vx;
    p.y += p.vy;
  }
  s.alpha *= s.alphaDecay;
  return s.alpha >= s.alphaMin;
}

const nowMs = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

/** Run ticks until settled or the budget runs out. Returns true if still unsettled. */
export function settle(s: LayoutState, maxMs = 400, maxTicks = 1000): boolean {
  const t0 = nowMs();
  let i = 0;
  while (s.alpha >= s.alphaMin && i < maxTicks) {
    tick(s);
    i++;
    if ((i & 3) === 0 && nowMs() - t0 > maxMs) break;
  }
  updateRadius(s);
  return s.alpha >= s.alphaMin;
}

export function isSettled(s: LayoutState): boolean {
  return s.alpha < s.alphaMin;
}

export function reheat(s: LayoutState, alpha = 0.25): void {
  s.alpha = Math.max(s.alpha, alpha);
}

/** Throw away positions and re-run from the seeded start. Same input gives the same picture. */
export function rearrange(s: LayoutState): void {
  seedPositions(s);
  s.alpha = 1;
  s.version++;
}

export function updateRadius(s: LayoutState): void {
  let m = 0;
  for (const nd of s.nodes) m = Math.max(m, Math.hypot(nd.x, nd.y));
  s.radius = Math.max(150, m + 40);
}

export function layoutBounds(s: LayoutState): { x0: number; y0: number; x1: number; y1: number } {
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (const nd of s.nodes) {
    x0 = Math.min(x0, nd.x - nd.r);
    y0 = Math.min(y0, nd.y - nd.r);
    x1 = Math.max(x1, nd.x + nd.r);
    y1 = Math.max(y1, nd.y + nd.r);
  }
  if (!isFinite(x0)) return { x0: -100, y0: -100, x1: 100, y1: 100 };
  return { x0, y0, x1, y1 };
}

export function positionsOf(s: LayoutState): Map<string, { x: number; y: number }> {
  const m = new Map<string, { x: number; y: number }>();
  for (const nd of s.nodes) m.set(nd.id, { x: nd.x, y: nd.y });
  return m;
}
