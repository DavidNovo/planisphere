// Shared contract between the drawing engine (src/model.ts, layout.ts, render.ts, avatars.ts, engine.ts)
// and the Obsidian shell (src/main.ts, view.ts, vaultPort.ts, panel.ts, toolbar.ts, settings.ts).
// Neither side edits this file. If something must change, report it to the lead.

export type ThemeName = "night" | "paper";
export type LabelMode = "auto" | "always" | "never";

/** One note in the graph. */
export interface NoteNode {
  id: string;            // vault path, e.g. "Projects/Kith.md"
  title: string;         // file basename without extension
  folder: string;        // parent folder path, "" for the vault root
  tags: string[];        // without the leading '#'
  inDegree: number;      // notes that link to this one (inside the filtered graph)
  outDegree: number;     // notes this one links to (inside the filtered graph)
  avatarPath?: string;   // vault path or wikilink target from frontmatter `avatar`, if any
  isPerson: boolean;     // has `avatar`, or a `people`/`person` tag, or frontmatter `did`, `handle` or `identities`
  mentions: number;      // for people: inbound links from NON-person notes. Drives the gold ring.
  mtime: number;         // ms since epoch
}

/** A directed link from -> to. The engine draws it undirected. Self links and duplicates are dropped. */
export interface VaultEdge {
  from: string;
  to: string;
}

export interface VaultGraph {
  nodes: NoteNode[];
  edges: VaultEdge[];
  truncated: boolean;    // true when maxNodes cut the graph
  totalNotes: number;    // markdown notes in the vault before filtering
}

export interface GraphFilters {
  folders: string[];         // include only notes under these folder prefixes. Empty = all.
  excludeFolders: string[];  // drop notes under these prefixes
  tags: string[];            // keep notes having ANY of these tags (no '#'). Empty = all.
  query: string;             // case-insensitive substring of title or path. Empty = no filter.
  showOrphans: boolean;      // notes with no links in or out
  orphansOnly: boolean;      // keep ONLY notes with no links in or out
  looseOnly: boolean;        // keep ONLY root-level notes with no tags
  peopleOnly: boolean;       // keep only people notes (and nothing else)
  maxNodes: number;          // safety cap. Keep the highest-degree nodes. Default 4000.
}

export const DEFAULT_FILTERS: GraphFilters = {
  folders: [],
  excludeFolders: [],
  tags: [],
  query: "",
  showOrphans: false,
  orphansOnly: false,
  looseOnly: false,
  peopleOnly: false,
  maxNodes: 4000,
};

/** Everything model.ts needs from the vault. The shell adapts Obsidian's app to this. */
export interface VaultPort {
  /** Markdown notes only. */
  notes(): Array<{ path: string; basename: string; mtime: number }>;
  /** app.metadataCache.resolvedLinks: source path -> { target path -> count }. Targets may be non-markdown. */
  links(): Record<string, Record<string, number>>;
  /** Tags of a note from the metadata cache (frontmatter and inline), without '#'. */
  tagsOf(path: string): string[];
  /** Parsed frontmatter, or null. */
  frontmatter(path: string): Record<string, unknown> | null;
}

export interface ClusterInfo {
  id: number;
  name: string;      // soft name, e.g. "Projects" or "Elixir and books"; "Loose notes" for the leftovers
  count: number;
  color: string;     // CSS color for the cluster
}

export interface EngineStats {
  nodes: number;
  edges: number;
  /** While one constellation is shown alone, this still lists every constellation of the full graph. */
  clusters: ClusterInfo[];
  /** Name of the constellation shown alone, when there is one. */
  constellation?: string;
}

export interface EngineOptions {
  theme: ThemeName;
  labelMode: LabelMode;
  /** Turn an avatar vault path / wikilink target into a URL the browser can load, or undefined. */
  resolveAvatar(avatarPath: string): string | undefined;
}

/**
 * The interactive canvas. Implemented by src/engine.ts as `export class SkyEngine implements SkyEngineApi`.
 * The engine owns the canvas element, resizing, the animation loop, pointer and wheel input
 * (hover, click to select, drag a node, drag background to pan, wheel to zoom, double click to open),
 * and keyboard Enter on the selected node to open it.
 */
export interface SkyEngineApi {
  /** Create the canvas inside `host`, start observing size, start the loop. */
  mount(host: HTMLElement): void;
  /** Stop the loop, remove listeners and the canvas. Safe to call twice. */
  destroy(): void;

  /** Replace the data. Existing node ids keep their positions; new ones appear near their neighbours. */
  setData(graph: VaultGraph): void;
  setTheme(theme: ThemeName): void;
  setLabelMode(mode: LabelMode): void;

  /** Local mode: show only `centerId` and notes within `depth` links of it. null leaves local mode. */
  setLocal(centerId: string | null, depth: 1 | 2 | 3): void;

  /**
   * Show only the notes of one constellation (by name, from getStats().clusters) and fit the camera to them.
   * null shows every note again and restores the camera. Entering local mode clears it.
   */
  setConstellation(name: string | null): void;

  /** Select a node (ring, neighbours lit, others dimmed). Pan to it when opts.pan. null clears. */
  select(id: string | null, opts?: { pan?: boolean }): void;
  /** Find: dim everything that does not match the title/path substring, and pan to the first match. "" clears. */
  highlight(query: string): void;
  fit(): void;
  rearrange(): void;

  getStats(): EngineStats;

  onSelect(cb: (id: string | null) => void): void;   // fired on click selection and select()
  onOpen(cb: (id: string) => void): void;            // double click, or Enter on the selection
  onStats(cb: (stats: EngineStats) => void): void;   // after setData / setLocal change what is drawn
}

export interface PlanisphereSettings {
  theme: ThemeName;
  labelMode: LabelMode;
  filters: GraphFilters;
  localDepth: 1 | 2 | 3;
  /** Overview sections the user folded, by key ("constellations", "mostLinked"). */
  foldedSections: string[];
}

export const DEFAULT_SETTINGS: PlanisphereSettings = {
  theme: "night",
  labelMode: "auto",
  filters: { ...DEFAULT_FILTERS },
  localDepth: 2,
  foldedSections: [],
};

export const PLANISPHERE_VIEW_TYPE = "planisphere-graph";
