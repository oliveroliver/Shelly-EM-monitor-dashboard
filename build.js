// build.js — Bundle attoplot.js into index.html, minify JS, and gzip output
// Usage: bun build.js
import { mkdirSync } from "fs";
import { minify } from "html-minifier-terser";

// 1. Read sources
const attoSource = await Bun.file("attoplot.js").text();
const html = await Bun.file("index.html").text();

// 2. Extract the inline <script> body that follows <script src="attoplot.js">
const match = html.match(
  /<script src="attoplot\.js"><\/script>\s*<script>([\s\S]*?)<\/script>/
);
if (!match) throw new Error("Could not locate script blocks in index.html");
const inlineJS = match[1];

// 3. Combine and minify (concat first so minifier sees full scope)
const combinedJS = attoSource + "\n" + inlineJS;

const transpiler = new Bun.Transpiler({
  target: "browser",
  minifyWhitespace: true,
  minifyIdentifiers: true,
  minifySyntax: true,
});
let minifiedJS = transpiler.transformSync(combinedJS);

// Guard: Bun.Transpiler may append "export {};" when it detects no exports —
// strip it if present so the script stays a plain classic script.
minifiedJS = minifiedJS.replace(/\s*export\s*\{\s*\}\s*;?\s*$/, "");

// 4. Splice back into HTML
const SCRIPT_BLOCK_RE =
  /<script src="attoplot\.js"><\/script>\s*<script>[\s\S]*?<\/script>/;
const finalHtml = html.replace(
  SCRIPT_BLOCK_RE,
  `<script>${minifiedJS}</script>`
);

if (finalHtml === html) {
  throw new Error("Replacement had no effect — regex did not match");
}

// 5. Minify HTML
const minifiedHtml = await minify(finalHtml, {
  collapseWhitespace: true,
  removeComments: true,
  minifyCSS: true,
  minifyJS: true,
});

// 5. Write dist/
mkdirSync("dist", { recursive: true });
await Bun.write("dist/index.html", minifiedHtml);
console.log(`dist/index.html  ${(minifiedHtml.length / 1024).toFixed(1)} KB`);

// 6. Gzip
const htmlBytes = new TextEncoder().encode(minifiedHtml);
const cs = new CompressionStream("gzip");
const writer = cs.writable.getWriter();
writer.write(htmlBytes);
writer.close();

const chunks = [];
const reader = cs.readable.getReader();
for (;;) {
  const { done, value } = await reader.read();
  if (done) break;
  chunks.push(value);
}

const total = chunks.reduce((n, c) => n + c.length, 0);
const gz = new Uint8Array(total);
let off = 0;
for (const c of chunks) {
  gz.set(c, off);
  off += c.length;
}

await Bun.write("dist/index.html.gz", gz);
console.log(`dist/index.html.gz  ${(gz.length / 1024).toFixed(1)} KB`);

// 7. Base64 of gzip
const b64 = Buffer.from(gz).toString("base64");
await Bun.write("dist/index.html.gz.b64", b64);
console.log(`dist/index.html.gz.b64  ${(b64.length / 1024).toFixed(1)} KB`);
