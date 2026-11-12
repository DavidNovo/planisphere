// The right-hand panel: details for the selected note, or an overview of the sky.
// The pure helpers at the top are exported for tests. The PlanispherePanel class only needs a DOM.
import type { ClusterInfo, EngineStats, NoteNode, VaultGraph } from "./contract";
import { h, icon } from "./toolbar";

/* ---------------- pure helpers ---------------- */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function plural(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? "" : "s"} ago`;
}

/** "Edited 3 days ago". Returns "" when the time is unknown. */
export function relativeEdited(mtime: number, now: number = Date.now()): string {
  if (!mtime || mtime <= 0) return "";
  const diff = Math.max(0, now - mtime);
  if (diff < MINUTE) return "Edited just now";
  if (diff < HOUR) return "Edited " + plural(Math.floor(diff / MINUTE), "minute");
  if (diff < DAY) return "Edited " + plural(Math.floor(diff / HOUR), "hour");
  const days = Math.floor(diff / DAY);
  if (days === 1) return "Edited yesterday";
  if (days < 30) return "Edited " + plural(days, "day");
  if (days < 365) return "Edited " + plural(Math.floor(days / 30), "month");
  return "Edited " + plural(Math.floor(days / 365), "year");
}

/** Strip frontmatter and markdown noise, then cut at about `max` characters on a word boundary. */
function firstNonEmpty(s: string): string {
  return s.split("\n").map((l) => l.trim()).find(Boolean) ?? "";
}

export function cleanExcerpt(raw: string, max = 280): string {
  let s = raw.replace(/\r\n?/g, "\n");
  s = s.replace(/^﻿/, "");
  s = s.replace(/^---[ \t]*\n[\s\S]*?\n(?:---|\.\.\.)[ \t]*(?:\n|$)/, "");
  s = s.replace(/```[\s\S]*?(?:```|$)/g, " ");
  s = s.replace(/~~~[\s\S]*?(?:~~~|$)/g, " ");
  s = s.replace(/<!--[\s\S]*?-->/g, " ");
  s = s.replace(/%%[\s\S]*?%%/g, " ");
  s = s.replace(/<\/?[a-zA-Z][^>]*>/g, " ");
  s = s.replace(/!\[\[[^\]]*\]\]/g, " ");
  s = s.replace(/!\[[^\]]*\]\([^)]*\)/g, " ");
  s = s.replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, "$2");
  s = s.replace(/\[\[([^\]]*)\]\]/g, (_m, t: string) => t.split("#")[0] || t);
  s = s.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
  s = s.replace(/\[\^[^\]]*\]/g, "");
  const lines = s.split("\n").map((line) => {
    let l = line.trim();
    if (/^([-*_])(\s*\1){2,}$/.test(l)) return "";
    if (/^\|?[\s:|-]+\|?$/.test(l) && l.includes("-")) return "";
    l = l.replace(/^#{1,6}\s+/, "");
    l = l.replace(/^(>\s*)+/, "");
    l = l.replace(/^\[![^\]]*\][+-]?\s*/, "");
    l = l.replace(/^[-*+]\s+(\[[ xX]\]\s+)?/, "");
    l = l.replace(/^\d+[.)]\s+/, "");
    l = l.replace(/\|/g, " ");
    return l.trim();
  });
  const kept = lines.filter(Boolean);
  // A leading H1 usually repeats the note title, so skip it when there is more to show.
  if (kept.length > 1 && /^# /.test(firstNonEmpty(s))) kept.shift();
  s = kept.join(" ");
  s = s.replace(/(\*\*|__|~~|==)(.+?)\1/g, "$2");
  s = s.replace(/(\*|_)(\S(?:.*?\S)?)\1/g, "$2");
  s = s.replace(/`([^`]*)`/g, "$1");
  s = s.replace(/\s+/g, " ").trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const sp = cut.lastIndexOf(" ");
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,;:.\-]+$/, "") + "…";
}

export interface LinkEntry {
  id: string;
  title: string;
}

function titleOf(path: string): string {
  const base = path.split("/").pop() || path;
  return base.replace(/\.md$/i, "");
}

/**
 * Outgoing and incoming links of one note. `known` limits entries to notes that are
 * in the graph (so every entry can be selected). Self links are dropped.
 */
