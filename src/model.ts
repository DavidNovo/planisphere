// Pure vault model: turns a VaultPort into a filtered VaultGraph. No obsidian import, no DOM.
import { DEFAULT_FILTERS } from "./contract";
import type { GraphFilters, NoteNode, VaultEdge, VaultGraph, VaultPort } from "./contract";

/* ---------------- small helpers ---------------- */

function nonEmpty(v: unknown): boolean {
  if (v === undefined || v === null) return false;
  if (typeof v === "string") return v.trim() !== "";
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "object") return Object.keys(v as object).length > 0;
  return true;
}

function firstString(v: unknown): string | undefined {
  if (typeof v === "string") return v;
  if (Array.isArray(v)) {
    // YAML turns an unquoted `[[x.jpg]]` into a nested array, so look inside.
    for (const x of v) {
      const s = firstString(x);
      if (s !== undefined && s.trim() !== "") return s;
    }
  }
  return undefined;
}

/**
 * Normalise a frontmatter `avatar` value to a bare target: no brackets, no `!` embed marker,
 * no `|size` suffix. Accepts `x.jpg`, `[[x.jpg]]`, `![[x.jpg|96]]`, `![alt](path/x.jpg)`, a path, a URL.
 */
export function normalizeAvatar(value: unknown): string | undefined {
  const raw = firstString(value);
  if (raw === undefined) return undefined;
  let s = raw.trim();
  if (!s) return undefined;
  const wiki = /\[\[([^\]]*)\]\]/.exec(s);
  if (wiki) s = wiki[1];
  else {
    const md = /!?\[[^\]]*\]\(([^)]*)\)/.exec(s);
    if (md) {
      s = md[1].trim();
      if (s.startsWith("<") && s.endsWith(">")) s = s.slice(1, -1);
      try {
        s = decodeURI(s);
      } catch {
        /* keep as is */
      }
    }
  }
  const bar = s.indexOf("|");
  if (bar >= 0) s = s.slice(0, bar);
  s = s.replace(/^!+/, "").trim();
  return s || undefined;
}

