// Harness entry: the REAL PlanisphereView over a fake app, fake engine and fake buildGraph.
import { PlanisphereView } from "../../../src/view";
import { DEFAULT_SETTINGS, type PlanisphereSettings } from "../../../src/contract";
import { mergeSettings } from "../../../src/settingsTab";
import { TFile, WorkspaceLeaf } from "obsidian";

const q = new URLSearchParams(location.search);
const scenario = q.get("scenario") || "default";
document.body.classList.add(q.get("chrome") === "light" ? "theme-light" : "theme-dark");

let seed = 7;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];
const DAY = 86400000, NOW = Date.now();

const groups: Record<string, string[]> = {
  Projects: ["Planisphere", "Kith", "Starboard", "Release plan", "Plugin ideas", "Sync engine", "Graph layout", "Avatar cache", "Settings tab", "Roadmap"],
  Reading: ["Gödel Escher Bach", "The Mythical Man-Month", "Designing Data Intensive Apps", "Elixir in Action", "A Pattern Language", "Thinking in Systems", "The Dispossessed", "Piranesi", "Dune notes", "Zines and craft"],
  People: ["Ada Lovelace", "Grace Hopper", "Alan Kay", "Margaret Hamilton", "Teodor Lund", "Sorrel Sandoval", "Kerensa Rasku", "Odalys Oyelaran"],
  Journal: ["2026-10-28", "2026-10-29", "2026-10-30", "2026-11-01", "2026-11-03", "2026-11-05", "2026-11-07", "2026-11-09", "Week 44", "Week 45"],
  "Ideas/Someday": ["Tiny rss reader", "Garden log", "Tabletop campaign map", "Recipe vault", "Sourdough tracker", "Pocket atlas"],
  "Ideas/Now": ["Constellation names", "Panel excerpt", "Local graph", "Orphan rescue"],
  "": ["Home", "Inbox", "Scratchpad"],
};
const files: Array<{ path: string; tags: string[]; fm?: Record<string, unknown>; mtime: number }> = [];
for (const [folder, names] of Object.entries(groups)) for (const n of names) {
  const path = (folder ? folder + "/" : "") + n + ".md";
  const tags = folder === "People" ? ["people"] : folder === "Reading" ? ["book"] : folder.startsWith("Ideas") ? ["idea"] : folder === "Projects" ? ["project", ...(rnd() < 0.4 ? ["obsidian"] : [])] : [];
  const fm = folder === "People" ? { avatar: `Assets/${n.split(" ")[0].toLowerCase()}.png`, handle: n.split(" ")[0].toLowerCase() + ".bsky.social" } : undefined;
  files.push({ path, tags, fm, mtime: NOW - Math.floor(rnd() * 40 * DAY) });
}
const extraOrphans = scenario === "big" ? 0 : 5;
for (let i = 0; i < extraOrphans; i++) files.push({ path: `Archive/Old note ${i + 1}.md`, tags: [], mtime: NOW - 400 * DAY });
if (scenario === "empty") files.length = 0;

const resolved: Record<string, Record<string, number>> = {};
const byFolder = (f: string) => files.filter((x) => x.path.startsWith(f ? f + "/" : "") && !x.path.startsWith("Archive")).map((x) => x.path);
for (const f of files) {
  if (f.path.startsWith("Archive")) continue;
  const here = f.path.includes("/") ? f.path.slice(0, f.path.lastIndexOf("/")) : "";
  const n = 2 + Math.floor(rnd() * 3);
  resolved[f.path] = {};
  for (let i = 0; i < n; i++) { const t = pick(rnd() < 0.7 ? byFolder(here).filter((x) => x.slice(0, x.lastIndexOf("/")) === here || here === "") : files.map((x) => x.path)); if (t && t !== f.path && !t.startsWith("Archive")) resolved[f.path][t] = 1; }
  if (f.path.startsWith("Journal") || f.path.startsWith("Projects")) for (const p of files.filter((x) => x.path.startsWith("People/"))) if (rnd() < 0.35) resolved[f.path][p.path] = 1;
}
// a long-tail hub so "Show all" appears
const hub = "Projects/Planisphere.md";
for (const f of files) if (f.path !== hub && !f.path.startsWith("Archive") && rnd() < 0.3) resolved[f.path][hub] = 1;
for (const f of files.slice(0, 14)) if (f.path !== hub) resolved[hub][f.path] = 1;

