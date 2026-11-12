// Throwaway stand-in for src/model.ts, same signature. Not shipped.
import type { GraphFilters, NoteNode, VaultEdge, VaultGraph, VaultPort } from "../../../src/contract";

export function buildGraph(port: VaultPort, f: GraphFilters): VaultGraph {
  const notes = port.notes();
  const links = port.links();
  const under = (p: string, pre: string) => p === pre || p.startsWith(pre + "/");
  let kept = notes.filter((n) => {
    if (f.folders.length && !f.folders.some((x) => under(n.path, x))) return false;
    if (f.excludeFolders.some((x) => under(n.path, x))) return false;
    if (f.tags.length && !port.tagsOf(n.path).some((t) => f.tags.includes(t))) return false;
    return true;
  });
  const person = (p: string) => {
    const fm = port.frontmatter(p);
    return !!fm?.avatar || port.tagsOf(p).some((t) => t === "people" || t === "person");
  };
  if (f.peopleOnly) kept = kept.filter((n) => person(n.path));
  const ids = new Set(kept.map((n) => n.path));
  const edgeSet = new Set<string>();
  const edges: VaultEdge[] = [];
  for (const n of kept) for (const t of Object.keys(links[n.path] ?? {})) {
    if (t === n.path || !ids.has(t)) continue;
    const k = n.path + "\0" + t;
    if (!edgeSet.has(k)) { edgeSet.add(k); edges.push({ from: n.path, to: t }); }
  }
  const inD = new Map<string, number>(), outD = new Map<string, number>(), ment = new Map<string, number>();
  for (const e of edges) {
    inD.set(e.to, (inD.get(e.to) ?? 0) + 1);
    outD.set(e.from, (outD.get(e.from) ?? 0) + 1);
    if (person(e.to) && !person(e.from)) ment.set(e.to, (ment.get(e.to) ?? 0) + 1);
  }
  let nodes: NoteNode[] = kept.map((n) => {
    const fm = port.frontmatter(n.path);
    const i = n.path.lastIndexOf("/");
    return {
      id: n.path, title: n.basename, folder: i < 0 ? "" : n.path.slice(0, i), tags: port.tagsOf(n.path),
      inDegree: inD.get(n.path) ?? 0, outDegree: outD.get(n.path) ?? 0,
      avatarPath: typeof fm?.avatar === "string" ? fm.avatar : undefined,
      isPerson: person(n.path), mentions: ment.get(n.path) ?? 0, mtime: n.mtime,
    };
  });
  if (!f.showOrphans) nodes = nodes.filter((n) => n.inDegree + n.outDegree > 0);
  let truncated = false;
  if (nodes.length > f.maxNodes) {
    nodes = nodes.sort((a, b) => b.inDegree + b.outDegree - (a.inDegree + a.outDegree)).slice(0, f.maxNodes);
    truncated = true;
  }
  const final = new Set(nodes.map((n) => n.id));
  return { nodes, edges: edges.filter((e) => final.has(e.from) && final.has(e.to)), truncated, totalNotes: notes.length };
}
