import { describe, expect, it } from "vitest";
import { TFile } from "obsidian";
import { cleanAvatarTarget, makeAvatarResolver, makeVaultPort, parseTagsValue, tagsFromCache, vaultFolders, vaultTags } from "../src/vaultPort";

function fakeApp(files: Array<{ path: string; cache?: any }>, extra: { dest?: Record<string, string> } = {}) {
  const tfiles = files.map((f) => new (TFile as any)(f.path, 1000));
  const byPath = new Map(tfiles.map((f) => [f.path, f]));
  const caches = new Map(files.map((f) => [f.path, f.cache]));
  return {
    vault: {
      getMarkdownFiles: () => tfiles.filter((f) => f.extension === "md"),
      getAbstractFileByPath: (p: string) => byPath.get(p) ?? null,
      getResourcePath: (f: TFile) => "app://local/" + f.path,
    },
    metadataCache: {
      resolvedLinks: { "a.md": { "b.md": 1 } },
      getFileCache: (f: TFile) => caches.get(f.path) ?? null,
      getFirstLinkpathDest: (name: string) => {
        const p = extra.dest?.[name];
        return p ? byPath.get(p) ?? null : null;
      },
    },
  } as any;
}

describe("parseTagsValue", () => {
  it("handles arrays, comma strings, space strings and hashes", () => {
    expect(parseTagsValue(["#a", "b/c"])).toEqual(["a", "b/c"]);
    expect(parseTagsValue("a, #b ,c")).toEqual(["a", "b", "c"]);
    expect(parseTagsValue("people friends")).toEqual(["people", "friends"]);
    expect(parseTagsValue(null)).toEqual([]);
    expect(parseTagsValue(42)).toEqual([]);
    expect(parseTagsValue(["", "  ", 5])).toEqual([]);
  });
});

describe("tagsFromCache", () => {
  it("merges frontmatter and inline tags without duplicates", () => {
    const cache = { frontmatter: { tags: "x, y" }, tags: [{ tag: "#y" }, { tag: "#z/deep" }] };
    expect(tagsFromCache(cache as any).sort()).toEqual(["x", "y", "z/deep"]);
  });
  it("accepts the singular tag key and a missing cache", () => {
    expect(tagsFromCache({ frontmatter: { tag: ["solo"] } } as any)).toEqual(["solo"]);
    expect(tagsFromCache(null)).toEqual([]);
  });
});

describe("makeVaultPort", () => {
  const app = fakeApp([
    { path: "Notes/a.md", cache: { frontmatter: { tags: ["p"], avatar: "me.png", position: { start: 0 } }, tags: [{ tag: "#inline" }] } },
    { path: "b.md" },
    { path: "img/me.png" },
  ]);
  const port = makeVaultPort(app);
  it("lists markdown notes only", () => {
    expect(port.notes().map((n) => n.path)).toEqual(["Notes/a.md", "b.md"]);
    expect(port.notes()[0]).toMatchObject({ basename: "a", mtime: 1000 });
  });
  it("exposes resolved links", () => {
    expect(port.links()).toEqual({ "a.md": { "b.md": 1 } });
  });
  it("reads tags and frontmatter from the cache", () => {
    expect(port.tagsOf("Notes/a.md").sort()).toEqual(["inline", "p"]);
    expect(port.tagsOf("missing.md")).toEqual([]);
    expect(port.frontmatter("Notes/a.md")).toEqual({ tags: ["p"], avatar: "me.png" });
    expect(port.frontmatter("b.md")).toBeNull();
  });
  it("derives folders and tags for suggestions", () => {
    expect(vaultFolders(port)).toEqual(["Notes"]);
    expect(vaultTags(port).map((t) => t.tag).sort()).toEqual(["inline", "p"]);
  });
});

describe("makeAvatarResolver", () => {
  const app = fakeApp([{ path: "Assets/me.png" }, { path: "Assets/doc.pdf" }, { path: "n.md" }], { dest: { "me.png": "Assets/me.png", "doc.pdf": "Assets/doc.pdf" } });
  const resolve = makeAvatarResolver(app);
  it("resolves a vault path directly", () => {
    expect(resolve("Assets/me.png")).toBe("app://local/Assets/me.png");
  });
  it("falls back to the link resolver for bare names and wikilinks", () => {
    expect(resolve("me.png")).toBe("app://local/Assets/me.png");
    expect(resolve("![[me.png|small]]")).toBe("app://local/Assets/me.png");
  });
  it("returns undefined when missing or not an image", () => {
    expect(resolve("nope.png")).toBeUndefined();
    expect(resolve("doc.pdf")).toBeUndefined();
    expect(resolve("n.md")).toBeUndefined();
    expect(resolve("")).toBeUndefined();
  });
  it("cleans wikilink syntax", () => {
    expect(cleanAvatarTarget("[[a/b.png|x]]")).toBe("a/b.png");
  });
});
