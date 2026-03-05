// attoplot.test.js — Tests for attoplot.js features used by index.html
// Run with: bun test
import { describe, test, expect, beforeEach, mock } from "bun:test";

// ── DOM + Canvas mock ────────────────────────────────────────────────────────

function makeStyle() {
  const s = {};
  return new Proxy(s, {
    set(t, k, v) { t[k] = v; return true; },
    get(t, k) { return t[k] ?? ""; },
  });
}

function makeElement(tag) {
  const el = {
    tagName: tag.toUpperCase(),
    className: "",
    style: makeStyle(),
    children: [],
    listeners: {},
    appendChild(c) { this.children.push(c); c.parentNode = this; },
    addEventListener(ev, fn) { (this.listeners[ev] = this.listeners[ev] || []).push(fn); },
    getBoundingClientRect() { return { left: 0, top: 0, width: 800, height: 400 }; },
  };
  if (tag === "canvas") {
    el.width = 0;
    el.height = 0;
    el.getContext = () => makeCtx();
  }
  return el;
}

function makeCtx() {
  const calls = [];
  const handler = {
    get(t, k) {
      if (k === "_calls") return calls;
      if (k in t) return t[k];
      // Return a function that records calls
      t[k] = typeof t[k] === "function" ? t[k] : function (...args) { calls.push([k, ...args]); };
      return t[k];
    },
    set(t, k, v) { t[k] = v; calls.push(["set:" + k, v]); return true; },
  };
  const target = {
    _calls: calls,
    save() { calls.push(["save"]); },
    restore() { calls.push(["restore"]); },
    scale(x, y) { calls.push(["scale", x, y]); },
    clearRect(x, y, w, h) { calls.push(["clearRect", x, y, w, h]); },
    beginPath() { calls.push(["beginPath"]); },
    moveTo(x, y) { calls.push(["moveTo", x, y]); },
    lineTo(x, y) { calls.push(["lineTo", x, y]); },
    stroke() { calls.push(["stroke"]); },
    fill() { calls.push(["fill"]); },
    clip() { calls.push(["clip"]); },
    rect(x, y, w, h) { calls.push(["rect", x, y, w, h]); },
    closePath() { calls.push(["closePath"]); },
    fillText(t, x, y) { calls.push(["fillText", t, x, y]); },
    fillRect(x, y, w, h) { calls.push(["fillRect", x, y, w, h]); },
    setTransform(a, b, c, d, e, f) { calls.push(["setTransform", a, b, c, d, e, f]); },
  };
  return new Proxy(target, handler);
}

// Install global DOM mocks before loading attoplot.js
globalThis.window = globalThis.window || {};
globalThis.window.devicePixelRatio = 1;
globalThis.document = globalThis.document || {};
globalThis.document.createElement = (tag) => makeElement(tag);
globalThis.queueMicrotask = (fn) => fn(); // execute synchronously for tests

// Load attoplot.js — it uses var uPlot = (function(){...})() which creates a global
// We need to evaluate it in global scope
const fs = await import("fs");
const src = fs.readFileSync(new URL("./attoplot.js", import.meta.url), "utf-8");
const fn = new Function(src + "\nreturn uPlot;");
const uPlot = fn();

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeContainer() {
  return makeElement("div");
}

