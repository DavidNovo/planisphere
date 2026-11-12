import { describe, expect, it } from "vitest";
import { DEFAULT_FILTERS } from "../src/contract";
import { buildGraph, egoNetwork, normalizeAvatar, subgraphOf } from "../src/model";
import { fakePort, lcg, type FakeNote } from "./fakes";

const F = (over: Partial<typeof DEFAULT_FILTERS> = {}) => ({ ...DEFAULT_FILTERS, showOrphans: true, ...over });
const ids = (g: ReturnType<typeof buildGraph>) => g.nodes.map((n) => n.id);

describe("buildGraph basics", () => {
  const notes: FakeNote[] = [
    { path: "b.md", links: ["a.md", "a.md", "b.md", "img.png", "ghost.md"] },
    { path: "a.md", links: ["c.md"] },
    { path: "c.md" },
    { path: "lonely.md" },
  ];

  it("keeps only markdown notes, drops self links, duplicates, non-markdown and unknown targets", () => {
    const g = buildGraph(fakePort(notes), F());
    expect(g.totalNotes).toBe(4);
    expect(g.edges).toEqual([
      { from: "a.md", to: "c.md" },
      { from: "b.md", to: "a.md" },
    ]);
  });

  it("computes in and out degree", () => {
    const g = buildGraph(fakePort(notes), F());
    const by = Object.fromEntries(g.nodes.map((n) => [n.id, n]));
    expect(by["a.md"].inDegree).toBe(1);
    expect(by["a.md"].outDegree).toBe(1);
    expect(by["b.md"].outDegree).toBe(1);
    expect(by["c.md"].inDegree).toBe(1);
    expect(by["lonely.md"].inDegree + by["lonely.md"].outDegree).toBe(0);
  });

  it("fills title, folder, tags without hash, mtime", () => {
    const g = buildGraph(fakePort([{ path: "Projects/Kith.md", tags: ["#dev", "dev", "Idea"], mtime: 42 }]), F());
    expect(g.nodes[0]).toMatchObject({ id: "Projects/Kith.md", title: "Kith", folder: "Projects", tags: ["dev", "Idea"], mtime: 42 });
    const root = buildGraph(fakePort([{ path: "Root.md" }]), F());
    expect(root.nodes[0].folder).toBe("");
  });

  it("hides orphans unless showOrphans", () => {
    expect(ids(buildGraph(fakePort(notes), F({ showOrphans: false })))).toEqual(["a.md", "b.md", "c.md"]);
    expect(ids(buildGraph(fakePort(notes), F({ showOrphans: true })))).toContain("lonely.md");
  });

  it("is sorted by id and deterministic", () => {
    const shuffled = [...notes].reverse();
    const g1 = buildGraph(fakePort(notes), F());
    const g2 = buildGraph(fakePort(shuffled), F());
    expect(ids(g1)).toEqual([...ids(g1)].sort());
    expect(JSON.stringify(g1)).toBe(JSON.stringify(g2));
  });

  it("an empty vault gives an empty graph", () => {
    const g = buildGraph(fakePort([]), F());
    expect(g).toEqual({ nodes: [], edges: [], truncated: false, totalNotes: 0 });
  });
});