export function linkLists(
  links: Record<string, Record<string, number>>,
  id: string,
  known: (path: string) => boolean,
  titles?: (path: string) => string | undefined
): { to: LinkEntry[]; from: LinkEntry[] } {
  const entry = (p: string): LinkEntry => ({ id: p, title: titles?.(p) ?? titleOf(p) });
  const byTitle = (a: LinkEntry, b: LinkEntry) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
  const to = Object.keys(links[id] ?? {})
    .filter((p) => p !== id && known(p))
    .map(entry)
    .sort(byTitle);
  const from: LinkEntry[] = [];
  for (const src of Object.keys(links)) {
    if (src === id || !known(src)) continue;
    if (links[src] && Object.prototype.hasOwnProperty.call(links[src], id)) from.push(entry(src));
  }
  from.sort(byTitle);
  return { to, from };
}

/** "Projects/Active/Kith.md" -> folder crumbs ["Projects", "Active"]. Root notes give []. */
export function folderCrumbs(folder: string): string[] {
  return folder.split("/").filter(Boolean);
}

/** The notes with the most links, for the overview. Ties break by title. */
export function mostLinked(nodes: NoteNode[], n = 8): NoteNode[] {
  return nodes
    .filter((x) => x.inDegree + x.outDegree > 0)
    .sort((a, b) => b.inDegree + b.outDegree - (a.inDegree + a.outDegree) || a.title.localeCompare(b.title))
    .slice(0, n);
}

export function initialsOf(title: string): string {
  const words = title.split(/[\s_\-]+/).filter(Boolean);
  if (!words.length) return "?";
  if (words.length === 1) return Array.from(words[0]).slice(0, 2).join("").toUpperCase();
  return (Array.from(words[0])[0] + Array.from(words[1])[0]).toUpperCase();
}

export function mentionsLine(mentions: number): string {
  return mentions > 0 ? `Written about ${mentions} ${mentions === 1 ? "time" : "times"}` : "";
}

export function formatCount(n: number): string {
  return n.toLocaleString("en-US");
}

/** Text for the stats pill. Pure, so it is easy to test. */
export function statsText(stats: EngineStats, graph: VaultGraph, local: boolean): { main: string; notice: string } {
  const notes = `${formatCount(stats.nodes)} ${stats.nodes === 1 ? "note" : "notes"}`;
  const links = `${formatCount(stats.edges)} ${stats.edges === 1 ? "link" : "links"}`;
  const one = !local && stats.constellation ? stats.constellation : "";
  const main = stats.nodes ? `${local ? "Nearby: " : one ? `In ${one}: ` : ""}${notes}, ${links}` : "";
  const notice = graph.truncated && !local && !one ? `Showing the ${formatCount(graph.nodes.length)} best connected of ${formatCount(graph.totalNotes)} notes` : "";
  return { main, notice };
}

/* ---------------- panel ---------------- */

export interface PanelDeps {
  /** Body text of a note, or null when unreadable. */
  readNote(id: string): Promise<string | null>;
  openNote(id: string, split: boolean): void;
  /** Select in the engine and pan to it. */
  select(id: string): void;
  /** Clear the selection in the engine. */
  clear(): void;
  resolveAvatar(path: string): string | undefined;
  links(): Record<string, Record<string, number>>;
  onCollapse(): void;
  /** Show only this constellation's notes, or every note again with null. */
  setConstellation?(name: string | null): void;
  /** Overview sections folded when the panel opens. */
  folded?: string[];
  /** Called with every folded section key whenever one is folded or unfolded. */
  onFold?(folded: string[]): void;
  now?(): number;
}

const LIST_CAP = 10;

export class PlanispherePanel {
  readonly el: HTMLElement;
  private body: HTMLElement;
  private title: HTMLElement;
  private graph: VaultGraph = { nodes: [], edges: [], truncated: false, totalNotes: 0 };
  private byId = new Map<string, NoteNode>();
  private stats: EngineStats = { nodes: 0, edges: 0, clusters: [] };
  private selected: string | null = null;
  private token = 0;
  private expanded = new Set<string>();
  private destroyed = false;
  private folded: Set<string>;

  constructor(private deps: PanelDeps) {
    this.folded = new Set(deps.folded ?? []);
    this.el = h("aside", "ns-panel");
    this.el.setAttribute("aria-label", "Note details");
    const head = h("div", "ns-panel-head");
    this.title = h("span", "ns-panel-title", "Overview");
    head.appendChild(this.title);
    const close = h("button", "ns-icon-btn clickable-icon");
    close.setAttribute("aria-label", "Hide panel");
    close.title = "Hide panel";
    close.appendChild(icon("panel", 16));
    close.addEventListener("click", () => this.deps.onCollapse());
    head.appendChild(close);
    this.body = h("div", "ns-panel-body");
    this.el.append(head, this.body);
    this.render(true);
  }

  setGraph(graph: VaultGraph): void {
    this.graph = graph;
    this.byId = new Map(graph.nodes.map((n) => [n.id, n]));
    this.render(false);
  }

