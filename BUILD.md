# Build

Run with:
```
bun build.js
```

Outputs to `dist/` (gitignored).

## Steps

- **Bundle** — inlines `attoplot.js` into `index.html` as a single `<script>` block
- **Minify JS (pass 1)** — Bun's transpiler minifies whitespace, identifiers, and syntax across the combined script
- **Rename classes/IDs** — all CSS class names and element IDs are replaced with short 1–2 letter names (`a`, `b`, … `aa`, `ab`, …) across the `<style>`, `<script>`, and HTML attributes
- **Minify HTML** — `html-minifier-terser` strips comments, collapses whitespace, compresses inline CSS, and runs a second JS minification pass (terser)
- **Write** `dist/index.html` — single self-contained HTML file
- **Gzip** — level 9 compression → `dist/index.html.gz`
- **Base64** — base64 encoding of the gzip → `dist/index.html.gz.b64`

## Dependencies

- [html-minifier-terser](https://github.com/terser/html-minifier-terser) (`bun add html-minifier-terser`)
