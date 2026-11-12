import { DEFAULT_FILTERS, type GraphFilters } from "../../../src/contract";
import { SkyEngine } from "../../../src/engine";
import { buildGraph } from "../../../src/model";
import { toScreen } from "../../../src/render";
import { makeVault, portOf, portrait } from "./data";

declare global {
  interface Window {
    __sky: unknown;
    __ready: boolean;
  }
}

const q = new URLSearchParams(location.search);
const theme = q.get("theme") === "paper" ? "paper" : "night";
const scale = Number(q.get("scale") || "1");
const notes = makeVault(scale);
const unresolvable = new Set(notes.filter((n) => n.fm && n.fm._ok === false).map((n) => String(n.fm!.avatar)));
const port = portOf(notes);
const filters: GraphFilters = { ...DEFAULT_FILTERS, maxNodes: 8000 };
const graph = buildGraph(port, filters);

const host = document.getElementById("host")!;
const engine = new SkyEngine({
  theme,
  labelMode: (q.get("labels") as "auto" | "always" | "never") || "auto",
  resolveAvatar: (p) => {
    // pretend the vault resolves the path to a file; five people have no image on disk
    const base = p.split("/").pop()!.replace(/\.png$/, "");
    const hit = notes.find((n) => n.fm && String(n.fm.avatar).includes(base));
    if (hit && hit.fm!._ok === false) return undefined;
    return portrait(base);
  },
});
void unresolvable;
engine.mount(host);
engine.setData(graph);
document.body.classList.toggle("paper", theme === "paper");

function where(id: string) {
  const { st, layout } = engine.internals();
  const i = layout.byId.get(id);
  if (i === undefined) return null;
  const n = layout.nodes[i];
  const [x, y] = toScreen(st, n.x, n.y);
  const r = host.getBoundingClientRect();
  return { x: x + r.left, y: y + r.top };
}

/** Node ids by degree, descending, optionally filtered. */
function top(kind: "any" | "note" | "person" = "any", n = 10) {
  const { layout } = engine.internals();
  return layout.nodes
    .filter((x) => (kind === "any" ? true : kind === "person" ? x.person : !x.person))
    .sort((a, b) => b.deg - a.deg || a.i - b.i)
    .slice(0, n)
    .map((x) => x.id);
}

/** Milliseconds per full draw, best of five runs, with the raster flushed so the work is really counted. */
function bench(frames = 30) {
  const e = engine.internals();
  const ctx = (host.querySelector("canvas") as HTMLCanvasElement).getContext("2d")!;
  e.draw(0);
  let best = Infinity;
  for (let run = 0; run < 5; run++) {
    const t0 = performance.now();
    for (let i = 0; i < frames; i++) e.draw(i * 16);
    ctx.getImageData(0, 0, 1, 1);
    best = Math.min(best, (performance.now() - t0) / frames);
  }
  return best;
}

window.__sky = { engine, graph, where, top, bench, ready: true };
window.__ready = true;
