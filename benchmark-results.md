# Benchmark Results

Source: `index.html` + `attoplot.js` = 69.1 KB (unbuilt, 2 files)

**raw** — uncompressed size of the bundled HTML after `html-minifier-terser` (whitespace/comment/CSS stripping always applied), plus any flagged steps (bun JS, rename, terser JS). Before gzip.

| bun | rename | terser | raw (KB) | gz1 (KB) | gz9 (KB) | vs baseline | vs source | notes |
|-----|--------|--------|----------|----------|----------|-------------|-----------|-------|
| off | off | off | 63.7 | 18.8 | 16.0 | 0.0% | 76.8% | bundle only (baseline) |
| on | off | off | 44.4 | 14.2 | 12.5 | 21.9% | 81.9% | bun JS |
| off | off | on | 34.4 | 12.1 | 11.0 | 31.6% | 84.1% | terser JS |
| on | off | on | 34.4 | 12.0 | 11.0 | 31.6% | 84.1% | bun JS + terser JS |
| off | on | off | 61.6 | 18.4 | 15.7 | 1.9% | 77.3% | rename only |
| on | on | off | 42.1 | 13.7 | 12.2 | 24.1% | 82.4% | bun JS + rename |
| off | on | on | 32.3 | 11.7 | 10.7 | 33.4% | 84.6% | rename + terser JS |
| on | on | on | 32.1 | 11.6 | 10.6 | 33.9% | 84.7% | bun JS + rename + terser JS  ← current |