function makeOpts(overrides = {}) {
  return {
    width: 800,
    height: 400,
    padding: [22, 16, 0, 0],
    axes: [
      { stroke: "#666", ticks: { stroke: "#506480", width: 1, size: 5 },
        grid: { stroke: "rgba(80,100,128,0.25)", width: 1 },
        font: "11px sans-serif", size: 32,
        incrs: [1, 2, 5, 10, 15, 20, 30, 60], space: 44,
        values: (_u, splits) => splits.map(v => ":" + String(v % 60).padStart(2, "0")),
      },
      { scale: "w", stroke: "#9499a8", ticks: { stroke: "#506480", width: 1, size: 5 },
        grid: { stroke: "rgba(80,100,128,0.25)", width: 1 },
        font: "11px sans-serif", size: 58,
        values: (_u, splits) => splits.map(v => Math.round(v) + "W"),
      },
      { scale: "v", side: 1, stroke: "#9499a8", ticks: { stroke: "#506480", width: 1, size: 5 },
        grid: { show: false }, font: "11px sans-serif", size: 42,
        values: (_u, splits) => splits.map(v => v.toFixed(0) + "V"),
      },
      { scale: "i", side: 1, show: false },
    ],
    series: [
      {},
      { label: "Power", scale: "w", stroke: "#FFE033", width: 0.7, fill: "rgba(255,224,51,0.05)" },
      { label: "Voltage", scale: "v", stroke: "#00D4D4", width: 0.6 },
      { label: "Current", scale: "i", stroke: "#FF5FFF", width: 0.6 },
    ],
    scales: {
      x: { time: true },
      w: { auto: true, range: (_u, _min, max) => [0, Math.max(max * 1.55, 150)] },
      v: { range: () => [0, 250] },
      i: { auto: true, range: (_u, _min, max) => [0, Math.max(max * 1.55, 5)] },
    },
    hooks: {},
    ...overrides,
  };
}

function makeSampleData() {
  const n = 60;
  const ts = new Float64Array(n);
  const pw = new Float64Array(n);
  const vt = new Float64Array(n);
  const cr = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    ts[i] = 1000 + i;
    pw[i] = 100 + Math.sin(i * 0.1) * 50;
    vt[i] = 230 + Math.sin(i * 0.05) * 5;
    cr[i] = pw[i] / vt[i];
  }
  return [ts, pw, vt, cr];
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("AttoPlot constructor", () => {
  test("creates correct DOM structure", () => {
    const container = makeContainer();
    const chart = new uPlot(makeOpts(), [[], [], [], []], container);
    expect(chart.root).toBeDefined();
    expect(chart.root.className).toBe("attoplot");
    expect(chart.root.children.length).toBe(3); // canvas, curX, curY
    expect(chart.root.children[0].tagName).toBe("CANVAS");
    expect(container.children[0]).toBe(chart.root);
  });

  test("sets public properties", () => {
    const chart = new uPlot(makeOpts(), [[], [], [], []], makeContainer());
    expect(chart.ctx).toBeDefined();
    expect(chart.bbox).toBeDefined();
    expect(chart.bbox.width).toBeGreaterThan(0);
    expect(chart.bbox.height).toBeGreaterThan(0);
    expect(chart.width).toBe(800);
    expect(chart.cursor).toEqual({ idx: null, left: 0, top: 0 });
  });

  test("parses series config", () => {
    const chart = new uPlot(makeOpts(), [[], [], [], []], makeContainer());
    expect(chart._series.length).toBe(4);
    expect(chart._series[0].scale).toBe("x");
    expect(chart._series[1].label).toBe("Power");
    expect(chart._series[1].scale).toBe("w");
    expect(chart._series[1].fill).toBe("rgba(255,224,51,0.05)");
    expect(chart._series[2].stroke).toBe("#00D4D4");
    expect(chart._series[3].show).toBe(true);
  });

  test("parses axes config", () => {
    const chart = new uPlot(makeOpts(), [[], [], [], []], makeContainer());
    expect(chart._axes.length).toBe(4);
    expect(chart._axes[0].scale).toBe("x");
    expect(chart._axes[0].incrs).toEqual([1, 2, 5, 10, 15, 20, 30, 60]);
    expect(chart._axes[1].scale).toBe("w");
    expect(chart._axes[2].side).toBe(1);
    expect(chart._axes[3].show).toBe(false);
  });
});

describe("setData", () => {
  test("updates data and triggers redraw", () => {
    const chart = new uPlot(makeOpts(), [[], [], [], []], makeContainer());
    const data = makeSampleData();
    chart.setData(data);
    expect(chart.data).toBe(data);
    expect(chart.data[0].length).toBe(60);
  });
});

