// benchmark.js — Test combinations of build optimisations and report gzip sizes
// Usage: bun benchmark.js
import { gzipSync, constants } from "zlib";
import { minify } from "html-minifier-terser";

// ── Class/ID renaming helpers (copied from build.js) ─────────────────────────

function* shortNamesGen() {
  const alpha = "abcdefghijklmnopqrstuvwxyz";
  for (const c of alpha) yield c;
  for (let i = 0; i < alpha.length; i++)
    for (let j = 0; j < alpha.length; j++)
      yield alpha[i] + alpha[j];
}

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
    css = css.replace(new RegExp(`\\.${escaped}(?![a-zA-Z0-9_-])`, "g"), `.${short}`);
  }
  for (const [name, short] of Object.entries(idMap)) {
    const escaped = name.replace(/[-]/g, "\\-");
    css = css.replace(new RegExp(`#${escaped}(?![a-zA-Z0-9_-])`, "g"), `#${short}`);
  }
  return css;
}

function renameJs(js, map) {
  return js.replace(/(['"])((?:(?!\1)[^\\]|\\.)*)\1/g, (_, quote, inner) => {
    let renamed = inner;
    for (const [name, short] of Object.entries(map)) {
      const escaped = name.replace(/[-]/g, "\\-");
      renamed = renamed.replace(
        new RegExp(`(?<![a-zA-Z0-9_-])${escaped}(?![a-zA-Z0-9_-])`, "g"), short);
    }
    return quote + renamed + quote;
  });
}

function renameClasses(html) {
  const gen = shortNamesGen();
  const classMap = Object.fromEntries(CLASS_NAMES.map(n => [n, gen.next().value]));
  const idGen = shortNamesGen();
  const idMap = Object.fromEntries(ID_NAMES.map(n => [n, idGen.next().value]));
  const combinedMap = { ...classMap, ...idMap };

  html = html.replace(/(<style>)([\s\S]*?)(<\/style>)/,
    (_, o, css, c) => o + renameCss(css, classMap, idMap) + c);
  html = html.replace(/(<script>)([\s\S]*?)(<\/script>)/,
    (_, o, js, c) => o + renameJs(js, combinedMap) + c);
  html = html.replace(/\bclass="([^"]*)"/g, (_, v) =>
    `class="${v.split(" ").map(t => classMap[t] ?? t).join(" ")}"`);
  html = html.replace(/\bid="([^"]*)"/g, (_, v) =>
    `id="${idMap[v] ?? v}"`);
  return html;
}

// ── Bundle step (always applied) ─────────────────────────────────────────────

const SCRIPT_BLOCK_RE =
  /<script src="attoplot\.js"><\/script>\s*<script>[\s\S]*?<\/script>/;

async function bundle(attoSource, html, inlineJS, bunMinify) {
  const combinedJS = attoSource + "\n" + inlineJS;
  let js;
  if (bunMinify) {
    const transpiler = new Bun.Transpiler({
      target: "browser",
      minifyWhitespace: true,
      minifyIdentifiers: true,
      minifySyntax: true,
    });
    js = transpiler.transformSync(combinedJS);
    js = js.replace(/\s*export\s*\{\s*\}\s*;?\s*$/, "");
  } else {
    js = combinedJS;
  }
  return html.replace(SCRIPT_BLOCK_RE, `<script>${js}</script>`);
}

// ── Run a single variant ──────────────────────────────────────────────────────

async function runVariant(attoSource, html, inlineJS, { bunMinify, rename, terserJS }) {
  let out = await bundle(attoSource, html, inlineJS, bunMinify);
  if (rename) out = renameClasses(out);
  out = await minify(out, {
    collapseWhitespace: true,
    removeComments: true,
    minifyCSS: true,
    minifyJS: terserJS,
  });
  const buf = Buffer.from(out);
  const gz1 = gzipSync(buf, { level: 1 });
  const gz9 = gzipSync(buf, { level: constants.Z_BEST_COMPRESSION });
  return { raw: buf.length, gz1: gz1.length, gz9: gz9.length };
}

