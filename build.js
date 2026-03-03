// build.js — Bundle attoplot.js into index.html, minify JS, and gzip output
// Usage: bun build.js
import { mkdirSync } from "fs";
import { gzipSync, constants } from "zlib";
import { minify } from "html-minifier-terser";

// ── Class name + ID minification ─────────────────────────────────────────────

function* shortNamesGen() {
  const alpha = "abcdefghijklmnopqrstuvwxyz";
  for (const c of alpha) yield c;
  for (let i = 0; i < alpha.length; i++)
    for (let j = 0; j < alpha.length; j++)
      yield alpha[i] + alpha[j];
}

// All class names used in the project — sorted longest-first to prevent
// partial-match corruption (e.g. 'settings-panel-inner' before 'settings-panel',
// 'pp-icon-pause' before 'pp-icon', before 'btn' corrupts 'settings-btn').
const CLASS_NAMES = [
  "settings-panel-inner", "ctrl-slider-label", "ctrl-slider-val",
  "ctrl-slider-row", "pp-icon-pause", "settings-panel", "settings-input",
  "settings-unit", "playpause-btn", "device-bar-top", "kpi-value-row",
  "conn-controls", "chart-wrapper", "pp-icon-play", "voltage-card",
  "current-card", "ctrl-sliders", "settings-row", "settings-key",
  "settings-btn", "is-connected", "ap-cursor-x", "ap-cursor-y",
  "series-off", "power-card", "chart-card", "device-bar", "ctrl-card",
  "is-active", "is-paused", "kpi-label", "kpi-value", "tip-unit",
  "kpi-unit", "kpi-card", "conn-btn", "attoplot", "kpi-row", "info-row",
  "info-key", "info-val", "tip-row", "tip-dot", "tip-val", "pp-icon",
  "sidebar", "content", "active", "open", "warn", "btn",
].sort((a, b) => b.length - a.length);

// All ID values used in the project — sorted longest-first for same reason.
const ID_NAMES = [
  "chart-container", "cursor-tooltip", "conn-controls", "playpause-btn",
  "settings-panel", "settings-btn", "pause-overlay", "cfg-drawrate",
  "info-duration", "info-samples", "win-slider", "ymax-slider",
  "ymax-label", "ymax-auto", "win-label", "cfg-maxlog", "cfg-host",
  "cfg-port", "cfg-rate", "warn-row", "conn-btn", "csv-btn", "snap-btn",
  "tip-i", "tip-v", "tip-w", "val-i", "val-v", "val-w",
].sort((a, b) => b.length - a.length);

function renameCss(css, classMap, idMap) {
  for (const [name, short] of Object.entries(classMap)) {
    const escaped = name.replace(/[-]/g, "\\-");
    const re = new RegExp(`\\.${escaped}(?![a-zA-Z0-9_-])`, "g");
    css = css.replace(re, `.${short}`);
  }
  for (const [name, short] of Object.entries(idMap)) {
    const escaped = name.replace(/[-]/g, "\\-");
    const re = new RegExp(`#${escaped}(?![a-zA-Z0-9_-])`, "g");
    css = css.replace(re, `#${short}`);
  }
  return css;
}