  setStats(stats: EngineStats): void {
    this.stats = stats;
    if (this.selected === null || !this.byId.has(this.selected)) this.render(false);
  }

  show(id: string | null): void {
    const changed = id !== this.selected;
    this.selected = id;
    if (changed) this.expanded.clear();
    this.render(changed);
  }

  destroy(): void {
    this.destroyed = true;
    this.token++;
    this.el.remove();
  }

  private render(fresh: boolean): void {
    if (this.destroyed) return;
    const scroll = this.body.scrollTop;
    this.token++;
    while (this.body.firstChild) this.body.removeChild(this.body.firstChild);
    const node = this.selected !== null ? this.byId.get(this.selected) : undefined;
    if (node) {
      this.title.textContent = node.isPerson ? "Person" : "Note";
      this.body.appendChild(this.noteView(node, fresh));
    } else {
      this.title.textContent = "Overview";
      this.body.appendChild(this.overview());
    }
    this.body.scrollTop = fresh ? 0 : scroll;
  }

  /* ----- selected note ----- */

  private noteView(node: NoteNode, fresh: boolean): HTMLElement {
    const wrap = h("div", "ns-note" + (fresh ? " ns-enter" : ""));

    const who = h("div", "ns-who");
    if (node.isPerson) who.appendChild(this.avatar(node));
    const ident = h("div", "ns-ident");
    ident.appendChild(h("div", "ns-name", node.title));
    const crumbs = folderCrumbs(node.folder);
    const path = h("div", "ns-crumbs");
    if (!crumbs.length) path.appendChild(h("span", "ns-crumb ns-crumb-root", "Vault root"));
    crumbs.forEach((c, i) => {
      if (i > 0) path.appendChild(h("span", "ns-crumb-sep", "/"));
      path.appendChild(h("span", "ns-crumb", c));
    });
    ident.appendChild(path);
    who.appendChild(ident);
    const x = h("button", "ns-icon-btn clickable-icon ns-clear");
    x.setAttribute("aria-label", "Clear selection");
    x.appendChild(icon("close", 14));
    x.addEventListener("click", () => this.deps.clear());
    who.appendChild(x);
    wrap.appendChild(who);

    const meta = h("div", "ns-meta");
    const edited = relativeEdited(node.mtime, this.deps.now ? this.deps.now() : Date.now());
    if (edited) meta.appendChild(h("span", "ns-edited", edited));
    const m = mentionsLine(node.mentions);
    if (node.isPerson && m) meta.appendChild(h("span", "ns-mentions", m));
    if (meta.childNodes.length) wrap.appendChild(meta);

    if (node.tags.length) {
      const tags = h("div", "ns-tags");
      for (const t of node.tags.slice(0, 12)) tags.appendChild(h("span", "ns-chip ns-chip-tag", "#" + t));
      if (node.tags.length > 12) tags.appendChild(h("span", "ns-chip ns-chip-more", `+${node.tags.length - 12}`));
      wrap.appendChild(tags);
    }

    const excerpt = h("p", "ns-excerpt ns-skeleton");
    wrap.appendChild(excerpt);
    const tok = this.token;
    this.deps
      .readNote(node.id)
      .then((text) => {
        if (this.destroyed || tok !== this.token) return;
        const clean = text ? cleanExcerpt(text) : "";
        if (clean) {
          excerpt.textContent = clean;
          excerpt.classList.remove("ns-skeleton");
        } else excerpt.remove();
      })
      .catch(() => {
        if (tok === this.token) excerpt.remove();
      });

    const open = h("button", "mod-cta ns-open", "Open note");
    open.title = "Open note. Cmd or Ctrl click opens it in a split.";
    open.addEventListener("click", (e) => this.deps.openNote(node.id, e.metaKey || e.ctrlKey));
    wrap.appendChild(open);

    const lists = linkLists(this.deps.links(), node.id, (p) => this.byId.has(p), (p) => this.byId.get(p)?.title);
    wrap.appendChild(this.linkSection("Links to", "to", lists.to, "Nothing in the sky yet."));
    wrap.appendChild(this.linkSection("Linked from", "from", lists.from, "Nothing links here yet."));
    return wrap;
  }

