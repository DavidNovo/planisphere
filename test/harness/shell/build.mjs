// Bundles the REAL view/panel/toolbar with a stub obsidian, a fake engine and a fake buildGraph.
import esbuild from "esbuild";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../..");
const out = path.join(here, "out");
fs.mkdirSync(out, { recursive: true });
const swap = {
  name: "swap-engine-model",
  setup(b) {
    b.onResolve({ filter: /^\.\/(engine|model)$/ }, (a) => (a.importer.includes(path.join(root, "src")) ? { path: path.join(here, a.path === "./engine" ? "fakeEngine.ts" : "fakeModel.ts") } : undefined));
  },
};
const res = await esbuild.build({
  entryPoints: [path.join(here, "entry.ts")], bundle: true, write: false, format: "iife", target: "es2020", logLevel: "warning",
  alias: { obsidian: path.join(root, "test/stubs/obsidian.ts") }, plugins: [swap],
});
const js = res.outputFiles[0].text.replace(/<\/script/g, "<\\/script");
const css = fs.readFileSync(path.join(root, "css/shell.css"), "utf8");
const html = `<!doctype html><html><head><meta charset="utf-8"><title>Planisphere shell harness</title>
<style>
body{margin:0;height:100vh;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Roboto,sans-serif;--font-interface:-apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Roboto,sans-serif}
body.theme-dark{--background-primary:#1e1e1e;--background-secondary:#262626;--background-modifier-form-field:#1a1a1a;--text-normal:#dadada;--text-muted:#a3a3a3;--text-faint:#6f6f6f;--background-modifier-border:#363636;--background-modifier-border-hover:#4a4a4a;--background-modifier-hover:rgba(255,255,255,.07);--interactive-accent:#7b6cd9;--text-accent:#a99cf5;--text-on-accent:#fff;--color-yellow:#e0ac00;color-scheme:dark}
body.theme-light{--background-primary:#fff;--background-secondary:#f6f6f6;--background-modifier-form-field:#fff;--text-normal:#222;--text-muted:#5c5c5c;--text-faint:#9a9a9a;--background-modifier-border:#e0e0e0;--background-modifier-border-hover:#c8c8c8;--background-modifier-hover:rgba(0,0,0,.05);--interactive-accent:#705dcf;--text-accent:#705dcf;--text-on-accent:#fff;--color-yellow:#c28a00;color-scheme:light}
.mock{display:flex;flex-direction:column;height:100vh;background:var(--background-secondary);color:var(--text-normal)}
.mock-tabs{height:40px;flex:none;border-bottom:1px solid var(--background-modifier-border);display:flex;align-items:flex-end;padding:0 8px;font-size:12.5px;color:var(--text-muted)}
.mock-tab{height:32px;display:flex;align-items:center;padding:0 14px;border-radius:7px 7px 0 0;background:var(--background-primary);color:var(--text-normal);box-shadow:0 0 0 1px var(--background-modifier-border)}
#host{flex:1;min-height:0;display:flex}#host>div{flex:1;min-width:0;display:flex;flex-direction:column}
.view-content{flex:1;min-height:0}
button.mod-cta{background:var(--interactive-accent);color:var(--text-on-accent);border:0;border-radius:6px;padding:8px 14px;font:inherit;font-weight:500}
input[type=number],input[type=text]{background:var(--background-modifier-form-field);color:var(--text-normal);border:1px solid var(--background-modifier-border);border-radius:5px;font:inherit}
.clickable-icon{background:none;border:0}
${css}
</style></head><body><div class="mock"><div class="mock-tabs"><div class="mock-tab">Planisphere</div></div><div id="host"></div></div>
<script>${js}</script></body></html>`;
fs.writeFileSync(path.join(out, "harness.html"), html);
console.log("wrote harness.html", (html.length / 1024).toFixed(0) + " KB");
