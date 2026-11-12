import { describe, expect, it } from "vitest";
import { mergeSettings, parseFolderList } from "../src/settingsTab";
import { activeFilterCount, clampMaxNodes, suggestMatches } from "../src/toolbar";
import { statsText } from "../src/panel";
import { DEFAULT_FILTERS, DEFAULT_SETTINGS } from "../src/contract";

describe("mergeSettings", () => {
  it("returns defaults for nothing", () => {
    expect(mergeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(mergeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
  });
  it("deep merges filters over the defaults", () => {
    const m = mergeSettings({ theme: "paper", filters: { excludeFolders: ["Archive"], peopleOnly: true } });
    expect(m.theme).toBe("paper");
    expect(m.filters).toEqual({ ...DEFAULT_FILTERS, excludeFolders: ["Archive"], peopleOnly: true });
    expect(m.labelMode).toBe("auto");
    expect(m.localDepth).toBe(2);
  });
  it("does not mutate the shared defaults", () => {
    const m = mergeSettings({ filters: { tags: ["x"] } });
    m.filters.tags.push("y");
    expect(DEFAULT_FILTERS.tags).toEqual([]);
    expect(DEFAULT_SETTINGS.filters.tags).toEqual([]);
  });
  it("falls back on malformed values", () => {
    const m = mergeSettings({ theme: "neon", labelMode: 3, localDepth: 9, filters: { folders: "x", maxNodes: -4, showOrphans: "yes" } });
    expect(m).toEqual(DEFAULT_SETTINGS);
  });
  it("keeps valid depth, label mode and max nodes", () => {
    const m = mergeSettings({ labelMode: "never", localDepth: 3, filters: { maxNodes: 1200.4 } });
    expect(m.labelMode).toBe("never");
    expect(m.localDepth).toBe(3);
    expect(m.filters.maxNodes).toBe(1200);
  });
  it("keeps folded overview sections and drops junk", () => {
    expect(mergeSettings({ foldedSections: ["mostLinked", 3, "", " constellations "] }).foldedSections).toEqual(["mostLinked", "constellations"]);
    expect(mergeSettings({ foldedSections: "mostLinked" }).foldedSections).toEqual([]);
  });
});

describe("shell helpers", () => {
  it("parses folder lists", () => {
    expect(parseFolderList("Archive, /Templates/ ,\nDaily/Old\n\n")).toEqual(["Archive", "Templates", "Daily/Old"]);
  });
  it("counts active filters", () => {
    expect(activeFilterCount(DEFAULT_FILTERS)).toBe(0);
    expect(activeFilterCount({ ...DEFAULT_FILTERS, folders: ["a"], tags: ["x", "y"], showOrphans: true, maxNodes: 100 })).toBe(5);
  });
  it("clamps max nodes", () => {
    expect(clampMaxNodes(5)).toBe(50);
    expect(clampMaxNodes(99999)).toBe(20000);
    expect(clampMaxNodes(NaN)).toBe(4000);
  });
  it("suggests matches, prefix first, skipping chosen", () => {
    const all = ["Projects", "Archive/Projects", "People"].map((value) => ({ value }));
    expect(suggestMatches(all, ["People"], "proj").map((s) => s.value)).toEqual(["Projects", "Archive/Projects"]);
    expect(suggestMatches(all, [], "#pe").map((s) => s.value)).toEqual(["People"]);
  });
  it("formats stats and the truncated notice", () => {
    const g = { nodes: new Array(4000).fill(0).map((_, i) => ({ id: String(i) })) as any, edges: [], truncated: true, totalNotes: 5120 };
    const t = statsText({ nodes: 4000, edges: 9876, clusters: [] }, g, false);
    expect(t.main).toBe("4,000 notes, 9,876 links");
    expect(t.notice).toBe("Showing the 4,000 best connected of 5,120 notes");
    expect(statsText({ nodes: 1, edges: 0, clusters: [] }, { ...g, truncated: false }, true).main).toBe("Nearby: 1 note, 0 links");
    const one = statsText({ nodes: 42, edges: 60, clusters: [], constellation: "Projects" }, g, false);
    expect(one.main).toBe("In Projects: 42 notes, 60 links");
    expect(one.notice).toBe("");
  });
});
