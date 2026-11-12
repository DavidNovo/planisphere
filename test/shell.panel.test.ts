import { describe, expect, it } from "vitest";
import { cleanExcerpt, folderCrumbs, initialsOf, linkLists, mentionsLine, mostLinked, relativeEdited } from "../src/panel";
import type { NoteNode } from "../src/contract";

const NOW = Date.UTC(2026, 10, 10, 12, 0, 0);
const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;

describe("relativeEdited", () => {
  it("covers each range", () => {
    expect(relativeEdited(NOW - 10_000, NOW)).toBe("Edited just now");
    expect(relativeEdited(NOW - 5 * MIN, NOW)).toBe("Edited 5 minutes ago");
    expect(relativeEdited(NOW - MIN, NOW)).toBe("Edited 1 minute ago");
    expect(relativeEdited(NOW - 3 * HOUR, NOW)).toBe("Edited 3 hours ago");
    expect(relativeEdited(NOW - 1 * DAY - HOUR, NOW)).toBe("Edited yesterday");
    expect(relativeEdited(NOW - 3 * DAY, NOW)).toBe("Edited 3 days ago");
    expect(relativeEdited(NOW - 65 * DAY, NOW)).toBe("Edited 2 months ago");
    expect(relativeEdited(NOW - 800 * DAY, NOW)).toBe("Edited 2 years ago");
  });
  it("is empty for unknown times and tolerates future times", () => {
    expect(relativeEdited(0, NOW)).toBe("");
    expect(relativeEdited(NOW + DAY, NOW)).toBe("Edited just now");
  });
});

describe("cleanExcerpt", () => {
  it("strips frontmatter, headings, links, emphasis and code", () => {
    const raw = `---\ntitle: x\ntags: [a]\n---\n# Heading\n\nSome **bold** and *italic* text with a [[Target|alias]] and [[Plain Link]] and [site](https://x.y).\n\n\`\`\`js\nconst a = 1;\n\`\`\`\n- [ ] a task\n> quoted ![[pic.png]] done`;
    expect(cleanExcerpt(raw)).toBe("Some bold and italic text with a alias and Plain Link and site. a task quoted done");
  });
  it("skips a leading H1 but keeps lone headings and later headings", () => {
    expect(cleanExcerpt("# Title\nbody\n## Part\nmore")).toBe("body Part more");
    expect(cleanExcerpt("# Only title")).toBe("Only title");
  });
  it("removes comments, callout markers and table rules", () => {
    const raw = "<!-- hidden -->\n> [!note] Title\n> body\n| a | b |\n|---|---|\n| 1 | 2 |\n%%secret%%";
    expect(cleanExcerpt(raw)).toBe("Title body a b 1 2");
  });
  it("cuts long text on a word boundary with an ellipsis", () => {
    const raw = "word ".repeat(200);
    const out = cleanExcerpt(raw, 280);
    expect(out.length).toBeLessThanOrEqual(281);
    expect(out.endsWith("…")).toBe(true);
    expect(out).not.toContain("  ");
  });
  it("returns empty for frontmatter-only notes", () => {
    expect(cleanExcerpt("---\na: 1\n---\n")).toBe("");
    expect(cleanExcerpt("")).toBe("");
  });
});

describe("linkLists", () => {
  const links = {
    "A.md": { "B.md": 1, "C.md": 2, "img.png": 1, "A.md": 1 },
    "B.md": { "A.md": 1 },
    "C.md": {},
    "D.md": { "A.md": 3 },
    "Z.md": { "A.md": 1 },
  };
  const known = (p: string) => p !== "Z.md" && p.endsWith(".md");
  it("lists outgoing and incoming notes that are in the graph, sorted, without self", () => {
    const r = linkLists(links, "A.md", known);
    expect(r.to.map((x) => x.id)).toEqual(["B.md", "C.md"]);
    expect(r.from.map((x) => x.id)).toEqual(["B.md", "D.md"]);
    expect(r.to[0].title).toBe("B");
  });
  it("uses a title lookup when given", () => {
    const r = linkLists(links, "A.md", known, (p) => p.toLowerCase());
    expect(r.from[0].title).toBe("b.md");
  });
  it("handles notes with no entry", () => {
    expect(linkLists(links, "Nope.md", known)).toEqual({ to: [], from: [] });
  });
});

describe("small display helpers", () => {
  const node = (id: string, i: number, o: number): NoteNode => ({ id, title: id, folder: "", tags: [], inDegree: i, outDegree: o, isPerson: false, mentions: 0, mtime: 0 });
  it("ranks most linked notes", () => {
    const r = mostLinked([node("a", 1, 1), node("b", 5, 0), node("c", 0, 0), node("d", 1, 1)], 3).map((n) => n.id);
    expect(r).toEqual(["b", "a", "d"]);
  });
  it("splits folder crumbs", () => {
    expect(folderCrumbs("Projects/Active")).toEqual(["Projects", "Active"]);
    expect(folderCrumbs("")).toEqual([]);
  });
  it("builds initials and mention lines", () => {
    expect(initialsOf("Ada Lovelace")).toBe("AL");
    expect(initialsOf("kaspar")).toBe("KA");
    expect(initialsOf("")).toBe("?");
    expect(mentionsLine(0)).toBe("");
    expect(mentionsLine(1)).toBe("Written about 1 time");
    expect(mentionsLine(7)).toBe("Written about 7 times");
  });
});