function svgAvatar(name: string) {
  let h = 0; for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0; const a = h % 360;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" fill="hsl(${a} 40% 32%)"/><circle cx="48" cy="38" r="18" fill="hsl(${(a + 40) % 360} 55% 72%)"/><rect x="18" y="62" width="60" height="40" rx="22" fill="hsl(${(a + 40) % 360} 55% 72%)"/></svg>`;
  return "data:image/svg+xml;utf8," + encodeURIComponent(svg);
}

const tf = new Map<string, TFile>();
for (const f of files) tf.set(f.path, new (TFile as any)(f.path, f.mtime));
for (const n of ["ada", "grace", "alan", "margaret", "teodor", "sorrel", "kerensa", "odalys"]) if (!(scenario === "default" && n === "kerensa")) tf.set(`Assets/${n}.png`, new (TFile as any)(`Assets/${n}.png`, 0));

const listeners: Record<string, Array<(...a: any[]) => void>> = {};
const on = (ns: string) => (name: string, fn: (...a: any[]) => void) => { const k = ns + ":" + name; (listeners[k] ??= []).push(fn); return { off: () => (listeners[k] = (listeners[k] || []).filter((x) => x !== fn)) }; };
const BODY = (p: string) => `---\ntitle: ${p}\ntags: [x]\n---\n# ${p.replace(/\.md$/, "").split("/").pop()}\n\nThis note collects **loose ideas** about [[Planisphere]] and how a whole vault could look from far away. It links to [[People/Ada Lovelace|Ada]] and a few older threads, with a [reading list](https://example.com) and some TODOs that never made it into the roadmap.\n\n- [ ] sketch the panel\n- [ ] write the settings copy\n`;
let active: TFile | null = scenario === "local-none" ? null : tf.get("Projects/Kith.md")!;
const opened: string[] = [];
const app: any = {
  vault: {
    getMarkdownFiles: () => [...tf.values()].filter((f) => f.extension === "md"),
    getAbstractFileByPath: (p: string) => tf.get(p) ?? null,
    getResourcePath: (f: TFile) => svgAvatar(f.basename),
    cachedRead: async (f: TFile) => { await new Promise((r) => setTimeout(r, 40)); return BODY(f.path); },
    on: on("vault"),
  },
  metadataCache: {
    resolvedLinks: resolved,
    getFileCache: (f: TFile) => { const m = files.find((x) => x.path === f.path); return m ? { frontmatter: { ...(m.fm ?? {}), tags: m.tags }, tags: f.path.startsWith("Journal") ? [{ tag: "#daily" }] : [] } : null; },
    getFirstLinkpathDest: (name: string) => tf.get("Assets/" + name) ?? null,
    on: on("meta"),
  },
  workspace: {
    getActiveFile: () => active,
    on: on("ws"),
    getLeavesOfType: () => [],
    getLeaf: () => ({ openFile: async (f: TFile) => { opened.push(f.path); } }),
    setActiveLeaf() {}, requestSaveLayout() {},
  },
};

let saved: PlanisphereSettings = mergeSettings({ theme: q.get("theme"), localDepth: Number(q.get("depth") || 2), filters: scenario === "nomatch" ? { peopleOnly: true, tags: ["nothing"] } : scenario === "filtered" ? { excludeFolders: ["Journal"], tags: ["project"], folders: ["Projects"] } : {} });
const plugin: any = { app, get settings() { return saved; }, saveSettings: async () => {} };

const leaf = new (WorkspaceLeaf as any)(app);
const view = new PlanisphereView(leaf, plugin);
document.getElementById("host")!.appendChild(view.containerEl);
(async () => {
  if (q.get("mode") === "local") await view.setState({ mode: "local" }, {} as any);
  await view.onOpen();
  (window as any).__ns = { view, opened, fire: (ns: string, name: string, ...a: any[]) => (listeners[ns + ":" + name] || []).forEach((f) => f(...a)), setActive: (p: string) => { active = tf.get(p) ?? null; (listeners["ws:file-open"] || []).forEach((f) => f()); }, settings: () => saved, DEFAULT_SETTINGS };
  (window as any).__ready = true;
})();