describe("filters", () => {
  const notes: FakeNote[] = [
    { path: "People/Ada.md", tags: ["people"], links: ["Projects/Engine.md"] },
    { path: "People2/Bob.md", links: ["People/Ada.md"] },
    { path: "People/Sub/Cy.md", links: ["People/Ada.md"] },
    { path: "Projects/Engine.md", tags: ["Dev", "dev/core"], links: ["Reading/Book.md"] },
    { path: "Reading/Book.md", tags: ["reading"], links: ["Projects/Engine.md"] },
    { path: "Journal/2025-01-01.md", links: ["People/Ada.md", "Projects/Engine.md"] },
  ];
  const go = (over: Partial<typeof DEFAULT_FILTERS>) => ids(buildGraph(fakePort(notes), F(over)));

  it("folders match on whole path segments", () => {
    expect(go({ folders: ["People"] })).toEqual(["People/Ada.md", "People/Sub/Cy.md"]);
    expect(go({ folders: ["People/"] })).toEqual(["People/Ada.md", "People/Sub/Cy.md"]);
    expect(go({ folders: ["/People/Sub"] })).toEqual(["People/Sub/Cy.md"]);
    expect(go({ folders: ["Peop"] })).toEqual([]);
    expect(go({ folders: ["People2"] })).toEqual(["People2/Bob.md"]);
  });

  it("several include folders are a union", () => {
    expect(go({ folders: ["Reading", "Journal"] })).toEqual(["Journal/2025-01-01.md", "Reading/Book.md"]);
  });

  it("excludeFolders drops prefixes but not look-alikes", () => {
    const r = go({ excludeFolders: ["People"] });
    expect(r).not.toContain("People/Ada.md");
    expect(r).not.toContain("People/Sub/Cy.md");
    expect(r).toContain("People2/Bob.md");
  });

  it("edges to filtered-out notes are dropped and degrees recomputed", () => {
    const g = buildGraph(fakePort(notes), F({ excludeFolders: ["Projects"] }));
    expect(g.edges.every((e) => !e.from.startsWith("Projects") && !e.to.startsWith("Projects"))).toBe(true);
    const ada = g.nodes.find((n) => n.id === "People/Ada.md")!;
    expect(ada.outDegree).toBe(0);
    expect(ada.inDegree).toBe(3);
  });

  it("tags match any, case-insensitively, without '#', including nested children", () => {
    expect(go({ tags: ["#DEV"] })).toEqual(["Projects/Engine.md"]);
    expect(go({ tags: ["reading", "people"] })).toEqual(["People/Ada.md", "Reading/Book.md"]);
    expect(go({ tags: ["dev/core"] })).toEqual(["Projects/Engine.md"]);
    expect(go({ tags: ["nothing"] })).toEqual([]);
  });

  it("query matches title or path, case-insensitively", () => {
    expect(go({ query: "engine" })).toEqual(["Projects/Engine.md"]);
    expect(go({ query: "JOURNAL/" })).toEqual(["Journal/2025-01-01.md"]);
    expect(go({ query: "  ada " })).toEqual(["People/Ada.md"]);
  });

  it("peopleOnly keeps only people", () => {
    expect(go({ peopleOnly: true })).toEqual(["People/Ada.md"]);
  });

  it("peopleOnly shows unlinked people even when orphans are hidden", () => {
    const vault = [
      { path: "People/Bluesky.md", tags: ["people"], fm: { avatar: "People/_avatars/bsky.app.jpg", handle: "@bsky.app" }, links: ["People/_avatars/bsky.app.jpg"] },
      { path: "People/EFF.md", fm: { did: "did:plc:x" } },
      { path: "Notes/Loner.md" },
      { path: "Notes/A.md", links: ["Notes/B.md"] },
      { path: "Notes/B.md" },
    ];
    const hide = (over: Partial<typeof DEFAULT_FILTERS>) => ids(buildGraph(fakePort(vault), { ...DEFAULT_FILTERS, showOrphans: false, ...over }));
    expect(hide({ peopleOnly: true })).toEqual(["People/Bluesky.md", "People/EFF.md"]);
    expect(hide({})).toEqual(["Notes/A.md", "Notes/B.md"]);
  });

  it("filters combine", () => {
    expect(go({ folders: ["People"], query: "cy" })).toEqual(["People/Sub/Cy.md"]);
  });
});

describe("avatar normalisation and isPerson", () => {
  it("normalises every supported spelling", () => {
    expect(normalizeAvatar("People/_avatars/ada.jpg")).toBe("People/_avatars/ada.jpg");
    expect(normalizeAvatar("ada.jpg")).toBe("ada.jpg");
    expect(normalizeAvatar("[[ada.jpg]]")).toBe("ada.jpg");
    expect(normalizeAvatar("![[ada.jpg|96]]")).toBe("ada.jpg");
    expect(normalizeAvatar("  ![[Faces/ada one.jpg|96x96]] ")).toBe("Faces/ada one.jpg");
    expect(normalizeAvatar("![alt](faces/ada%20one.png)")).toBe("faces/ada one.png");
    expect(normalizeAvatar([["ada.jpg"]])).toBe("ada.jpg"); // unquoted [[x]] in YAML
    expect(normalizeAvatar("https://example.com/a.png")).toBe("https://example.com/a.png");
    expect(normalizeAvatar("")).toBeUndefined();
    expect(normalizeAvatar("[[ ]]")).toBeUndefined();
    expect(normalizeAvatar(42)).toBeUndefined();
    expect(normalizeAvatar(null)).toBeUndefined();
  });

  const personOf = (n: FakeNote) => buildGraph(fakePort([n]), F()).nodes[0];

  it("avatar, people/person tag, did, handle and identities make a person", () => {
    expect(personOf({ path: "a.md", fm: { avatar: "![[x.jpg|96]]" } })).toMatchObject({ isPerson: true, avatarPath: "x.jpg" });
    expect(personOf({ path: "a.md", tags: ["people"] }).isPerson).toBe(true);
    expect(personOf({ path: "a.md", tags: ["#Person"] }).isPerson).toBe(true);
    expect(personOf({ path: "a.md", tags: ["people/friends"] }).isPerson).toBe(true);
    expect(personOf({ path: "a.md", fm: { did: "did:plc:abc" } }).isPerson).toBe(true);
    expect(personOf({ path: "a.md", fm: { handle: "ada.bsky.social" } }).isPerson).toBe(true);
    expect(personOf({ path: "a.md", fm: { identities: [{ network: "bluesky" }] } }).isPerson).toBe(true);
  });

  it("ordinary notes are not people", () => {
    expect(personOf({ path: "a.md", tags: ["peoplemover"], fm: { title: "x", handle: "", identities: [] } }).isPerson).toBe(false);
    const n = personOf({ path: "a.md" });
    expect(n.isPerson).toBe(false);
    expect(n.avatarPath).toBeUndefined();
  });

  it("a person without a resolvable avatar still has no avatarPath", () => {
    const n = personOf({ path: "a.md", tags: ["people"] });
    expect(n.isPerson).toBe(true);
    expect(n.avatarPath).toBeUndefined();
  });
});

