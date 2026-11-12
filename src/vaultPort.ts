// Adapters from Obsidian's app to the engine-facing VaultPort, plus a few pure helpers for the shell.
import { TFile, type App, type CachedMetadata } from "obsidian";
import type { VaultPort } from "./contract";

const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "avif", "bmp"]);

/** Normalise one tag: trim, drop leading '#'. Returns "" when nothing is left. */
function cleanTag(t: string): string {
  return t.trim().replace(/^#+/, "").trim();
}

/** Frontmatter `tags` can be a string ("a, b" or "a b"), an array, or null. */
export function parseTagsValue(v: unknown): string[] {
  const out: string[] = [];
  const push = (s: unknown) => {
    if (typeof s !== "string") return;
    for (const part of s.split(/[,\s]+/)) {
      const t = cleanTag(part);
      if (t) out.push(t);
    }
  };
  if (Array.isArray(v)) v.forEach(push);
  else push(v);
  return out;
}

/** All tags of a cached note: frontmatter (tags / tag) plus inline, deduplicated, without '#'. */
export function tagsFromCache(cache: CachedMetadata | null | undefined): string[] {
  if (!cache) return [];
  const seen = new Set<string>();
  const add = (t: string) => {
    if (t) seen.add(t);
  };
  const fm = cache.frontmatter as Record<string, unknown> | undefined;
  if (fm) {
    parseTagsValue(fm.tags).forEach(add);
    parseTagsValue(fm.tag).forEach(add);
  }
  for (const t of cache.tags ?? []) add(cleanTag(t.tag));
  return [...seen];
}

export function makeVaultPort(app: App): VaultPort {
  return {
    notes() {
      return app.vault.getMarkdownFiles().map((f) => ({ path: f.path, basename: f.basename, mtime: f.stat?.mtime ?? 0 }));
    },
    links() {
      return app.metadataCache.resolvedLinks;
    },
    tagsOf(path) {
      const f = app.vault.getAbstractFileByPath(path);
      if (!(f instanceof TFile)) return [];
      return tagsFromCache(app.metadataCache.getFileCache(f));
    },
    frontmatter(path) {
      const f = app.vault.getAbstractFileByPath(path);
      if (!(f instanceof TFile)) return null;
      const fm = app.metadataCache.getFileCache(f)?.frontmatter;
      if (!fm) return null;
      const { position: _position, ...rest } = fm as Record<string, unknown>;
      return rest;
    },
  };
}

/** "[[Avatars/me.png|alias]]", "![[me.png]]" or a plain path all become the bare target. */
export function cleanAvatarTarget(raw: string): string {
  let s = raw.trim();
  s = s.replace(/^!?\[\[/, "").replace(/\]\]$/, "");
  s = s.split("|")[0].split("#")[0].trim();
  return s;
}

function isImage(file: TFile): boolean {
  const ext = (file.extension || file.name.split(".").pop() || "").toLowerCase();
  return IMAGE_EXT.has(ext);
}

export function makeAvatarResolver(app: App): (avatarPath: string) => string | undefined {
  return (avatarPath) => {
    const target = cleanAvatarTarget(avatarPath || "");
    if (!target) return undefined;
    let file: unknown = app.vault.getAbstractFileByPath(target);
    if (!(file instanceof TFile)) file = app.metadataCache.getFirstLinkpathDest(target, "");
    if (!(file instanceof TFile) || !isImage(file)) return undefined;
    return app.vault.getResourcePath(file);
  };
}

/** Every folder that holds at least one note, plus their ancestors, sorted. The vault root is left out. */
export function vaultFolders(port: VaultPort): string[] {
  const set = new Set<string>();
  for (const n of port.notes()) {
    const parts = n.path.split("/").slice(0, -1);
    for (let i = 1; i <= parts.length; i++) set.add(parts.slice(0, i).join("/"));
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

/** Tags used in the vault with their note counts, most used first. */
export function vaultTags(port: VaultPort): Array<{ tag: string; count: number }> {
  const counts = new Map<string, number>();
  for (const n of port.notes()) for (const t of port.tagsOf(n.path)) counts.set(t, (counts.get(t) ?? 0) + 1);
  return [...counts.entries()].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}
