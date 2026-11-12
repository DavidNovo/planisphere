// Toolbar and filters popover for the Planisphere view. Plain DOM, no Obsidian imports, so the harness can bundle it.
import type { GraphFilters, LabelMode, ThemeName } from "./contract";
import { DEFAULT_FILTERS } from "./contract";

/* ---------------- tiny DOM helpers (shared with panel.ts) ---------------- */

const SVG_NS = "http://www.w3.org/2000/svg";
const ICONS: Record<string, string> = {
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
  fit: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  shuffle: '<path d="M3 7h3c4 0 5 10 9 10h6M3 17h3c1.5 0 2.6-.9 3.6-2.2M21 7h-6c-1.9 0-3.1 1.2-4.2 2.6M18 4l3 3-3 3M18 14l3 3-3 3"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  filter: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.7 2.7 4 5.7 4 9s-1.3 6.3-4 9c-2.7-2.7-4-5.7-4-9s1.3-6.3 4-9z"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="0.8"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  type: '<path d="M5 7V5h14v2M12 5v14M9 19h6"/>',
  panel: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/>',
  chevron: '<path d="M9 6l6 6-6 6"/>',
};

export function icon(name: string, size = 16): SVGElement {
  const s = document.createElementNS(SVG_NS, "svg");
  s.setAttribute("viewBox", "0 0 24 24");
  s.setAttribute("width", String(size));
  s.setAttribute("height", String(size));
  s.setAttribute("fill", "none");
  s.setAttribute("stroke", "currentColor");
  s.setAttribute("stroke-width", "1.8");
  s.setAttribute("stroke-linecap", "round");
  s.setAttribute("stroke-linejoin", "round");
  s.setAttribute("aria-hidden", "true");
  s.classList.add("ns-icon");
  s.innerHTML = ICONS[name] || "";
  return s;
}

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text !== undefined) el.textContent = text;
  return el;
}

function clear(el: Element): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

/* ---------------- pure helpers ---------------- */

/** How many filters differ from the defaults. Drives the badge on the Filters button. */
export function activeFilterCount(f: GraphFilters): number {
  let n = f.folders.length + f.excludeFolders.length + f.tags.length;
  if (f.showOrphans !== DEFAULT_FILTERS.showOrphans) n++;
  if (f.orphansOnly) n++;
  if (f.looseOnly) n++;
  if (f.peopleOnly) n++;
  if (f.maxNodes !== DEFAULT_FILTERS.maxNodes) n++;
  return n;
}

export function clampMaxNodes(v: number): number {
  if (!Number.isFinite(v)) return DEFAULT_FILTERS.maxNodes;
  return Math.max(50, Math.min(20000, Math.round(v)));
}