describe("mentions", () => {
  const notes: FakeNote[] = [
    { path: "People/Ada.md", tags: ["people"] },
    { path: "People/Bob.md", tags: ["people"], links: ["People/Ada.md"] },
    { path: "Journal/1.md", links: ["People/Ada.md", "People/Bob.md"] },
    { path: "Journal/2.md", links: ["People/Ada.md"] },
    { path: "Notes/x.md", links: ["Notes/y.md"] },
    { path: "Notes/y.md" },
  ];
  it("counts inbound links from non-person notes only", () => {
    const g = buildGraph(fakePort(notes), F());
    const by = Object.fromEntries(g.nodes.map((n) => [n.id, n]));
    expect(by["People/Ada.md"].mentions).toBe(2);
    expect(by["People/Ada.md"].inDegree).toBe(3);
    expect(by["People/Bob.md"].mentions).toBe(1);
    expect(by["Notes/y.md"].mentions).toBe(0);
  });
  it("does not depend on the filters, so peopleOnly keeps the gold ring", () => {
    const g = buildGraph(fakePort(notes), F({ peopleOnly: true }));
    expect(g.nodes.map((n) => n.mentions)).toEqual([2, 1]);
  });
});

describe("orphansOnly", () => {
  const notes: FakeNote[] = [
    { path: "hub.md", links: ["a.md", "b.md"] },
    { path: "a.md", links: ["hub.md"] },
    { path: "b.md" },
    { path: "lonely.md" },
    { path: "alsoLonely.md" },
  ];
  const orphanIds = (over: Partial<typeof DEFAULT_FILTERS> = {}) =>
    ids(buildGraph(fakePort(notes), F({ orphansOnly: true, ...over })));

  it("keeps only notes with no links in or out", () => {
    expect(orphanIds()).toEqual(["alsoLonely.md", "lonely.md"]);
  });

  it("returns an empty graph when every note is connected", () => {
    const g = buildGraph(fakePort([{ path: "a.md", links: ["b.md"] }, { path: "b.md" }]), F({ orphansOnly: true }));
    expect(ids(g)).toEqual([]);
    expect(g.edges).toEqual([]);
  });

  it("applies folder filtering first, then keeps only that folder's orphans", () => {
    const mixed = fakePort([
      { path: "Sub/loner.md" },
      { path: "Sub/a.md", links: ["Sub/b.md"] },
      { path: "Sub/b.md" },
    ]);
    expect(ids(buildGraph(mixed, F({ folders: ["Sub"], orphansOnly: true })))).toEqual(["Sub/loner.md"]);
  });
});

describe("looseOnly", () => {
  const notes: FakeNote[] = [
    { path: "Lone.md" },
    { path: "Tagged.md", tags: ["idea"] },
    { path: "Sub/InFolder.md" },
    { path: "Sub/Tagged.md", tags: ["x"] },
  ];
  const go = (over: Partial<typeof DEFAULT_FILTERS> = {}) =>
    ids(buildGraph(fakePort(notes), F({ looseOnly: true, ...over })));

  it("keeps only root-level notes with no tags", () => {
    expect(go()).toEqual(["Lone.md"]);
  });

  it("excludes root notes that have any tag", () => {
    expect(go({ query: "tag" })).toEqual([]); // the only query match (Tagged.md) is tagged, so not loose
    expect(go({ query: "lone" })).toEqual(["Lone.md"]);
  });

  it("composes with a folder include to keep nothing (root notes are outside every folder)", () => {
    expect(go({ folders: ["Sub"] })).toEqual([]);
  });
});

