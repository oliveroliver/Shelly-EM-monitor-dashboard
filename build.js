// build.js — Bundle attoplot.js into index.html, minify JS, and gzip output
// Usage: bun build.js
import { mkdirSync } from "fs";
import { gzipSync, constants } from "zlib";
import { minify } from "html-minifier-terser";
import { dirname } from "path";
import { fileURLToPath } from "url";

process.chdir(dirname(fileURLToPath(import.meta.url)));

// ── Class name + ID auto-extraction and minification ────────────────────────

function* shortNamesGen() {
  const alpha = "abcdefghijklmnopqrstuvwxyz";
  for (const c of alpha) yield c;
  for (let i = 0; i < alpha.length; i++)
    for (let j = 0; j < alpha.length; j++)
      yield alpha[i] + alpha[j];
}

// Extract all CSS class names from HTML (attributes, CSS selectors, JS refs)
// and attoplot.js source. Returns sorted longest-first.
function extractClassNames(html, attoSource) {
  const names = new Set();
  const cssClassRe = /\.([a-zA-Z_][a-zA-Z0-9_-]*)/g;

  // 1. HTML class="..." attributes
  for (const [, value] of html.matchAll(/\bclass="([^"]*)"/g))
    for (const token of value.split(/\s+/)) if (token) names.add(token);

  // 2. CSS .classname selectors in <style> blocks
  const styleBlock = html.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? "";
  for (const [, name] of styleBlock.matchAll(cssClassRe)) names.add(name);

  // 3. JS classList.toggle/add/remove/contains('name')
  for (const [, name] of html.matchAll(
    /classList\.(?:toggle|add|remove|contains)\(\s*['"]([a-zA-Z_][a-zA-Z0-9_-]*)['"]/g
  )) names.add(name);

  // 4. JS querySelector/querySelectorAll — extract .classname from selector strings
  for (const [, sel] of html.matchAll(
    /querySelector(?:All)?\(\s*['"]([^'"]*)['"]\s*\)/g
  )) for (const [, name] of sel.matchAll(cssClassRe)) names.add(name);

  // 5. attoplot.js el('tag', 'className') helper
  for (const [, name] of attoSource.matchAll(
    /\bel\(\s*['"][^'"]*['"]\s*,\s*['"]([a-zA-Z_][a-zA-Z0-9_-]*)['"]\s*\)/g
  )) names.add(name);

  return [...names].sort((a, b) => b.length - a.length);
}

// Extract all HTML IDs from attributes, CSS selectors, and JS refs.
// Returns sorted longest-first.
function extractIdNames(html) {
  const names = new Set();
  const hexColorRe = /^[0-9a-fA-F]{3,8}$/;

  // 1. HTML id="..." attributes
  for (const [, value] of html.matchAll(/\bid="([^"]*)"/g))
    if (value) names.add(value);

  // 2. CSS #idname selectors in <style> blocks (skip hex colors)
  const styleBlock = html.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? "";
  for (const [, name] of styleBlock.matchAll(/#([a-zA-Z_][a-zA-Z0-9_-]*)/g))
    if (!hexColorRe.test(name)) names.add(name);

  // 3. JS getElementById('name')
  for (const [, name] of html.matchAll(
    /getElementById\(\s*['"]([a-zA-Z_][a-zA-Z0-9_-]*)['"]\s*\)/g
  )) names.add(name);

  // 4. JS querySelector/querySelectorAll — extract #idname from selector strings
  for (const [, sel] of html.matchAll(
    /querySelector(?:All)?\(\s*['"]([^'"]*)['"]\s*\)/g
  )) for (const [, name] of sel.matchAll(/#([a-zA-Z_][a-zA-Z0-9_-]*)/g))
    if (!hexColorRe.test(name)) names.add(name);

  return [...names].sort((a, b) => b.length - a.length);
}

// Cross-reference each name against its source contexts and return warnings
// for names found in only one context (may indicate stale/missing refs).
function validateNames(classNames, idNames, html, attoSource) {
  const styleBlock = html.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? "";
  const warnings = [];

  for (const name of classNames) {
    const contexts = [];
    const escaped = name.replace(/[-]/g, "\\-");
    const classAttrRe = new RegExp(`\\bclass="[^"]*\\b${escaped}\\b[^"]*"`, "g");
    if (classAttrRe.test(html)) contexts.push("html-attr");
    if (new RegExp(`\\.${escaped}(?![a-zA-Z0-9_-])`).test(styleBlock)) contexts.push("css");
    if (new RegExp(`['"](?:[^'"]*\\b)?${escaped}(?:\\b[^'"]*)?['"]`).test(html)) contexts.push("js");
    if (attoSource.includes(name)) contexts.push("attoplot");
    if (contexts.length <= 1)
      warnings.push(`class "${name}" only found in: ${contexts.join(", ") || "none"}`);
  }

  for (const name of idNames) {
    const contexts = [];
    const escaped = name.replace(/[-]/g, "\\-");
    if (new RegExp(`\\bid="${escaped}"`).test(html)) contexts.push("html-attr");
    if (new RegExp(`#${escaped}(?![a-zA-Z0-9_-])`).test(styleBlock)) contexts.push("css");
    if (new RegExp(`getElementById\\(['"]${escaped}['"]\\)`).test(html)) contexts.push("js");
    if (contexts.length <= 1)
      warnings.push(`id "${name}" only found in: ${contexts.join(", ") || "none"}`);
  }

  return warnings;
}

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

function renameClasses(html, classNames, idNames) {
  const gen = shortNamesGen();
  const classMap = Object.fromEntries(classNames.map(name => [name, gen.next().value]));
  // IDs use a separate generator so class and ID short names are independent
  const idGen = shortNamesGen();
  const idMap = Object.fromEntries(idNames.map(name => [name, idGen.next().value]));

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

// ── Terser options (shared) ───────────────────────────────────────────────────

const terserOpts = {
  compress: { passes: 2, pure_getters: true, unsafe: true, toplevel: true },
  mangle: { toplevel: true },
};

// ── Build pipeline ────────────────────────────────────────────────────────────

const fmt = n => n.toLocaleString().padStart(6);
const pct = (a, b) => ((1 - b / a) * 100).toFixed(1);
const R = []; // report lines

// 1. Read sources
const attoSource = await Bun.file("attoplot.js").text();
const html = await Bun.file("index.html").text();
R.push(
  ` 1. Read sources`,
  `    attoplot.js  ${fmt(attoSource.length)} bytes`,
  `    index.html   ${fmt(html.length)} bytes`, ``
);

// 2. Extract class/ID names
const CLASS_NAMES = extractClassNames(html, attoSource);
const ID_NAMES = extractIdNames(html);
R.push(
  ` 2. Extract class/ID names`,
  `    ${CLASS_NAMES.length} classes, ${ID_NAMES.length} IDs`, ``
);

// 3. Validate names
const warnings = validateNames(CLASS_NAMES, ID_NAMES, html, attoSource);
R.push(` 3. Validate names`, ``);

// 4. Bundle JS (Bun transpiler — minifies whitespace, identifiers, syntax)
const match = html.match(
  /<script src="attoplot\.js"><\/script>\s*<script>([\s\S]*?)<\/script>/
);
if (!match) throw new Error("Could not locate script blocks in index.html");
const inlineJS = match[1];
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
R.push(
  ` 4. Bundle JS (Bun transpiler)`,
  `    ${fmt(combinedJS.length)} → ${fmt(minifiedJS.length)} bytes (${pct(combinedJS.length, minifiedJS.length)}% reduction)`,
  `    minifies: whitespace, identifiers, syntax`, ``
);

// 5. Inline JS into HTML
const SCRIPT_BLOCK_RE =
  /<script src="attoplot\.js"><\/script>\s*<script>[\s\S]*?<\/script>/;
const finalHtml = html.replace(
  SCRIPT_BLOCK_RE,
  `<script>${minifiedJS}</script>`
);
if (finalHtml === html) {
  throw new Error("Replacement had no effect — regex did not match");
}
R.push(` 5. Inline JS into HTML`, ``);

// 6. Rename classes/IDs
const renamedHtml = renameClasses(finalHtml, CLASS_NAMES, ID_NAMES);
R.push(
  ` 6. Rename classes/IDs`,
  `    ${CLASS_NAMES.length} classes + ${ID_NAMES.length} IDs → 1-2 char names`, ``
);

// 7. Minify HTML (html-minifier-terser)
const minifiedHtml = await minify(renamedHtml, {
  collapseWhitespace: true,
  removeComments: true,
  minifyCSS: true,
  minifyJS: terserOpts,
});
R.push(
  ` 7. Minify HTML (html-minifier-terser)`,
  `    ${fmt(renamedHtml.length)} → ${fmt(minifiedHtml.length)} bytes (${pct(renamedHtml.length, minifiedHtml.length)}% reduction)`,
  `    options: collapseWhitespace, removeComments,`,
  `             minifyCSS, minifyJS (terser 2-pass)`, ``
);

// 8. Gzip (level 9 = maximum compression)
const gz = gzipSync(Buffer.from(minifiedHtml), { level: constants.Z_BEST_COMPRESSION });
R.push(
  ` 8. Gzip`,
  `    index.html  ${fmt(minifiedHtml.length)} → ${fmt(gz.length)} bytes (level 9)`, ``
);

// 9. Base64
const b64 = Buffer.from(gz).toString("base64");
R.push(
  ` 9. Base64`,
  `    index.html.gz  ${fmt(gz.length)} → ${fmt(b64.length)} bytes`, ``
);

// 10. Write dist/
mkdirSync("dist", { recursive: true });
await Bun.write("dist/index.html", minifiedHtml);
await Bun.write("dist/index.html.gz", gz);
await Bun.write("dist/index.html.gz.b64", b64);
R.push(`10. Write dist/`, ``);

// ── Status ──────────────────────────────────────────────────────────────────
if (warnings.length) {
  R.push(`Warnings`, `========`, ``);
  for (const w of warnings) R.push(`  ${w}`);
  R.push(`  classes: ${CLASS_NAMES.join(", ")}`);
  R.push(`  IDs:     ${ID_NAMES.join(", ")}`, ``);
} else {
  R.push(`Build complete: no warnings or errors`, ``);
}

// ── Output files ────────────────────────────────────────────────────────────
R.push(
  `Output Files`,
  `============`, ``,
  `  dist/index.html        ${fmt(minifiedHtml.length)} bytes  Minified single-file app (JS+CSS inlined)`,
  `  dist/index.html.gz     ${fmt(gz.length)} bytes  Gzip-compressed index.html`,
  `  dist/index.html.gz.b64 ${fmt(b64.length)} bytes  Base64 of gzip (for firmware embedding)`, ``
);

// ── Size comparison (includes attoplot standalone stats, no files written) ──
let attoMin = transpiler.transformSync(attoSource).replace(/\s*export\s*\{\s*\}\s*;?\s*$/, "");
const attoWrapped = await minify(`<script>${attoMin}</script>`, { minifyJS: terserOpts });
const attoMinLen = attoWrapped.replace(/<\/?script>/g, "").length;
const attoMinGzLen = gzipSync(Buffer.from(attoWrapped.replace(/<\/?script>/g, "")), { level: constants.Z_BEST_COMPRESSION }).length;

R.push(
  `Size Comparison`,
  `===============`, ``,
  `  uPlot 1.6.31 (JS + CSS, reference):`,
  `    source:   149,228 bytes`,
  `    minified:  52,169 bytes`,
  `    gzip min:  22,488 bytes`, ``,
  `  attoplot.js (standalone):`,
  `    source:   ${fmt(attoSource.length)} bytes`,
  `    minified: ${fmt(attoMinLen)} bytes`,
  `    gzip min: ${fmt(attoMinGzLen)} bytes`, ``,
  `  index.html (attoplot.js inlined):`,
  `    source:   ${fmt(html.length)} bytes`,
  `    minified: ${fmt(minifiedHtml.length)} bytes`,
  `    gzip min: ${fmt(gz.length)} bytes`,
  `    base64 gz: ${fmt(b64.length)} bytes`, ``
);

const report = `Build Report\n============\n\n${R.join("\n")}\n`;
console.log(`\n${report}`);
await Bun.write("dist/build-report.txt", report);