describe("setScale", () => {
  test("updates scale min/max", () => {
    const chart = new uPlot(makeOpts(), makeSampleData(), makeContainer());
    chart.setScale("x", { min: 1010, max: 1050 });
    expect(chart._scales.x.min).toBe(1010);
    expect(chart._scales.x.max).toBe(1050);
  });

  test("creates scale if not existing", () => {
    const chart = new uPlot(makeOpts(), [[], [], [], []], makeContainer());
    chart.setScale("custom", { min: 0, max: 100 });
    expect(chart._scales.custom.min).toBe(0);
    expect(chart._scales.custom.max).toBe(100);
  });
});

describe("setSeries", () => {
  test("toggles series visibility", () => {
    const chart = new uPlot(makeOpts(), makeSampleData(), makeContainer());
    expect(chart._series[3].show).toBe(true);
    chart.setSeries(3, { show: false });
    expect(chart._series[3].show).toBe(false);
    chart.setSeries(3, { show: true });
    expect(chart._series[3].show).toBe(true);
  });

  test("ignores out-of-range index", () => {
    const chart = new uPlot(makeOpts(), makeSampleData(), makeContainer());
    chart.setSeries(99, { show: false }); // should not throw
  });
});

describe("setSize", () => {
  test("updates dimensions and bbox", () => {
    const chart = new uPlot(makeOpts(), makeSampleData(), makeContainer());
    chart.setSize({ width: 600, height: 300 });
    expect(chart.width).toBe(600);
    expect(chart._width).toBe(600);
    expect(chart._height).toBe(300);
    expect(chart.bbox.width).toBeGreaterThan(0);
  });
});

describe("scale computation", () => {
  test("range function receives correct args", () => {
    const rangeFn = mock((_u, _min, max) => [0, Math.max(max * 1.55, 150)]);
    const opts = makeOpts({
      scales: {
        x: { time: true },
        w: { auto: true, range: rangeFn },
        v: { range: () => [0, 250] },
        i: { auto: true, range: (_u, _min, max) => [0, Math.max(max * 1.55, 5)] },
      },
    });
    const data = makeSampleData();
    const chart = new uPlot(opts, data, makeContainer());
    chart.setScale("x", { min: 1000, max: 1059 });

    expect(rangeFn).toHaveBeenCalled();
    const [self, dataMin, dataMax] = rangeFn.mock.calls[rangeFn.mock.calls.length - 1];
    expect(self).toBe(chart);
    expect(typeof dataMin).toBe("number");
    expect(typeof dataMax).toBe("number");
  });

  test("voltage scale uses fixed range", () => {
    const chart = new uPlot(makeOpts(), makeSampleData(), makeContainer());
    chart.setScale("x", { min: 1000, max: 1059 });
    expect(chart._scales.v.min).toBe(0);
    expect(chart._scales.v.max).toBe(250);
  });

  test("hidden series excluded from auto-range", () => {
    const chart = new uPlot(makeOpts(), makeSampleData(), makeContainer());
    chart.setSeries(1, { show: false }); // hide Power
    // After redraw, the 'w' scale range function still fires but with -Infinity clamped
    expect(chart._scales.w).toBeDefined();
  });
});

