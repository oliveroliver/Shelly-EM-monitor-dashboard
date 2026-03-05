// measure.js — Measure attoplot.js sizes at each stage
// Usage: bun measure.js
import { gzipSync, constants } from "zlib";

const src = await Bun.file("attoplot.js").text();

const transpiler = new Bun.Transpiler({
  target: "browser",
  minifyWhitespace: true,
  minifyIdentifiers: true,
  minifySyntax: true,
});
let min = transpiler.transformSync(src);
min = min.replace(/\s*export\s*\{\s*\}\s*;?\s*$/, "");

const gzSrc = gzipSync(Buffer.from(src), { level: constants.Z_BEST_COMPRESSION });
const gzMin = gzipSync(Buffer.from(min), { level: constants.Z_BEST_COMPRESSION });

console.log("attoplot.js sizes:");
console.log(`  Source:    ${src.length.toLocaleString().padStart(6)} bytes`);
console.log(`  Minified:  ${min.length.toLocaleString().padStart(6)} bytes`);
console.log(`  Gzip src:  ${gzSrc.length.toLocaleString().padStart(6)} bytes`);
console.log(`  Gzip min:  ${gzMin.length.toLocaleString().padStart(6)} bytes`);
