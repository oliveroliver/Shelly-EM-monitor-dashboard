// minifier-compare.js — Compare minifier strategies for attoplot.js
// Usage: bun minifier-compare.js
import { gzipSync, constants } from "zlib";
import { minify } from "html-minifier-terser";

const src = await Bun.file("attoplot.js").text();
const gz = (s) => gzipSync(Buffer.from(s), { level: constants.Z_BEST_COMPRESSION }).length;

function report(label, code) {
  console.log(`  ${label.padEnd(30)} ${String(code.length).padStart(6)} bytes  gz: ${String(gz(code)).padStart(5)} bytes`);
}

console.log("Source:", src.length, "bytes\n");

// Option A: Bun Transpiler only
const transpiler = new Bun.Transpiler({
  target: "browser",
  minifyWhitespace: true,
  minifyIdentifiers: true,
  minifySyntax: true,
});
let bunOnly = transpiler.transformSync(src).replace(/\s*export\s*\{\s*\}\s*;?\s*$/, "");
report("A: Bun only", bunOnly);

// Option B: Terser only (via html-minifier-terser hack — wrap in script tag)
const wrapped = `<script>${src}</script>`;
const terserDefault = await minify(wrapped, { minifyJS: true });
const terserDefaultCode = terserDefault.replace(/<\/?script>/g, "");
report("B: Terser default", terserDefaultCode);

// Option C: Terser with enhanced options
const terserEnhanced = await minify(wrapped, {
  minifyJS: {
    compress: { passes: 2, pure_getters: true, unsafe: true, toplevel: true },
    mangle: { toplevel: true },
  },
});
const terserEnhancedCode = terserEnhanced.replace(/<\/?script>/g, "");
report("C: Terser enhanced", terserEnhancedCode);

// Option D: Terser with 3 passes
const terser3pass = await minify(wrapped, {
  minifyJS: {
    compress: { passes: 3, pure_getters: true, unsafe: true, toplevel: true },
    mangle: { toplevel: true },
  },
});
const terser3passCode = terser3pass.replace(/<\/?script>/g, "");
report("D: Terser 3-pass enhanced", terser3passCode);

// Option E: Current pipeline (Bun then Terser default)
const wrappedBun = `<script>${bunOnly}</script>`;
const currentPipeline = await minify(wrappedBun, { minifyJS: true });
const currentCode = currentPipeline.replace(/<\/?script>/g, "");
report("E: Bun + Terser default", currentCode);

// Option F: Bun then Terser enhanced
const bunThenTerserEnhanced = await minify(wrappedBun, {
  minifyJS: {
    compress: { passes: 2, pure_getters: true, unsafe: true, toplevel: true },
    mangle: { toplevel: true },
  },
});
const bunThenEnhancedCode = bunThenTerserEnhanced.replace(/<\/?script>/g, "");
report("F: Bun + Terser enhanced", bunThenEnhancedCode);