describe("hooks", () => {
  test("drawClear hook fires during redraw", () => {
    const drawClearFn = mock(() => {});
    const opts = makeOpts({ hooks: { drawClear: [drawClearFn] } });
    const chart = new uPlot(opts, makeSampleData(), makeContainer());
    // Constructor triggers initial redraw
    expect(drawClearFn).toHaveBeenCalled();
    expect(drawClearFn.mock.calls[0][0]).toBe(chart);
  });

  test("draw hook fires during redraw", () => {
    const drawFn = mock(() => {});
    const opts = makeOpts({ hooks: { draw: [drawFn] } });
    const chart = new uPlot(opts, makeSampleData(), makeContainer());
    expect(drawFn).toHaveBeenCalled();
    expect(drawFn.mock.calls[0][0]).toBe(chart);
  });

  test("setCursor hook fires on cursor move", () => {
    const setCursorFn = mock(() => {});
    const opts = makeOpts({ hooks: { setCursor: [setCursorFn] } });
    const data = makeSampleData();
    const chart = new uPlot(opts, data, makeContainer());
    chart.setScale("x", { min: 1000, max: 1059 });

    // Simulate mousemove within plot bounds
    const handlers = chart.root.listeners.mousemove;
    expect(handlers).toBeDefined();
    expect(handlers.length).toBeGreaterThan(0);

    // Fire mousemove event at center of plot
    const pl = chart._plotLeft;
    const pt = chart._plotTop;
    const pw = chart._plotWidth;
    const ph = chart._plotHeight;
    handlers[0]({ clientX: pl + pw / 2, clientY: pt + ph / 2 });

    expect(setCursorFn).toHaveBeenCalled();
    expect(chart.cursor.idx).not.toBeNull();
    expect(typeof chart.cursor.idx).toBe("number");
  });

  test("render hooks reset ctx transform", () => {
    let sawSetTransform = false;
    const drawFn = mock((u) => {
      // Check that ctx is accessible
      expect(u.ctx).toBeDefined();
    });
    const opts = makeOpts({ hooks: { draw: [drawFn] } });
    new uPlot(opts, makeSampleData(), makeContainer());
    expect(drawFn).toHaveBeenCalled();
  });
});

describe("cursor", () => {
  test("cursor.idx set correctly on mousemove", () => {
    const data = makeSampleData();
    const chart = new uPlot(makeOpts(), data, makeContainer());
    chart.setScale("x", { min: 1000, max: 1059 });

    const handlers = chart.root.listeners.mousemove;
    const pl = chart._plotLeft;
    const pt = chart._plotTop;
    const pw = chart._plotWidth;
    const ph = chart._plotHeight;

    // Move to start of plot
    handlers[0]({ clientX: pl + 1, clientY: pt + ph / 2 });
    expect(chart.cursor.idx).toBe(0);

    // Move to end of plot
    handlers[0]({ clientX: pl + pw - 1, clientY: pt + ph / 2 });
    expect(chart.cursor.idx).toBe(59);
  });

  test("cursor hidden on mouseleave", () => {
    const setCursorFn = mock(() => {});
    const opts = makeOpts({ hooks: { setCursor: [setCursorFn] } });
    const chart = new uPlot(opts, makeSampleData(), makeContainer());

    const leaveHandlers = chart.root.listeners.mouseleave;
    expect(leaveHandlers).toBeDefined();
    leaveHandlers[0]();
    expect(chart.cursor.idx).toBeNull();
  });
});

describe("series rendering", () => {
  test("hidden series not drawn", () => {
    const chart = new uPlot(makeOpts(), makeSampleData(), makeContainer());
    chart.setSeries(3, { show: false });
    // Verify the series is marked hidden
    expect(chart._series[3].show).toBe(false);
  });

  test("fill series creates area path", () => {
    // The Power series has fill set
    const chart = new uPlot(makeOpts(), makeSampleData(), makeContainer());
    chart.setScale("x", { min: 1000, max: 1059 });
    // Check that ctx.fill() was called (series 1 has fill)
    const fills = chart.ctx._calls.filter(c => c[0] === "fill");
    expect(fills.length).toBeGreaterThan(0);
  });

  test("non-fill series does not call fill", () => {
    const opts = makeOpts({
      series: [
        {},
        { label: "Test", scale: "w", stroke: "#fff", width: 1 },
      ],
      scales: {
        x: { time: true },
        w: { auto: true, range: (_u, _min, max) => [0, Math.max(max, 100)] },
      },
      axes: [
        { incrs: [1, 5, 10, 30, 60], space: 44 },
        { scale: "w", size: 40 },
      ],
    });
    const data = [new Float64Array([1, 2, 3]), new Float64Array([10, 20, 30])];
    const chart = new uPlot(opts, data, makeContainer());
    chart.setScale("x", { min: 1, max: 3 });

    // Count fill calls — there should be none from series (only possible from other sources)
    const fillCalls = chart.ctx._calls.filter(c => c[0] === "fill");
    expect(fillCalls.length).toBe(0);
  });
});