  private linkSection(label: string, key: string, items: LinkEntry[], empty: string): HTMLElement {
    const sec = h("section", "ns-sec");
    const hd = h("h4");
    hd.appendChild(document.createTextNode(label));
    hd.appendChild(h("span", undefined, String(items.length)));
    sec.appendChild(hd);
    if (!items.length) {
      sec.appendChild(h("p", "ns-muted", empty));
      return sec;
    }
    const all = this.expanded.has(key);
    const list = h("div", "ns-links");
    items.forEach((it, i) => {
      if (i >= LIST_CAP && !all) return;
      const b = h("button", "ns-link");
      b.title = it.id;
      b.appendChild(h("span", "ns-link-dot"));
      b.appendChild(h("span", "ns-link-title", it.title));
      b.addEventListener("click", () => this.deps.select(it.id));
      list.appendChild(b);
    });
    sec.appendChild(list);
    if (items.length > LIST_CAP && !all) {
      const more = h("button", "ns-more", `Show all ${items.length}`);
      more.addEventListener("click", () => {
        this.expanded.add(key);
        this.render(false);
      });
      sec.appendChild(more);
    }
    return sec;
  }

  private avatar(node: NoteNode): HTMLElement {
    const box = h("div", "ns-avatar" + (node.mentions > 0 ? " is-cited" : ""));
    const url = node.avatarPath ? this.deps.resolveAvatar(node.avatarPath) : undefined;
    const fallback = () => {
      box.textContent = "";
      box.classList.add("is-initials");
      box.appendChild(h("span", undefined, initialsOf(node.title)));
    };
    if (url) {
      const img = h("img");
      img.alt = "";
      img.src = url;
      img.addEventListener("error", fallback);
      box.appendChild(img);
    } else fallback();
    return box;
  }

  /* ----- overview ----- */

  /** A section heading that folds `body`. `hint` shows beside the title while folded. */
  private foldHead(key: string, title: string, hint: string, body: HTMLElement): HTMLElement {
    const head = h("h4", "ns-over-h ns-fold-head");
    const btn = h("button", "ns-fold");
    const id = `ns-fold-${key}`;
    body.id = id;
    btn.setAttribute("aria-controls", id);
    const chev = h("span", "ns-fold-chev");
    chev.appendChild(icon("chevron", 12));
    const note = h("span", "ns-fold-hint", hint);
    btn.append(chev, h("span", "ns-fold-title", title), note);
    const apply = () => {
      const shut = this.folded.has(key);
      btn.setAttribute("aria-expanded", shut ? "false" : "true");
      btn.title = shut ? `Show ${title.toLowerCase()}` : `Hide ${title.toLowerCase()}`;
      head.classList.toggle("is-folded", shut);
      body.hidden = shut;
    };
    btn.addEventListener("click", () => {
      if (this.folded.has(key)) this.folded.delete(key);
      else this.folded.add(key);
      apply();
      this.deps.onFold?.(Array.from(this.folded).sort());
    });
    head.appendChild(btn);
    apply();
    return head;
  }

  private overview(): HTMLElement {
    const wrap = h("div", "ns-note ns-overview");
    wrap.appendChild(h("h2", "ns-over-title", "Your vault, at night"));
    wrap.appendChild(h("p", "ns-muted", "Click a star to see what it links to. Scroll to zoom, drag to move around, double click to open a note."));

    const clusters: ClusterInfo[] = this.stats.clusters;
    const active = this.stats.constellation ?? null;
    const pick = this.deps.setConstellation;
    if (clusters.length) {
      const list = h("div", "ns-clusters" + (active ? " has-active" : ""));
      const head = this.foldHead("constellations", "Constellations", active ?? String(clusters.length), list);
      if (active && pick) {
        const all = h("button", "ns-over-action", "Show all");
        all.addEventListener("click", () => pick(null));
        head.appendChild(all);
      }
      wrap.appendChild(head);
      for (const c of clusters) {
        const on = c.name === active;
        const row = h(pick ? "button" : "div", "ns-cluster-row" + (on ? " is-active" : ""));
        const dot = h("i");
        dot.style.background = c.color;
        row.append(dot, h("span", "ns-cluster-name", c.name), h("em", undefined, String(c.count)));
        if (pick) {
          row.setAttribute("aria-pressed", on ? "true" : "false");
          row.title = on ? "Show every note again" : `Show only ${c.name}`;
          row.addEventListener("click", () => pick(on ? null : c.name));
        }
        list.appendChild(row);
      }
      wrap.appendChild(list);
    }

    const top = mostLinked(this.graph.nodes);
    if (top.length) {
      const list = h("div", "ns-links");
      wrap.appendChild(this.foldHead("mostLinked", "Most linked notes", String(top.length), list));
      for (const n of top) {
        const b = h("button", "ns-link");
        b.title = n.id;
        b.appendChild(h("span", "ns-link-dot"));
        b.appendChild(h("span", "ns-link-title", n.title));
        b.appendChild(h("em", undefined, String(n.inDegree + n.outDegree)));
        b.addEventListener("click", () => this.deps.select(n.id));
        list.appendChild(b);
      }
      wrap.appendChild(list);
    }
    return wrap;
  }
}