function renameJs(js, map) {
  // Operate only inside quoted string literals so JS code is never touched.
  return js.replace(/(['"])((?:(?!\1)[^\\]|\\.)*)\1/g, (_, quote, inner) => {
    let renamed = inner;
    for (const [name, short] of Object.entries(map)) {
      const escaped = name.replace(/[-]/g, "\\-");
      // Custom class-name boundary — preserves surrounding CSS selector chars
      // like `.` in querySelector('.device-bar') and `[` in `.kpi-card[data-s]`.
      const re = new RegExp(`(?<![a-zA-Z0-9_-])${escaped}(?![a-zA-Z0-9_-])`, "g");
      renamed = renamed.replace(re, short);
    }
    return quote + renamed + quote;
  });
}

function renameClasses(html) {
  const gen = shortNamesGen();
  const classMap = Object.fromEntries(CLASS_NAMES.map(name => [name, gen.next().value]));
  // IDs use a separate generator so class and ID short names are independent
  const idGen = shortNamesGen();
  const idMap = Object.fromEntries(ID_NAMES.map(name => [name, idGen.next().value]));

  // 1. CSS selectors inside <style> (.classname and #idname)
  html = html.replace(/(<style>)([\s\S]*?)(<\/style>)/,
    (_, o, css, c) => o + renameCss(css, classMap, idMap) + c);

  // 2. String literals inside <script> (class names and #id / bare id strings)
  const combinedMap = { ...classMap, ...idMap };
  html = html.replace(/(<script>)([\s\S]*?)(<\/script>)/,
    (_, o, js, c) => o + renameJs(js, combinedMap) + c);

  // 3. HTML class="..." attribute tokens
  html = html.replace(/\bclass="([^"]*)"/g, (_, value) =>
    `class="${value.split(" ").map(t => classMap[t] ?? t).join(" ")}"`);

  // 4. HTML id="..." attribute (single token)
  html = html.replace(/\bid="([^"]*)"/g, (_, value) =>
    `id="${idMap[value] ?? value}"`);

  return html;
}

// ── Build pipeline ────────────────────────────────────────────────────────────

// 1. Read sources
const attoSource = await Bun.file("attoplot.js").text();
const html = await Bun.file("index.html").text();

// 2. Extract the inline <script> body that follows <script src="attoplot.js">
const match = html.match(
  /<script src="attoplot\.js"><\/script>\s*<script>([\s\S]*?)<\/script>/
);
if (!match) throw new Error("Could not locate script blocks in index.html");
const inlineJS = match[1];

// 3. Combine and minify JS (concat first so minifier sees full scope)
const combinedJS = attoSource + "\n" + inlineJS;

const transpiler = new Bun.Transpiler({
  target: "browser",
  minifyWhitespace: true,
  minifyIdentifiers: true,
  minifySyntax: true,
});
let minifiedJS = transpiler.transformSync(combinedJS);

// Guard: Bun.Transpiler may append "export {};" — strip if present.
minifiedJS = minifiedJS.replace(/\s*export\s*\{\s*\}\s*;?\s*$/, "");

// 4. Splice minified JS back into HTML
const SCRIPT_BLOCK_RE =
  /<script src="attoplot\.js"><\/script>\s*<script>[\s\S]*?<\/script>/;
const finalHtml = html.replace(
  SCRIPT_BLOCK_RE,
  `<script>${minifiedJS}</script>`
);

if (finalHtml === html) {
  throw new Error("Replacement had no effect — regex did not match");
}

// 4.5. Rename CSS class names to short identifiers
const renamedHtml = renameClasses(finalHtml);

// 5. Minify HTML (CSS, whitespace, remaining JS)
const minifiedHtml = await minify(renamedHtml, {
  collapseWhitespace: true,
  removeComments: true,
  minifyCSS: true,
  minifyJS: true,
});

// 6. Write dist/
mkdirSync("dist", { recursive: true });
await Bun.write("dist/index.html", minifiedHtml);
console.log(`dist/index.html      ${(minifiedHtml.length / 1024).toFixed(1)} KB`);

// 7. Gzip (level 9 = maximum compression)
const gz = gzipSync(Buffer.from(minifiedHtml), { level: constants.Z_BEST_COMPRESSION });
await Bun.write("dist/index.html.gz", gz);
console.log(`dist/index.html.gz   ${(gz.length / 1024).toFixed(1)} KB`);

// 8. Base64 of gzip
const b64 = Buffer.from(gz).toString("base64");
await Bun.write("dist/index.html.gz.b64", b64);
console.log(`dist/index.html.gz.b64  ${(b64.length / 1024).toFixed(1)} KB`);