function cleanTag(t: string): string {
  return t.trim().replace(/^#+/, "");
}

function normFolder(f: string): string {
  return f.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
}

function inFolder(folder: string, prefix: string): boolean {
  return folder === prefix || folder.startsWith(prefix + "/");
}

const PERSON_TAGS = new Set(["people", "person"]);
function isPersonTag(lower: string): boolean {
  if (PERSON_TAGS.has(lower)) return true;
  const slash = lower.indexOf("/");
  return slash > 0 && PERSON_TAGS.has(lower.slice(0, slash));
}

function tagMatches(noteTagLower: string, wantedLower: string): boolean {
  return noteTagLower === wantedLower || noteTagLower.startsWith(wantedLower + "/");
}

/* ---------------- buildGraph ---------------- */

export function buildGraph(port: VaultPort, filtersIn: Partial<GraphFilters> = DEFAULT_FILTERS): VaultGraph {
  const f: GraphFilters = { ...DEFAULT_FILTERS, ...filtersIn };

  // Deterministic order: by path.
  const seen = new Set<string>();
  const notes = port
    .notes()
    .filter((n) => (seen.has(n.path) ? false : (seen.add(n.path), true)))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const N = notes.length;
  const index = new Map<string, number>();
  for (let i = 0; i < N; i++) index.set(notes[i].path, i);

  // Per-note metadata.
  const tags: string[][] = new Array(N);
  const tagsLower: string[][] = new Array(N);
  const person = new Uint8Array(N);
  const avatar: (string | undefined)[] = new Array(N);
  for (let i = 0; i < N; i++) {
    const path = notes[i].path;
    const seenTags = new Set<string>();
    const tl: string[] = [];
    const tg: string[] = [];
    for (const raw of port.tagsOf(path) || []) {
      const t = cleanTag(String(raw));
      if (!t) continue;
      const low = t.toLowerCase();
      if (seenTags.has(low)) continue;
      seenTags.add(low);
      tg.push(t);
      tl.push(low);
    }
    tags[i] = tg;
    tagsLower[i] = tl;
    const fm = port.frontmatter(path);
    let p = false;
    if (fm) {
      if (nonEmpty(fm.avatar)) {
        p = true;
        avatar[i] = normalizeAvatar(fm.avatar);
      }
      if (nonEmpty(fm.did) || nonEmpty(fm.handle) || nonEmpty(fm.identities)) p = true;
    }
    if (!p) for (const t of tl) if (isPersonTag(t)) { p = true; break; }
    person[i] = p ? 1 : 0;
  }

  // Edges among all notes (markdown targets only), deduped, no self links.
  const links = port.links() || {};
  const from: number[] = [];
  const to: number[] = [];
  for (let s = 0; s < N; s++) {
    const targets = links[notes[s].path];
    if (!targets) continue;
    const idxs: number[] = [];
    for (const t in targets) {
      const ti = index.get(t);
      if (ti === undefined || ti === s) continue;
      idxs.push(ti);
    }
    idxs.sort((a, b) => a - b);
    for (const ti of idxs) {
      from.push(s);
      to.push(ti);
    }
  }
  const E = from.length;

  // Mentions use the whole vault, so the gold ring does not depend on which notes the filters keep.
  const mentions = new Int32Array(N);
  for (let e = 0; e < E; e++) if (person[to[e]] && !person[from[e]]) mentions[to[e]]++;

  // Node filters.
  const folders = f.folders.map(normFolder).filter(Boolean);
  const excl = f.excludeFolders.map(normFolder).filter(Boolean);
  const wantTags = f.tags.map((t) => cleanTag(t).toLowerCase()).filter(Boolean);
  const q = f.query.trim().toLowerCase();
  const keep = new Uint8Array(N);
  const folderOf: string[] = new Array(N);
  for (let i = 0; i < N; i++) {
    const path = notes[i].path;
    const slash = path.lastIndexOf("/");
    const folder = slash >= 0 ? path.slice(0, slash) : "";
    folderOf[i] = folder;
    if (f.peopleOnly && !person[i]) continue;
    if (f.looseOnly && (folder !== "" || tagsLower[i].length)) continue;
    if (folders.length && !folders.some((p) => inFolder(folder, p))) continue;
    if (excl.length && excl.some((p) => inFolder(folder, p))) continue;
    if (wantTags.length && !tagsLower[i].some((t) => wantTags.some((w) => tagMatches(t, w)))) continue;
    if (q && !(notes[i].basename.toLowerCase().includes(q) || path.toLowerCase().includes(q))) continue;
    keep[i] = 1;
  }

  const degreeOf = (): Int32Array => {
    const d = new Int32Array(N);
    for (let e = 0; e < E; e++) if (keep[from[e]] && keep[to[e]]) {
      d[from[e]]++;
      d[to[e]]++;
    }
    return d;
  };

  let deg = degreeOf();
  // People only shows every person, linked or not: imported people often have no links yet.
  const hideOrphans = !f.showOrphans && !f.peopleOnly;
  if (f.orphansOnly) {
    for (let i = 0; i < N; i++) if (keep[i] && deg[i] > 0) keep[i] = 0; // keep ONLY orphans
  } else if (hideOrphans) {
    for (let i = 0; i < N; i++) if (keep[i] && deg[i] === 0) keep[i] = 0;
  }

  let truncated = false;
  const cap = Number.isFinite(f.maxNodes) && f.maxNodes >= 1 ? Math.floor(f.maxNodes) : Infinity;
  let kept: number[] = [];
  for (let i = 0; i < N; i++) if (keep[i]) kept.push(i);
  if (kept.length > cap) {
    truncated = true;
    kept.sort((a, b) => deg[b] - deg[a] || a - b);
    const drop = kept.slice(cap);
    kept = kept.slice(0, cap);
    for (const i of drop) keep[i] = 0;
    deg = degreeOf();
    if (f.orphansOnly) { for (const i of kept) if (deg[i] > 0) keep[i] = 0; }
    else if (hideOrphans) { for (const i of kept) if (deg[i] === 0) keep[i] = 0; }
  }

  const inDeg = new Int32Array(N);
  const outDeg = new Int32Array(N);
  const edges: VaultEdge[] = [];
  for (let e = 0; e < E; e++) {
    const a = from[e];
    const b = to[e];
    if (!keep[a] || !keep[b]) continue;
    outDeg[a]++;
    inDeg[b]++;
    edges.push({ from: notes[a].path, to: notes[b].path });
  }

  const nodes: NoteNode[] = [];
  for (let i = 0; i < N; i++) {
    if (!keep[i]) continue;
    const node: NoteNode = {
      id: notes[i].path,
      title: notes[i].basename,
      folder: folderOf[i],
      tags: tags[i],
      inDegree: inDeg[i],
      outDegree: outDeg[i],
      isPerson: person[i] === 1,
      mentions: person[i] ? mentions[i] : 0,
      mtime: notes[i].mtime,
    };
    if (avatar[i]) node.avatarPath = avatar[i];
    nodes.push(node);
  }
  return { nodes, edges, truncated, totalNotes: N };
}

/* ---------------- local mode helpers ---------------- */

/** Ids of the centre plus every note within `depth` links of it (links followed in both directions). */
export function egoNetwork(graph: VaultGraph, centerId: string, depth: number): string[] {
  const adj = new Map<string, string[]>();
  for (const n of graph.nodes) adj.set(n.id, []);
  for (const e of graph.edges) {
    adj.get(e.from)?.push(e.to);
    adj.get(e.to)?.push(e.from);
  }
  if (!adj.has(centerId)) return [];
  const dist = new Map<string, number>([[centerId, 0]]);
  let frontier = [centerId];
  for (let d = 1; d <= depth && frontier.length; d++) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const nb of adj.get(id) || []) {
        if (dist.has(nb)) continue;
        dist.set(nb, d);
        next.push(nb);
      }
    }
    frontier = next;
  }
  return Array.from(dist.keys());
}

/** The induced subgraph on `ids`. Degrees are recomputed inside it. */
export function subgraphOf(graph: VaultGraph, ids: Iterable<string>): VaultGraph {
  const set = new Set(ids);
  const edges = graph.edges.filter((e) => set.has(e.from) && set.has(e.to));
  const inD = new Map<string, number>();
  const outD = new Map<string, number>();
  for (const e of edges) {
    outD.set(e.from, (outD.get(e.from) || 0) + 1);
    inD.set(e.to, (inD.get(e.to) || 0) + 1);
  }
  const nodes = graph.nodes
    .filter((n) => set.has(n.id))
    .map((n) => ({ ...n, inDegree: inD.get(n.id) || 0, outDegree: outD.get(n.id) || 0 }));
  return { nodes, edges, truncated: graph.truncated, totalNotes: graph.totalNotes };
}