/** Suggestions for a chip field: substring match, skip chosen, prefix matches first. */
export function suggestMatches(all: Array<{ value: string; hint?: string }>, chosen: string[], q: string, limit = 8) {
  const needle = q.trim().replace(/^#/, "").toLowerCase();
  const taken = new Set(chosen);
  const hits = all.filter((o) => !taken.has(o.value) && (!needle || o.value.toLowerCase().includes(needle)));
  hits.sort((a, b) => {
    const ap = a.value.toLowerCase().startsWith(needle) ? 0 : 1;
    const bp = b.value.toLowerCase().startsWith(needle) ? 0 : 1;
    return ap - bp;
  });
  return hits.slice(0, limit);
}

export const NEXT_LABEL_MODE: Record<LabelMode, LabelMode> = { auto: "always", always: "never", never: "auto" };
const LABEL_TEXT: Record<LabelMode, string> = { auto: "Auto", always: "Always", never: "Never" };

/* ---------------- chip field with suggestions ---------------- */

interface ChipFieldOpts {
  label: string;
  placeholder: string;
  prefix?: string;
  values: string[];
  options: () => Array<{ value: string; hint?: string }>;
  onChange: (values: string[]) => void;
}

function chipField(o: ChipFieldOpts): { el: HTMLElement; destroy(): void } {
  let values = o.values.slice();
  const wrap = h("div", "ns-field");
  wrap.appendChild(h("div", "ns-field-label", o.label));
  const box = h("div", "ns-chipbox");
  const chips = h("span", "ns-chips");
  const input = h("input", "ns-chip-input");
  input.type = "text";
  input.placeholder = o.placeholder;
  input.setAttribute("aria-label", o.label);
  input.autocomplete = "off";
  input.spellcheck = false;
  const list = h("div", "ns-suggest");
  list.setAttribute("role", "listbox");
  list.hidden = true;
  box.append(chips, input);
  wrap.append(box, list);
  let active = -1;
  let shown: Array<{ value: string; hint?: string }> = [];

  const commit = (next: string[]) => {
    values = next;
    drawChips();
    o.onChange(values.slice());
  };
  const add = (v: string) => {
    const t = v.trim().replace(/^#/, "").replace(/\/+$/, "");
    if (!t || values.includes(t)) return;
    input.value = "";
    hide();
    commit([...values, t]);
  };
  const drawChips = () => {
    clear(chips);
    for (const v of values) {
      const c = h("span", "ns-chip");
      c.appendChild(h("span", "ns-chip-text", (o.prefix ?? "") + v));
      const x = h("button", "ns-chip-x");
      x.type = "button";
      x.setAttribute("aria-label", "Remove " + v);
      x.appendChild(icon("close", 10));
      x.addEventListener("click", (e) => {
        e.stopPropagation();
        commit(values.filter((y) => y !== v));
      });
      c.appendChild(x);
      chips.appendChild(c);
    }
  };
  const hide = () => {
    list.hidden = true;
    active = -1;
  };
  const show = () => {
    shown = suggestMatches(o.options(), values, input.value);
    clear(list);
    if (!shown.length) {
      hide();
      return;
    }
    shown.forEach((s, i) => {
      const row = h("div", "ns-suggest-row" + (i === active ? " is-active" : ""));
      row.setAttribute("role", "option");
      row.appendChild(h("span", "ns-suggest-val", (o.prefix ?? "") + s.value));
      if (s.hint) row.appendChild(h("em", undefined, s.hint));
      row.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        add(s.value);
        input.focus();
      });
      list.appendChild(row);
    });
    list.hidden = false;
  };
  input.addEventListener("input", () => {
    active = -1;
    show();
  });
  input.addEventListener("focus", show);
  input.addEventListener("blur", () => hide());
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (list.hidden) show();
      if (!shown.length) return;
      active = (active + (e.key === "ArrowDown" ? 1 : -1) + shown.length) % shown.length;
      show();
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (active >= 0 && shown[active]) add(shown[active].value);
      else if (input.value.trim()) add(input.value);
    } else if (e.key === "Backspace" && !input.value && values.length) {
      commit(values.slice(0, -1));
    } else if (e.key === "Escape" && !list.hidden) {
      e.stopPropagation();
      hide();
    }
  });
  box.addEventListener("pointerdown", (e) => {
    if (e.target === box) {
      e.preventDefault();
      input.focus();
    }
  });
  drawChips();
  return { el: wrap, destroy: () => wrap.remove() };
}

/* ---------------- toolbar ---------------- */

export type ScopeMode = "global" | "local";

export interface ToolbarState {
  mode: ScopeMode;
  depth: 1 | 2 | 3;
  labelMode: LabelMode;
  theme: ThemeName;
  filters: GraphFilters;
  panelOpen: boolean;
}

export interface ToolbarDeps {
  folders(): string[];
  tags(): Array<{ tag: string; count: number }>;
  onFind(query: string): void;
  onMode(mode: ScopeMode): void;
  onDepth(depth: 1 | 2 | 3): void;
  onFilters(filters: GraphFilters): void;
  onLabelMode(mode: LabelMode): void;
  onTheme(theme: ThemeName): void;
  onFit(): void;
  onRearrange(): void;
  onTogglePanel(): void;
}

export class Toolbar {
  readonly el: HTMLElement;
  private state: ToolbarState;
  private find: HTMLInputElement;
  private findClear: HTMLButtonElement;
  private findTimer: ReturnType<typeof setTimeout> | undefined;
  private scopeBtns: Record<ScopeMode, HTMLButtonElement>;
  private stepper: HTMLElement;
  private depthLabel: HTMLElement;
  private depthMinus: HTMLButtonElement;
  private depthPlus: HTMLButtonElement;
  private filtersBtn: HTMLButtonElement;
  private badge: HTMLElement;
  private labelsBtn: HTMLButtonElement;
  private labelsValue: HTMLElement;
  private themeBtn: HTMLButtonElement;
  private panelBtn: HTMLButtonElement;
  private anchor: HTMLElement;
  private popover: HTMLElement | null = null;
  private fields: Array<{ destroy(): void }> = [];
  private offDoc: (() => void) | null = null;