// ── Main ──────────────────────────────────────────────────────────────────────

const attoSource = await Bun.file("attoplot.js").text();
const html       = await Bun.file("index.html").text();
const match      = html.match(
  /<script src="attoplot\.js"><\/script>\s*<script>([\s\S]*?)<\/script>/);
if (!match) throw new Error("Could not locate script blocks in index.html");
const inlineJS = match[1];

const variants = [
  { bunMinify: false, rename: false, terserJS: false, label: "bundle only (baseline)" },
  { bunMinify: true,  rename: false, terserJS: false, label: "bun JS" },
  { bunMinify: false, rename: false, terserJS: true,  label: "terser JS" },
  { bunMinify: true,  rename: false, terserJS: true,  label: "bun JS + terser JS" },
  { bunMinify: false, rename: true,  terserJS: false, label: "rename only" },
  { bunMinify: true,  rename: true,  terserJS: false, label: "bun JS + rename" },
  { bunMinify: false, rename: true,  terserJS: true,  label: "rename + terser JS" },
  { bunMinify: true,  rename: true,  terserJS: true,  label: "bun JS + rename + terser JS  ← current" },
];

const kb = n => (n / 1024).toFixed(1).padStart(6);
const kbMd = n => (n / 1024).toFixed(1);

// Run all variants first so we can compute reduction % relative to baseline
const results = [];
for (const v of variants) {
  results.push({ v, r: await runVariant(attoSource, html, inlineJS, v) });
}
const baselineGz9 = results[0].r.gz9;
const sourceBytes = (await Bun.file("attoplot.js").stat()).size
                  + (await Bun.file("index.html").stat()).size;
const pctOf = base => n => ((1 - n / base) * 100).toFixed(1) + "%";
const vsBaseline = pctOf(baselineGz9);
const vsSource   = pctOf(sourceBytes);

console.log("");
console.log("bun  rename terser  raw(KB)  gz1(KB)  gz9(KB)  vs baseline  vs source  label");
console.log("─".repeat(100));

const mdRows = [];
for (const { v, r } of results) {
  const flags = [
    (v.bunMinify ? "on " : "off").padEnd(5),
    (v.rename    ? "on " : "off").padEnd(7),
    (v.terserJS  ? "on " : "off").padEnd(8),
  ].join(" ");
  console.log(`${flags}${kb(r.raw)}   ${kb(r.gz1)}   ${kb(r.gz9)}   ${vsBaseline(r.gz9).padStart(7)}      ${vsSource(r.gz9).padStart(7)}    ${v.label}`);
  mdRows.push(
    `| ${v.bunMinify ? "on" : "off"} | ${v.rename ? "on" : "off"} | ${v.terserJS ? "on" : "off"} | ${kbMd(r.raw)} | ${kbMd(r.gz1)} | ${kbMd(r.gz9)} | ${vsBaseline(r.gz9)} | ${vsSource(r.gz9)} | ${v.label} |`
  );
}

console.log("");

const md = [
  "# Benchmark Results",
  "",
  `Source: \`index.html\` + \`attoplot.js\` = ${(sourceBytes / 1024).toFixed(1)} KB (unbuilt, 2 files)`,
  "",
  "**raw** — uncompressed size of the bundled HTML after `html-minifier-terser` (whitespace/comment/CSS stripping always applied), plus any flagged steps (bun JS, rename, terser JS). Before gzip.",
  "",
  "| bun | rename | terser | raw (KB) | gz1 (KB) | gz9 (KB) | vs baseline | vs source | notes |",
  "|-----|--------|--------|----------|----------|----------|-------------|-----------|-------|",
  ...mdRows,
  "",
].join("\n");

await Bun.write("benchmark-results.md", md);
console.log("benchmark-results.md written");
