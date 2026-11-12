// The Planisphere ItemView: toolbar, canvas host, right panel, stats pill and empty state around a SkyEngine.
import { ItemView, TFile, WorkspaceLeaf, type ViewStateResult } from "obsidian";
import {
  PLANISPHERE_VIEW_TYPE,
  DEFAULT_FILTERS,
  type EngineStats,
  type GraphFilters,
  type LabelMode,
  type NoteNode,
  type ThemeName,
  type VaultGraph,
  type VaultPort,
} from "./contract";
import { SkyEngine } from "./engine";
import { buildGraph } from "./model";
import { PlanispherePanel, statsText } from "./panel";
import { Toolbar, activeFilterCount, cloneFilters, h, type ScopeMode } from "./toolbar";
import { makeAvatarResolver, makeVaultPort, vaultFolders, vaultTags } from "./vaultPort";
import type PlanispherePlugin from "./main";

const EMPTY_GRAPH: VaultGraph = { nodes: [], edges: [], truncated: false, totalNotes: 0 };

export class PlanisphereView extends ItemView {
  private plugin: PlanispherePlugin;
  private port!: VaultPort;
  private engine: SkyEngine | null = null;
  private toolbar: Toolbar | null = null;
  private panel: PlanispherePanel | null = null;
  private root!: HTMLElement;
  private stageEl!: HTMLElement;
  private canvasHost!: HTMLElement;
  private statsEl!: HTMLElement;
  private statsMain!: HTMLElement;
  private statsNotice!: HTMLElement;
  private statsClear!: HTMLElement;
  private emptyTitle!: HTMLElement;
  private emptyText!: HTMLElement;
  private emptyBtn!: HTMLButtonElement;
  private hintEl!: HTMLElement;
  private ro: ResizeObserver | null = null;
  private rebuildTimer: ReturnType<typeof setTimeout> | undefined;
  private opened = false;
  private mode: ScopeMode = "global";
  private localCenter: string | null = null;
  private selectedId: string | null = null;
  private panelOpen = true;
  private panelTouched = false;
  private pendingCenter = false;
  private graph: VaultGraph = EMPTY_GRAPH;
  private stats: EngineStats = { nodes: 0, edges: 0, clusters: [] };

  constructor(leaf: WorkspaceLeaf, plugin: PlanispherePlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return PLANISPHERE_VIEW_TYPE;
  }
  getDisplayText(): string {
    return "Planisphere";
  }
  getIcon(): string {
    return "sparkles";
  }

  getState(): Record<string, unknown> {
    return { mode: this.mode };
  }

  async setState(state: unknown, result: ViewStateResult): Promise<void> {
    const s = (state ?? {}) as { mode?: string; center?: string };
    if (s.mode === "local" || s.mode === "global") this.mode = s.mode;
    if (typeof s.center === "string") this.localCenter = s.center;
    if (this.opened) {
      if (this.mode === "local" && !s.center) this.adoptActiveFile();
      this.syncToolbar();
      this.applyScope(true);
    }
    await super.setState(state, result);
  }

  /* ---------------- lifecycle ---------------- */

