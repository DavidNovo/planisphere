// Tiny in-memory vault used by the tests.
import type { VaultPort } from "../src/contract";

export interface FakeNote {
  path: string;
  tags?: string[];
  fm?: Record<string, unknown> | null;
  links?: string[];
  mtime?: number;
}

export function fakePort(notes: FakeNote[], extraLinks: Record<string, string[]> = {}): VaultPort {
  const byPath = new Map(notes.map((n) => [n.path, n]));
  return {
    notes: () =>
      notes.map((n) => ({ path: n.path, basename: n.path.split("/").pop()!.replace(/\.md$/, ""), mtime: n.mtime ?? 1000 })),
    links: () => {
      const out: Record<string, Record<string, number>> = {};
      for (const n of notes) {
        const targets = [...(n.links || []), ...(extraLinks[n.path] || [])];
        if (!targets.length) continue;
        out[n.path] = {};
        for (const t of targets) out[n.path][t] = (out[n.path][t] || 0) + 1;
      }
      return out;
    },
    tagsOf: (p) => byPath.get(p)?.tags ?? [],
    frontmatter: (p) => byPath.get(p)?.fm ?? null,
  };
}

/** Deterministic pseudo-random numbers for building big fake vaults. */
export function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}
