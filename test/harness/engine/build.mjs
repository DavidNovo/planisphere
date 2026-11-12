// Bundles the real engine plus the invented vault into one HTML page.
import esbuild from "esbuild";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, "out");
fs.mkdirSync(out, { recursive: true });
const res = await esbuild.build({
  entryPoints: [path.join(here, "entry.ts")],
  bundle: true,
  write: false,
  format: "iife",
  target: "es2020",
  logLevel: "warning",
});
const js = res.outputFiles[0].text.replace(/<\/script/g, "<\\/script");
const html = `<!doctype html><html><head><meta charset="utf-8"><title>Planisphere engine harness</title>
<style>
html,body{margin:0;height:100%;overflow:hidden;background:#060918;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Roboto,sans-serif}
body.paper{background:#f1ead9}
#host{position:absolute;left:0;top:0;right:0;bottom:0}
</style></head><body><div id="host"></div>
<script>${js}</script></body></html>`;
fs.writeFileSync(path.join(out, "harness.html"), html);
console.log("wrote", path.join(out, "harness.html"), (html.length / 1024).toFixed(0) + " KB");