  async onOpen(): Promise<void> {
    const host = this.contentEl;
    while (host.firstChild) host.removeChild(host.firstChild);
    host.classList.add("ns-host");
    const s = this.plugin.settings;

    this.port = makeVaultPort(this.app);
    const resolveAvatar = makeAvatarResolver(this.app);

    this.root = h("div", "ns-root");
    const stage = h("div", "ns-stage");
    this.stageEl = stage;
    this.canvasHost = h("div", "ns-canvas-host");
    stage.appendChild(this.canvasHost);

    this.engine = new SkyEngine({ theme: s.theme, labelMode: s.labelMode, resolveAvatar });
    this.engine.mount(this.canvasHost);

    this.toolbar = new Toolbar(
      {
        folders: () => vaultFolders(this.port),
        tags: () => vaultTags(this.port),
        onFind: (q) => this.engine?.highlight(q),
        onMode: (m) => this.setMode(m),
        onDepth: (d) => {
          this.plugin.settings.localDepth = d;
          this.syncToolbar();
          this.applyScope(false);
          void this.plugin.saveSettings();
        },
        onFilters: (f) => {
          this.plugin.settings.filters = cloneFilters(f);
          void this.plugin.saveSettings();
          this.rebuild();
        },
        onLabelMode: (m) => this.setLabelMode(m),
        onTheme: (t) => this.setTheme(t),
        onFit: () => this.engine?.fit(),
        onRearrange: () => this.engine?.rearrange(),
        onTogglePanel: () => this.setPanelOpen(!this.panelOpen, true),
      },
      { mode: this.mode, depth: s.localDepth, labelMode: s.labelMode, theme: s.theme, filters: s.filters, panelOpen: this.panelOpen }
    );
    stage.appendChild(this.toolbar.el);

    this.hintEl = h("div", "ns-glass ns-hint", "Open a note and its neighbourhood will appear here.");
    this.hintEl.hidden = true;
    stage.appendChild(this.hintEl);

    this.statsEl = h("div", "ns-glass ns-stats");
    this.statsMain = h("span", "ns-stats-main");
    this.statsNotice = h("span", "ns-stats-notice");
    this.statsClear = h("button", "ns-stats-clear", "Show all");
    this.statsClear.title = "Show every note again";
    this.statsClear.hidden = true;
    this.statsClear.addEventListener("click", () => this.setConstellation(null));
    const line = h("span", "ns-stats-line");
    line.append(this.statsMain, this.statsClear);
    this.statsEl.append(line, this.statsNotice);
    stage.appendChild(this.statsEl);

    const empty = h("div", "ns-empty");
    const card = h("div", "ns-empty-card");
    this.emptyTitle = h("h2", "ns-empty-title");
    this.emptyText = h("p", "ns-empty-text");
    this.emptyBtn = h("button", "mod-cta ns-empty-btn");
    this.emptyBtn.hidden = true;
    card.append(this.emptyTitle, this.emptyText, this.emptyBtn);
    empty.appendChild(card);
    stage.appendChild(empty);

    this.panel = new PlanispherePanel({
      readNote: async (id) => {
        const f = this.app.vault.getAbstractFileByPath(id);
        if (!(f instanceof TFile)) return null;
        try {
          return await this.app.vault.cachedRead(f);
        } catch {
          return null;
        }
      },
      openNote: (id, split) => this.openNote(id, split),
      select: (id) => {
        const eng = this.engine;
        if (!eng) return;
        // a note outside the constellation on show: go back to every note first, so the click lands
        if (this.stats.constellation && !eng.inspect().nodeIds.includes(id)) eng.setConstellation(null);
        eng.select(id, { pan: true });
      },
      clear: () => this.engine?.select(null),
      resolveAvatar,
      links: () => this.port.links(),
      onCollapse: () => this.setPanelOpen(false, true),
      setConstellation: (name) => this.setConstellation(name),
      folded: this.plugin.settings.foldedSections,
      onFold: (keys) => {
        this.plugin.settings.foldedSections = keys;
        void this.plugin.saveSettings();
      },
    });

    this.root.append(stage, this.panel.el);
    host.appendChild(this.root);
    this.root.classList.add(s.theme === "paper" ? "ns-theme-paper" : "ns-theme-night");

    this.engine.onSelect((id: string | null) => {
      this.selectedId = id;
      this.panel?.show(id);
      if (id && !this.panelOpen && this.root.classList.contains("ns-narrow") && !this.panelTouched) this.setPanelOpen(true, false);
    });
    this.engine.onOpen((id: string) => this.openNote(id, false));
    this.engine.onStats((st: EngineStats) => this.onStats(st));

    this.registerEvent(this.app.metadataCache.on("resolved", () => this.scheduleRebuild()));
    this.registerEvent(
      this.app.vault.on("rename", (_file, oldPath) => {
        if (this.selectedId === oldPath) this.selectedId = null; // the rebuilt graph re-selects by id when it still exists
        if (this.localCenter === oldPath) this.localCenter = null;
        this.scheduleRebuild();
      })
    );
    this.registerEvent(this.app.vault.on("delete", () => this.scheduleRebuild()));
    this.registerEvent(this.app.workspace.on("file-open", () => this.onActiveFileChanged()));
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.onActiveFileChanged()));

    this.registerDomEvent(this.root, "keydown", (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA");
      if (e.key === "/" && !typing) {
        e.preventDefault();
        this.toolbar?.focusFind();
      } else if (e.key === "Escape" && !typing && this.selectedId) {
        this.engine?.select(null);
      }
    });

    this.ro = new ResizeObserver(() => this.measure());
    this.ro.observe(this.root);
    this.ro.observe(this.stageEl);
    this.measure(true);

    this.opened = true;
    if (this.mode === "local") {
      if (!this.localCenter) this.adoptActiveFile();
      this.pendingCenter = true;
    }
    this.syncToolbar();
    this.rebuild();
  }

  async onClose(): Promise<void> {
    this.opened = false;
    if (this.rebuildTimer) clearTimeout(this.rebuildTimer);
    this.rebuildTimer = undefined;
    this.ro?.disconnect();
    this.ro = null;
    this.toolbar?.destroy();
    this.toolbar = null;
    this.panel?.destroy();
    this.panel = null;
    this.engine?.destroy();
    this.engine = null;
  }

  /** Called by the plugin after the settings tab changed something. */
  syncFromSettings(): void {
    if (!this.opened) return;
    const s = this.plugin.settings;
    this.applyThemeClass(s.theme);
    this.engine?.setTheme(s.theme);
    this.engine?.setLabelMode(s.labelMode);
    this.syncToolbar();
    this.applyScope(false);
    this.rebuild();
  }

  /* ---------------- state changes ---------------- */

  private syncToolbar(): void {
    const s = this.plugin.settings;
    this.toolbar?.setState({ mode: this.mode, depth: s.localDepth, labelMode: s.labelMode, theme: s.theme, filters: s.filters, panelOpen: this.panelOpen });
  }

  /** Show only one constellation (switching to the global graph first), or every note with null. */
  private setConstellation(name: string | null): void {
    if (name !== null && this.mode === "local") {
      this.mode = "global";
      this.syncToolbar();
      this.applyScope(false);
      this.app.workspace.requestSaveLayout?.();
    }
    this.engine?.setConstellation(name);
  }

  private setMode(m: ScopeMode): void {
    if (m === this.mode) return;
    if (m === "local") this.engine?.setConstellation(null);
    this.mode = m;
    if (m === "local") this.adoptActiveFile();
    this.syncToolbar();
    this.applyScope(true);
    this.app.workspace.requestSaveLayout?.();
  }

  private setLabelMode(m: LabelMode): void {
    this.plugin.settings.labelMode = m;
    this.engine?.setLabelMode(m);
    this.syncToolbar();
    void this.plugin.saveSettings();
  }

  private setTheme(t: ThemeName): void {
    this.plugin.settings.theme = t;
    this.applyThemeClass(t);
    this.engine?.setTheme(t);
    this.syncToolbar();
    void this.plugin.saveSettings();
  }

  private applyThemeClass(t: ThemeName): void {
    this.root.classList.toggle("ns-theme-night", t === "night");
    this.root.classList.toggle("ns-theme-paper", t === "paper");
  }

  private setPanelOpen(open: boolean, byUser: boolean): void {
    this.panelOpen = open;
    if (byUser) this.panelTouched = true;
    this.root.classList.toggle("ns-panel-closed", !open);
    this.syncToolbar();
  }

  private activeMarkdownPath(): string | null {
    const f = this.app.workspace.getActiveFile();
    return f && f.extension === "md" ? f.path : null;
  }

  private adoptActiveFile(): boolean {
    const p = this.activeMarkdownPath();
    if (p && p !== this.localCenter) {
      this.localCenter = p;
      return true;
    }
    return false;
  }

  private onActiveFileChanged(): void {
    if (!this.opened || this.mode !== "local") return;
    if (this.adoptActiveFile()) this.applyScope(true);
  }

  /** Push the Global/Local choice to the engine. `selectCenter` also selects the centre note. */
  private applyScope(selectCenter: boolean): void {
    const eng = this.engine;
    if (!eng) return;
    const depth = this.plugin.settings.localDepth;
    const local = this.mode === "local";
    const center = local ? this.localCenter : null;
    if (selectCenter) this.pendingCenter = true;
    eng.setLocal(center, depth);
    this.hintEl.hidden = !(local && !center);
    this.root.classList.toggle("ns-is-local", local);
    if (center && this.pendingCenter && this.graph.nodes.some((n) => n.id === center)) {
      this.pendingCenter = false;
      eng.select(center, { pan: false });
    }
    this.updateStatsEl();
    this.updateEmpty();
  }

  /* ---------------- data ---------------- */

  private scheduleRebuild(): void {
    if (!this.opened) return;
    if (this.rebuildTimer) clearTimeout(this.rebuildTimer);
    this.rebuildTimer = setTimeout(() => {
      this.rebuildTimer = undefined;
      this.rebuild();
    }, 800);
  }

  private rebuild(): void {
    const eng = this.engine;
    if (!this.opened || !eng) return;
    const filters: GraphFilters = { ...DEFAULT_FILTERS, ...this.plugin.settings.filters, query: "" };
    let graph: VaultGraph;
    try {
      graph = buildGraph(this.port, filters);
    } catch (e) {
      console.error("Planisphere: could not build the graph", e);
      return;
    }
    this.graph = graph;
    eng.setData(graph);
    this.panel?.setGraph(graph);
    const keep = this.selectedId;
    this.applyScope(false);
    if (keep && graph.nodes.some((n) => n.id === keep)) eng.select(keep, { pan: false });
    else if (keep) {
      eng.select(null);
      this.selectedId = null;
      this.panel?.show(null);
    }
    this.onStats(eng.getStats());
  }

  private onStats(stats: EngineStats): void {
    this.stats = stats;
    this.panel?.setStats(stats);
    this.updateStatsEl();
    this.updateEmpty();
  }

  private updateStatsEl(): void {
    const t = statsText(this.stats, this.graph, this.mode === "local" && !!this.localCenter);
    this.statsMain.textContent = t.main;
    this.statsNotice.textContent = t.notice;
    this.statsClear.hidden = !(this.stats.constellation && this.mode !== "local");
    this.statsEl.hidden = !t.main && !t.notice;
    this.statsEl.classList.toggle("has-notice", !!t.notice);
  }

  private updateEmpty(): void {
    const g = this.graph;
    const hard = g.totalNotes === 0;
    const none = !hard && g.nodes.length === 0;
    this.root.classList.toggle("ns-is-empty", hard);
    this.root.classList.toggle("ns-no-match", none);
    if (hard) {
      this.emptyTitle.textContent = "No notes yet.";
      this.emptyText.textContent = "Write a few notes and link them with double brackets. Each note becomes a star and each link a thread between stars.";
      this.emptyBtn.hidden = true;
    } else if (none) {
      const f = this.plugin.settings.filters;
      this.emptyTitle.textContent = "Nothing in the sky.";
      if (f.peopleOnly && activeFilterCount(f) === 1) {
        this.emptyTitle.textContent = "No people yet.";
        this.emptyText.textContent =
          "A note becomes a person when it has an avatar: property or a #people tag. The Kith plugin can import the people you follow on Bluesky as notes like these.";
        this.emptyBtn.textContent = "Show all notes";
        this.emptyBtn.hidden = false;
        this.emptyBtn.onclick = () => {
          this.plugin.settings.filters = { ...cloneFilters(f), peopleOnly: false };
          void this.plugin.saveSettings();
          this.syncToolbar();
          this.rebuild();
        };
      } else if (activeFilterCount(f) > 0) {
        this.emptyText.textContent = "No notes match the current filters.";
        this.emptyBtn.textContent = "Reset filters";
        this.emptyBtn.hidden = false;
        this.emptyBtn.onclick = () => {
          this.plugin.settings.filters = cloneFilters(DEFAULT_FILTERS);
          void this.plugin.saveSettings();
          this.syncToolbar();
          this.rebuild();
        };
      } else {
        this.emptyText.textContent = "Notes without links are hidden. Show them to see every note.";
        this.emptyBtn.textContent = "Show orphans";
        this.emptyBtn.hidden = false;
        this.emptyBtn.onclick = () => {
          this.plugin.settings.filters = { ...cloneFilters(f), showOrphans: true };
          void this.plugin.saveSettings();
          this.syncToolbar();
          this.rebuild();
        };
      }
    }
  }

  private measure(first = false): void {
    const w = this.root.clientWidth;
    if (!w) return;
    this.root.classList.toggle("ns-narrow", w < 700);
    const sw = this.stageEl.clientWidth || w;
    this.root.classList.toggle("ns-compact", sw < 1000);
    this.root.classList.toggle("ns-tiny", sw < 640);
    if (first && w < 700 && !this.panelTouched) this.setPanelOpen(false, false);
  }

  /* ---------------- opening notes ---------------- */

  private openNote(id: string, split: boolean): void {
    const file = this.app.vault.getAbstractFileByPath(id);
    if (!(file instanceof TFile)) return;
    const ws = this.app.workspace;
    if (!split) {
      for (const leaf of ws.getLeavesOfType("markdown")) {
        const f = (leaf.view as unknown as { file?: TFile }).file;
        if (f && f.path === id) {
          ws.setActiveLeaf(leaf, { focus: true });
          return;
        }
      }
    }
    void ws.getLeaf(split ? "split" : "tab").openFile(file);
  }

  /** For tests and the lead's integration checks. */
  getSelected(): NoteNode | null {
    return this.graph.nodes.find((n) => n.id === this.selectedId) ?? null;
  }
}