  constructor(private deps: ToolbarDeps, initial: ToolbarState) {
    this.state = { ...initial, filters: cloneFilters(initial.filters) };
    this.el = h("div", "ns-top");

    // Find
    const find = h("label", "ns-glass ns-find");
    find.appendChild(icon("search", 15));
    this.find = h("input");
    this.find.type = "text";
    this.find.placeholder = "Find a note";
    this.find.setAttribute("aria-label", "Find a note");
    this.find.spellcheck = false;
    find.appendChild(this.find);
    this.findClear = h("button", "ns-find-x");
    this.findClear.type = "button";
    this.findClear.setAttribute("aria-label", "Clear find");
    this.findClear.appendChild(icon("close", 12));
    find.appendChild(this.findClear);
    this.find.addEventListener("input", () => {
      this.syncFindClear();
      if (this.findTimer) clearTimeout(this.findTimer);
      this.findTimer = setTimeout(() => this.deps.onFind(this.find.value), 180);
    });
    this.find.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        if (this.findTimer) clearTimeout(this.findTimer);
        this.deps.onFind(this.find.value);
      } else if (e.key === "Escape" && this.find.value) {
        e.stopPropagation();
        this.clearFind();
      }
    });
    this.findClear.addEventListener("click", () => {
      this.clearFind();
      this.find.focus();
    });

    // Scope: Global / Local with depth stepper
    const scope = h("div", "ns-glass ns-group ns-scope");
    const seg = h("div", "ns-seg");
    seg.setAttribute("role", "group");
    seg.setAttribute("aria-label", "Graph scope");
    const mk = (mode: ScopeMode, label: string, ic: string) => {
      const b = h("button", "ns-btn ns-seg-btn");
      b.type = "button";
      b.setAttribute("aria-label", label + " graph");
      b.title = mode === "global" ? "The whole vault" : "The active note and its neighbours";
      b.appendChild(icon(ic, 14));
      b.appendChild(h("span", "ns-label", label));
      b.addEventListener("click", () => this.deps.onMode(mode));
      seg.appendChild(b);
      return b;
    };
    this.scopeBtns = { global: mk("global", "Global", "globe"), local: mk("local", "Local", "target") };
    scope.appendChild(seg);
    this.stepper = h("div", "ns-stepper");
    this.depthMinus = this.stepBtn("Fewer links away", "minus", -1);
    this.depthLabel = h("span", "ns-depth");
    this.depthLabel.title = "How many links away from the note";
    this.depthPlus = this.stepBtn("More links away", "plus", 1);
    this.stepper.append(this.depthMinus, this.depthLabel, this.depthPlus);
    scope.appendChild(this.stepper);

    // Filters button + popover anchor
    this.anchor = h("div", "ns-anchor");
    const fg = h("div", "ns-glass ns-group");
    this.filtersBtn = h("button", "ns-btn");
    this.filtersBtn.type = "button";
    this.filtersBtn.setAttribute("aria-haspopup", "dialog");
    this.filtersBtn.appendChild(icon("filter", 14));
    this.filtersBtn.appendChild(h("span", "ns-label", "Filters"));
    this.badge = h("span", "ns-badge");
    this.filtersBtn.appendChild(this.badge);
    this.filtersBtn.addEventListener("click", () => (this.popover ? this.closePopover() : this.openPopover()));
    fg.appendChild(this.filtersBtn);
    this.anchor.appendChild(fg);

    // Actions
    const actions = h("div", "ns-glass ns-group ns-actions");
    this.labelsBtn = h("button", "ns-btn");
    this.labelsBtn.type = "button";
    this.labelsBtn.appendChild(icon("type", 14));
    const lt = h("span", "ns-label");
    lt.appendChild(document.createTextNode("Labels: "));
    this.labelsValue = h("span", "ns-labels-value");
    lt.appendChild(this.labelsValue);
    this.labelsBtn.appendChild(lt);
    this.labelsBtn.addEventListener("click", () => this.deps.onLabelMode(NEXT_LABEL_MODE[this.state.labelMode]));
    this.themeBtn = h("button", "ns-btn ns-btn-icon");
    this.themeBtn.type = "button";
    this.themeBtn.addEventListener("click", () => this.deps.onTheme(this.state.theme === "night" ? "paper" : "night"));
    const fit = this.iconBtn("Fit to view", "fit", () => this.deps.onFit());
    const re = this.iconBtn("Rearrange", "shuffle", () => this.deps.onRearrange());
    this.panelBtn = this.iconBtn("Toggle panel", "panel", () => this.deps.onTogglePanel());
    const fitL = h("span", "ns-label", "Fit");
    const reL = h("span", "ns-label", "Rearrange");
    fit.classList.remove("ns-btn-icon");
    re.classList.remove("ns-btn-icon");
    fit.appendChild(fitL);
    re.appendChild(reL);
    actions.append(this.labelsBtn, this.themeBtn, fit, re, this.panelBtn);

    const left = h("div", "ns-top-left");
    left.append(find, scope, this.anchor);
    this.el.append(left, actions);

    this.setState({});
  }

  private stepBtn(label: string, ic: string, delta: number): HTMLButtonElement {
    const b = h("button", "ns-btn ns-btn-icon ns-step");
    b.type = "button";
    b.setAttribute("aria-label", label);
    b.title = label;
    b.appendChild(icon(ic, 12));
    b.addEventListener("click", () => {
      const d = Math.max(1, Math.min(3, this.state.depth + delta)) as 1 | 2 | 3;
      if (d !== this.state.depth) this.deps.onDepth(d);
    });
    return b;
  }

  private iconBtn(label: string, ic: string, fn: () => void): HTMLButtonElement {
    const b = h("button", "ns-btn ns-btn-icon");
    b.type = "button";
    b.setAttribute("aria-label", label);
    b.title = label;
    b.appendChild(icon(ic, 15));
    b.addEventListener("click", fn);
    return b;
  }

  private syncFindClear(): void {
    this.findClear.hidden = !this.find.value;
  }

  clearFind(): void {
    if (this.findTimer) clearTimeout(this.findTimer);
    this.find.value = "";
    this.syncFindClear();
    this.deps.onFind("");
  }

  focusFind(): void {
    this.find.focus();
    this.find.select();
  }

  setState(patch: Partial<ToolbarState>): void {
    if (patch.filters) patch = { ...patch, filters: cloneFilters(patch.filters) };
    this.state = { ...this.state, ...patch };
    const s = this.state;
    for (const m of ["global", "local"] as ScopeMode[]) {
      const on = s.mode === m;
      this.scopeBtns[m].classList.toggle("is-on", on);
      this.scopeBtns[m].setAttribute("aria-pressed", String(on));
    }
    this.stepper.hidden = s.mode !== "local";
    this.depthLabel.textContent = `${s.depth} ${s.depth === 1 ? "link" : "links"}`;
    this.depthMinus.disabled = s.depth <= 1;
    this.depthPlus.disabled = s.depth >= 3;
    const n = activeFilterCount(s.filters);
    this.badge.textContent = n ? String(n) : "";
    this.badge.hidden = !n;
    this.filtersBtn.classList.toggle("is-on", n > 0 || !!this.popover);
    this.labelsValue.textContent = LABEL_TEXT[s.labelMode];
    this.labelsBtn.setAttribute("aria-label", "Labels: " + LABEL_TEXT[s.labelMode] + ". Click to change.");
    this.labelsBtn.title = "Labels: " + LABEL_TEXT[s.labelMode] + ". Click to change.";
    clear(this.themeBtn);
    this.themeBtn.appendChild(icon(s.theme === "night" ? "sun" : "moon", 15));
    const tl = s.theme === "night" ? "Switch to paper theme" : "Switch to night theme";
    this.themeBtn.setAttribute("aria-label", tl);
    this.themeBtn.title = tl;
    this.panelBtn.classList.toggle("is-on", s.panelOpen);
    this.panelBtn.setAttribute("aria-pressed", String(s.panelOpen));
    this.panelBtn.title = s.panelOpen ? "Hide panel" : "Show panel";
    this.syncFindClear();
    if (patch.filters && this.popover) this.syncPopoverToggles();
  }

  /* ----- popover ----- */

  private toggles: { orphans?: HTMLInputElement; orphansOnly?: HTMLInputElement; looseOnly?: HTMLInputElement; people?: HTMLInputElement; max?: HTMLInputElement } = {};

  private syncPopoverToggles(): void {
    const f = this.state.filters;
    if (this.toggles.orphans) this.toggles.orphans.checked = f.showOrphans;
    if (this.toggles.orphansOnly) this.toggles.orphansOnly.checked = f.orphansOnly;
    if (this.toggles.looseOnly) this.toggles.looseOnly.checked = f.looseOnly;
    if (this.toggles.people) this.toggles.people.checked = f.peopleOnly;
    if (this.toggles.max && document.activeElement !== this.toggles.max) this.toggles.max.value = String(f.maxNodes);
  }

  private emit(patch: Partial<GraphFilters>): void {
    const next = { ...this.state.filters, ...patch };
    this.state.filters = next;
    this.setState({ filters: next });
    this.deps.onFilters(cloneFilters(next));
  }

  openPopover(): void {
    if (this.popover) return;
    const f = this.state.filters;
    const pop = h("div", "ns-popover");
    pop.setAttribute("role", "dialog");
    pop.setAttribute("aria-label", "Graph filters");
    pop.appendChild(h("div", "ns-pop-title", "Filters"));

    const folderOpts = () => this.deps.folders().map((v) => ({ value: v }));
    const inc = chipField({ label: "Only these folders", placeholder: "Add a folder", values: f.folders, options: folderOpts, onChange: (v) => this.emit({ folders: v }) });
    const exc = chipField({ label: "Leave out these folders", placeholder: "Add a folder", values: f.excludeFolders, options: folderOpts, onChange: (v) => this.emit({ excludeFolders: v }) });
    const tags = chipField({
      label: "Only these tags",
      placeholder: "Add a tag",
      prefix: "#",
      values: f.tags,
      options: () => this.deps.tags().map((t) => ({ value: t.tag, hint: String(t.count) })),
      onChange: (v) => this.emit({ tags: v }),
    });
    this.fields = [inc, exc, tags];
    pop.append(inc.el, exc.el, tags.el);

    const row = (label: string, desc: string, on: boolean, fn: (v: boolean) => void) => {
      const r = h("label", "ns-toggle-row");
      const t = h("span", "ns-toggle-text");
      t.appendChild(h("span", "ns-toggle-name", label));
      t.appendChild(h("span", "ns-toggle-desc", desc));
      const cb = h("input");
      cb.type = "checkbox";
      cb.className = "ns-switch";
      cb.checked = on;
      cb.addEventListener("change", () => fn(cb.checked));
      r.append(t, cb);
      return { r, cb };
    };
    const orphans = row("Show orphans", "Notes with no links in or out.", f.showOrphans, (v) => this.emit({ showOrphans: v }));
    const orphansOnly = row("Orphans only", "Just notes with no links in or out.", f.orphansOnly, (v) => this.emit({ orphansOnly: v }));
    const loose = row("Loose files", "Root-level notes with no tags.", f.looseOnly, (v) => this.emit({ looseOnly: v }));
    const people = row("People only", "Notes about people, with their avatars. Shows people with no links too.", f.peopleOnly, (v) => this.emit({ peopleOnly: v }));
    this.toggles.orphans = orphans.cb;
    this.toggles.orphansOnly = orphansOnly.cb;
    this.toggles.looseOnly = loose.cb;
    this.toggles.people = people.cb;
    pop.append(orphans.r, orphansOnly.r, loose.r, people.r);

    const mx = h("label", "ns-toggle-row");
    const mt = h("span", "ns-toggle-text");
    mt.appendChild(h("span", "ns-toggle-name", "Max notes"));
    mt.appendChild(h("span", "ns-toggle-desc", "Keeps the best connected when the vault is bigger."));
    const num = h("input", "ns-num");
    num.type = "number";
    num.min = "50";
    num.max = "20000";
    num.step = "100";
    num.value = String(f.maxNodes);
    num.addEventListener("change", () => {
      const v = clampMaxNodes(Number(num.value));
      num.value = String(v);
      if (v !== this.state.filters.maxNodes) this.emit({ maxNodes: v });
    });
    mx.append(mt, num);
    this.toggles.max = num;
    pop.appendChild(mx);

    const foot = h("div", "ns-pop-foot");
    const reset = h("button", "ns-link-btn", "Reset filters");
    reset.type = "button";
    reset.addEventListener("click", () => {
      this.emit(cloneFilters(DEFAULT_FILTERS));
      this.closePopover();
      this.openPopover();
    });
    foot.appendChild(reset);
    pop.appendChild(foot);

    this.anchor.appendChild(pop);
    this.popover = pop;
    this.filtersBtn.setAttribute("aria-expanded", "true");
    this.filtersBtn.classList.add("is-on");

    const onDown = (e: PointerEvent) => {
      const t = e.target as Node | null;
      if (t && (pop.contains(t) || this.filtersBtn.contains(t))) return;
      this.closePopover();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        this.closePopover();
        this.filtersBtn.focus();
      }
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey);
    this.offDoc = () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey);
    };
  }

  closePopover(): void {
    if (!this.popover) return;
    this.offDoc?.();
    this.offDoc = null;
    for (const f of this.fields) f.destroy();
    this.fields = [];
    this.toggles = {};
    this.popover.remove();
    this.popover = null;
    this.filtersBtn.setAttribute("aria-expanded", "false");
    this.setState({});
  }

  get popoverOpen(): boolean {
    return !!this.popover;
  }

  destroy(): void {
    if (this.findTimer) clearTimeout(this.findTimer);
    this.closePopover();
    this.el.remove();
  }
}

export function cloneFilters(f: GraphFilters): GraphFilters {
  return { ...f, folders: f.folders.slice(), excludeFolders: f.excludeFolders.slice(), tags: f.tags.slice() };
}
