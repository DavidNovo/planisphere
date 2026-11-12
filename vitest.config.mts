import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: { alias: { obsidian: path.resolve(import.meta.dirname, "test/stubs/obsidian.ts") } },
  test: { include: ["test/**/*.test.ts"] },
});