describe("truncation", () => {
  it("keeps the highest-degree nodes and says so", () => {
    const notes: FakeNote[] = [{ path: "hub.md", links: ["a.md", "b.md", "c.md", "d.md"] }, { path: "a.md" }, { path: "b.md" }, { path: "c.md", links: ["d.md"] }, { path: "d.md" }, { path: "z.md", links: ["y.md"] }, { path: "y.md" }];
    const g = buildGraph(fakePort(notes), F({ maxNodes: 3 }));
    expect(g.truncated).toBe(true);
    expect(g.nodes.length).toBe(3);
    expect(ids(g)).toContain("hub.md");
    expect(ids(g)).toContain("d.md"); // degree 2, beats the degree-1 leaves
    const set = new Set(ids(g));
    expect(g.edges.every((e) => set.has(e.from) && set.has(e.to))).toBe(true);
    expect(g.totalNotes).toBe(7);
  });
  it("is not truncated when it fits", () => {
    const g = buildGraph(fakePort([{ path: "a.md", links: ["b.md"] }, { path: "b.md" }]), F({ maxNodes: 2 }));
    expect(g.truncated).toBe(false);
  });
  it("recomputes degrees after the cut", () => {
    const notes: FakeNote[] = [{ path: "hub.md", links: ["a.md", "b.md", "c.md"] }, { path: "a.md" }, { path: "b.md" }, { path: "c.md" }];
    const g = buildGraph(fakePort(notes), F({ maxNodes: 2 }));
    const hub = g.nodes.find((n) => n.id === "hub.md")!;
    expect(hub.outDegree).toBe(1);
  });
});

describe("local mode helpers", () => {
  const notes: FakeNote[] = [{ path: "a.md", links: ["b.md"] }, { path: "b.md", links: ["c.md"] }, { path: "c.md", links: ["d.md"] }, { path: "d.md" }, { path: "e.md", links: ["a.md"] }];
  const g = buildGraph(fakePort(notes), F());
  it("egoNetwork follows links in both directions to the given depth", () => {
    expect(egoNetwork(g, "a.md", 1).sort()).toEqual(["a.md", "b.md", "e.md"]);
    expect(egoNetwork(g, "a.md", 2).sort()).toEqual(["a.md", "b.md", "c.md", "e.md"]);
    expect(egoNetwork(g, "a.md", 3).sort()).toEqual(["a.md", "b.md", "c.md", "d.md", "e.md"]);
    expect(egoNetwork(g, "nope.md", 2)).toEqual([]);
  });
  it("subgraphOf is the induced subgraph with recomputed degrees", () => {
    const sub = subgraphOf(g, ["a.md", "b.md", "c.md"]);
    expect(sub.edges).toEqual([{ from: "a.md", to: "b.md" }, { from: "b.md", to: "c.md" }]);
    expect(sub.nodes.find((n) => n.id === "c.md")!.outDegree).toBe(0);
  });
});

describe("performance", () => {
  it("builds a 10,000 note vault in under 150 ms", () => {
    const rnd = lcg(7);
    const folders = ["Projects", "Journal", "Reading", "People", "Recipes", "Ideas", "Areas", "Meetings"];
    const notes: FakeNote[] = [];
    for (let i = 0; i < 10000; i++) {
      const f = folders[i % folders.length];
      const links: string[] = [];
      const k = 1 + Math.floor(rnd() * 8);
      for (let j = 0; j < k; j++) links.push(`${folders[Math.floor(rnd() * folders.length)]}/n${Math.floor(rnd() * 10000)}.md`);
      notes.push({ path: `${f}/n${i}.md`, tags: i % 5 === 0 ? ["a", "b"] : ["c"], fm: i % 50 === 0 ? { avatar: "x.jpg" } : null, links });
    }
    const port = fakePort(notes);
    buildGraph(port, F({ maxNodes: 20000 })); // warm up
    const t0 = performance.now();
    const g = buildGraph(port, F({ maxNodes: 20000 }));
    const ms = performance.now() - t0;
    expect(g.nodes.length).toBeGreaterThan(5000);
    expect(ms).toBeLessThan(150);
  });
});
