/**
 * attoplot.js — Minimal Canvas 2D charting library
 * Drop-in replacement for uPlot (subset API)
 * Supports: line series, area fills, multi-axis, cursor crosshair, hooks
 */
var uPlot = (function () {
  'use strict';

  // ── Section 1: Utilities ──────────────────────────────────────────────────

  var pxRatio = window.devicePixelRatio || 1;

  function crisp(v) { return Math.round(v) + 0.5; }

  function el(tag, cls) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    return e;
  }

  // ── Section 2: Scale math ─────────────────────────────────────────────────

  function valToPos(val, scaleMin, scaleMax, pxMin, pxMax) {
    return pxMin + (val - scaleMin) / (scaleMax - scaleMin) * (pxMax - pxMin);
  }

  function posToVal(pos, scaleMin, scaleMax, pxMin, pxMax) {
    return scaleMin + (pos - pxMin) / (pxMax - pxMin) * (scaleMax - scaleMin);
  }

  function bsearch(arr, val) {
    var lo = 0, hi = arr.length - 1, mid;
    while (lo <= hi) {
      mid = (lo + hi) >> 1;
      if (arr[mid] < val) lo = mid + 1;
      else hi = mid - 1;
    }
    return lo;
  }

  // Find visible data index range for a given min/max
  function visRange(arr, min, max) {
    var i0 = bsearch(arr, min), i1 = bsearch(arr, max);
    if (i0 > 0) i0--;
    if (i1 < arr.length - 1) i1++;
    return [i0, i1];
  }

  // Find the closest data index to a given value
  function closestIdx(arr, val) {
    var idx = bsearch(arr, val);
    if (idx >= arr.length) return arr.length - 1;
    if (idx === 0) return 0;
    return Math.abs(arr[idx] - val) < Math.abs(arr[idx - 1] - val) ? idx : idx - 1;
  }

  // ── Section 3: Axis tick generation ───────────────────────────────────────

  // Time axis: pick best increment from user-provided list
  function timeAxisSplits(scaleMin, scaleMax, plotWidth, space, incrs) {
    var range = scaleMax - scaleMin;
    if (range <= 0) return [];
    var pxPerSec = plotWidth / range;
    var bestIncr = incrs[incrs.length - 1];
    for (var i = 0; i < incrs.length; i++) {
      if (incrs[i] * pxPerSec >= space) {
        bestIncr = incrs[i];
        break;
      }
    }
    var splits = [];
    var first = Math.ceil(scaleMin / bestIncr) * bestIncr;
    for (var v = first; v <= scaleMax; v += bestIncr) {
      splits.push(v);
    }
    return splits;
  }

  // Numeric axis: nice numbers algorithm
  function numAxisSplits(scaleMin, scaleMax, plotHeight) {
    var range = scaleMax - scaleMin;
    if (range <= 0) return [];
    // Target roughly 1 tick per 40-50 pixels
    var desiredTicks = Math.max(2, Math.floor(plotHeight / 50));
    var rawIncr = range / desiredTicks;
    var exp = Math.floor(Math.log10(rawIncr));
    var base = Math.pow(10, exp);
    var niceIncr;
    var ratio = rawIncr / base;
    if (ratio <= 1.5) niceIncr = base;
    else if (ratio <= 3.5) niceIncr = 2 * base;
    else if (ratio <= 7.5) niceIncr = 5 * base;
    else niceIncr = 10 * base;

    var splits = [];
    var first = Math.ceil(scaleMin / niceIncr) * niceIncr;
    for (var v = first; v <= scaleMax + niceIncr * 0.001; v += niceIncr) {
      splits.push(+v.toFixed(10));
    }
    return splits;
  }

  // ── Section 4: Constructor ────────────────────────────────────────────────

  function AttoPlot(opts, data, container) {
    var self = this;

    // Store raw config
    self._series = [];
    self._axes = [];
    self._scalesCfg = {};
    self._hooks = opts.hooks || {};
    self._padding = opts.padding || [0, 0, 0, 0]; // [top, right, bottom, left]

    // Parse series
    var seriesOpts = opts.series || [];
    for (var si = 0; si < seriesOpts.length; si++) {
      var s = seriesOpts[si];
      self._series.push({
        label:  s.label || '',
        scale:  s.scale || (si === 0 ? 'x' : 'y'),
        stroke: s.stroke || '#000',
        width:  s.width != null ? s.width : 1,
        fill:   s.fill || null,
        show:   s.show !== false,
      });
    }

    // Parse axes
    var axesOpts = opts.axes || [];
    for (var ai = 0; ai < axesOpts.length; ai++) {
      var a = axesOpts[ai];
      self._axes.push({
        scale:  a.scale || (ai === 0 ? 'x' : 'y'),
        side:   a.side != null ? a.side : (ai === 0 ? 2 : 3), // 2=bottom, 3=left, 1=right
        show:   a.show !== false,
        size:   a.size || 40,
        stroke: a.stroke || '#666',
        font:   a.font || '11px sans-serif',
        ticks:  a.ticks ? {
          stroke: a.ticks.stroke || '#666',
          width:  a.ticks.width != null ? a.ticks.width : 1,
          size:   a.ticks.size || 5,
        } : { stroke: '#666', width: 1, size: 5 },
        grid: a.grid ? {
          show:   a.grid.show !== false,
          stroke: a.grid.stroke || 'rgba(128,128,128,0.2)',
          width:  a.grid.width != null ? a.grid.width : 1,
        } : { show: ai > 0, stroke: 'rgba(128,128,128,0.2)', width: 1 },
        space:  a.space || 50,
        incrs:  a.incrs || null,
        values: a.values || null,
        gap:    a.gap || 4,
      });
    }

    // Parse scales config
    var scalesOpts = opts.scales || {};
    for (var key in scalesOpts) {
      var sc = scalesOpts[key];
      self._scalesCfg[key] = {
        time:  sc.time || false,
        auto:  sc.auto || false,
        range: sc.range || null,
      };
    }

    // Live scale values {min, max}
    self._scales = {};

    // Dimensions
    self._width = opts.width || 800;
    self._height = opts.height || 400;
    self.width = self._width;

    // Data
    self.data = data || [[]];

    // Cursor state
    self.cursor = { idx: null, left: 0, top: 0 };

    // ── DOM setup ──

    var root = el('div', 'attoplot');
    root.style.cssText = 'position:relative;overflow:hidden;width:' + self._width + 'px;height:' + self._height + 'px';

    var can = el('canvas');
    root.appendChild(can);

    // Cursor crosshair divs
    var curX = el('div', 'ap-cursor-x');
    var curY = el('div', 'ap-cursor-y');

    curX.style.cssText = 'position:absolute;pointer-events:none;display:none;width:0;border-left:1px dashed rgba(128,128,128,0.5)';
    curY.style.cssText = 'position:absolute;pointer-events:none;display:none;height:0;border-top:1px dashed rgba(128,128,128,0.5)';
    root.appendChild(curX);
    root.appendChild(curY);

    self.root = root;
    self._can = can;
    self._curX = curX;
    self._curY = curY;

    // Canvas context
    var ctx = can.getContext('2d');
    self.ctx = ctx;

    // Geometry (computed in _regeom)
    self._plotLeft = 0;
    self._plotTop = 0;
    self._plotWidth = 0;
    self._plotHeight = 0;
    self.bbox = { left: 0, top: 0, width: 0, height: 0 };

    // Apply initial canvas sizing + geometry
    self._applySize();

    // Attach to container
    container.appendChild(root);

    // ── Mouse events for cursor ──
    function onMove(e) {
      var rect = can.getBoundingClientRect();
      var cx = e.clientX - rect.left;
      var cy = e.clientY - rect.top;
      var pl = self._plotLeft, pt = self._plotTop;
      var pw = self._plotWidth, ph = self._plotHeight;
      if (cx >= pl && cx <= pl + pw && cy >= pt && cy <= pt + ph) {
        curX.style.left = cx + 'px';
        curX.style.top = pt + 'px';
        curX.style.height = ph + 'px';
        curX.style.display = 'block';
        curY.style.top = cy + 'px';
        curY.style.left = pl + 'px';
        curY.style.width = pw + 'px';
        curY.style.display = 'block';
        if (self.data[0] && self.data[0].length > 0) {
          var xSc = self._scales.x;
          var xVal = posToVal(cx, xSc.min, xSc.max, pl, pl + pw);
          self.cursor.idx = closestIdx(self.data[0], xVal);
        } else {
          self.cursor.idx = null;
        }
        self.cursor.left = cx;
        self.cursor.top = cy;
        self._fire('setCursor');
      } else {
        onLeave();
      }
    }

    function onLeave() {
      curX.style.display = 'none';
      curY.style.display = 'none';
      self.cursor.idx = null;
      self._fire('setCursor');
    }

    root.addEventListener('mousemove', onMove);
    root.addEventListener('mouseleave', onLeave);

    // Batched redraw state
    self._dirty = false;

    // Initial scale computation and draw
    self._computeScales();
    self._redraw();
  }

  // ── Internal methods ──────────────────────────────────────────────────────

  var proto = AttoPlot.prototype;

  // Schedule a batched redraw via microtask. Multiple calls to _scheduleRedraw
  // within the same synchronous block coalesce into a single _redraw.
  proto._scheduleRedraw = function () {
    if (this._dirty) return;
    this._dirty = true;
    var self = this;
    queueMicrotask(function () {
      self._dirty = false;
      self._computeScales();
      self._redraw();
    });
  };

  // Fire a hook. Render hooks (drawClear, draw) run with the ctx transform
  // reset to identity so that hook code operates in device-pixel space,
  // matching uPlot's convention where bbox values map directly to ctx coords.
  proto._fire = function (hook) {
    var fns = this._hooks[hook];
    if (!fns) return;
    var ctx = this.ctx;
    var isRender = hook === 'drawClear' || hook === 'draw';
    if (isRender) {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0); // identity — device pixels
    }
    for (var i = 0; i < fns.length; i++) {
      fns[i](this);
    }
    if (isRender) {
      ctx.restore();
    }
  };

  proto._applySize = function () {
    var can = this._can;
    can.width = this._width * pxRatio;
    can.height = this._height * pxRatio;
    can.style.width = this._width + 'px';
    can.style.height = this._height + 'px';
    this.ctx.scale(pxRatio, pxRatio);
    this.root.style.width = this._width + 'px';
    this.root.style.height = this._height + 'px';
    this.width = this._width;
    this._regeom();
  };

  // Recompute plot geometry from axes and padding
  proto._regeom = function () {
    var pad = this._padding;
    var leftSize = 0, rightSize = 0, bottomSize = 0, topSize = 0;

    for (var i = 0; i < this._axes.length; i++) {
      var ax = this._axes[i];
      if (!ax.show) continue;
      var side = ax.side;
      if (side === 2) bottomSize = Math.max(bottomSize, ax.size);       // bottom
      else if (side === 0) topSize = Math.max(topSize, ax.size);        // top
      else if (side === 3) leftSize = Math.max(leftSize, ax.size);      // left
      else if (side === 1) rightSize = Math.max(rightSize, ax.size);    // right
    }

    this._plotLeft = leftSize + pad[3];
    this._plotTop = pad[0];
    this._plotWidth = Math.max(1, this._width - this._plotLeft - rightSize - pad[1]);
    this._plotHeight = Math.max(1, this._height - this._plotTop - bottomSize - pad[2]);

    // bbox in device pixels (matches uPlot convention)
    this.bbox = {
      left:   this._plotLeft * pxRatio,
      top:    this._plotTop * pxRatio,
      width:  this._plotWidth * pxRatio,
      height: this._plotHeight * pxRatio,
    };
  };

  // Compute scale ranges from data
  proto._computeScales = function () {
    var self = this;
    var d = self.data;

    // X scale: use data extent if no explicit min/max has been set via setScale
    if (!self._scales.x) self._scales.x = { min: 0, max: 1 };
    var xSc = self._scales.x;

    if (d[0] && d[0].length > 0 && xSc._auto !== false) {
      // Only set from data if not explicitly overridden
      if (xSc.min === 0 && xSc.max === 1) {
        xSc.min = d[0][0];
        xSc.max = d[0][d[0].length - 1];
      }
    }

    // Find visible data range for Y auto-ranging
    var i0 = 0, i1 = d[0] ? d[0].length - 1 : 0;
    if (d[0] && d[0].length > 0) {
      var vr = visRange(d[0], xSc.min, xSc.max);
      i0 = vr[0]; i1 = vr[1];
    }

    // Y scales: compute from visible data
    var scaleData = {}; // key -> {min, max}
    for (var si = 1; si < self._series.length; si++) {
      var ser = self._series[si];
      if (!ser.show) continue;
      var sk = ser.scale;
      if (!scaleData[sk]) scaleData[sk] = { min: Infinity, max: -Infinity };
      var sd = scaleData[sk];
      var arr = d[si];
      if (!arr) continue;
      for (var j = i0; j <= i1 && j < arr.length; j++) {
        var v = arr[j];
        if (v != null) {
          if (v < sd.min) sd.min = v;
          if (v > sd.max) sd.max = v;
        }
      }
    }

    // Apply scale config (range functions, fixed ranges, auto)
    for (var key in self._scalesCfg) {
      if (key === 'x') continue;
      var cfg = self._scalesCfg[key];
      var sd2 = scaleData[key] || { min: 0, max: 1 };
      if (sd2.min === Infinity) { sd2.min = 0; sd2.max = 1; }

      if (!self._scales[key]) self._scales[key] = { min: 0, max: 1 };
      var sc = self._scales[key];

      if (typeof cfg.range === 'function') {
        var r = cfg.range(self, sd2.min, sd2.max);
        sc.min = r[0];
        sc.max = r[1];
      } else {
        sc.min = sd2.min;
        sc.max = sd2.max === sd2.min ? sd2.max + 1 : sd2.max;
      }
    }
  };

  // ── Section 5: Rendering pipeline ─────────────────────────────────────────

  proto._redraw = function () {
    var self = this;
    var ctx = self.ctx;
    var pl = self._plotLeft, pt = self._plotTop;
    var pw = self._plotWidth, ph = self._plotHeight;
    var pr = pl + pw, pb = pt + ph;
    var d = self.data;

    // Clear the entire canvas (axes area + plot area)
    ctx.clearRect(0, 0, self._width, self._height);

    // Fire drawClear hook (user fills background)
    self._fire('drawClear');

    // ── Compute axis splits ──
    var allSplits = [];
    for (var ai = 0; ai < self._axes.length; ai++) {
      var ax = self._axes[ai];
      if (!ax.show) { allSplits.push([]); continue; }

      var sc = self._scales[ax.scale];
      if (!sc) { allSplits.push([]); continue; }

      var splits;
      if (ax.scale === 'x' && ax.incrs) {
        splits = timeAxisSplits(sc.min, sc.max, pw, ax.space, ax.incrs);
      } else {
        splits = numAxisSplits(sc.min, sc.max, ax.side === 2 || ax.side === 0 ? pw : ph);
      }
      allSplits.push(splits);
    }

    // ── Draw grid lines ──
    ctx.save();
    for (var ai2 = 0; ai2 < self._axes.length; ai2++) {
      var ax2 = self._axes[ai2];
      if (!ax2.show || !ax2.grid.show) continue;
      var sc2 = self._scales[ax2.scale];
      if (!sc2) continue;
      var splits2 = allSplits[ai2];

      ctx.strokeStyle = ax2.grid.stroke;
      ctx.lineWidth = ax2.grid.width;
      ctx.beginPath();

      var isXAxis = (ax2.side === 2 || ax2.side === 0);
      for (var gi = 0; gi < splits2.length; gi++) {
        var pos;
        if (isXAxis) {
          pos = valToPos(splits2[gi], sc2.min, sc2.max, pl, pr);
          ctx.moveTo(crisp(pos), pt);
          ctx.lineTo(crisp(pos), pb);
        } else {
          pos = valToPos(splits2[gi], sc2.min, sc2.max, pb, pt);
          ctx.moveTo(pl, crisp(pos));
          ctx.lineTo(pr, crisp(pos));
        }
      }
      ctx.stroke();
    }
    ctx.restore();

    // ── Draw axis ticks and labels ──
    for (var ai3 = 0; ai3 < self._axes.length; ai3++) {
      var ax3 = self._axes[ai3];
      if (!ax3.show) continue;
      var sc3 = self._scales[ax3.scale];
      if (!sc3) continue;
      var splits3 = allSplits[ai3];
      if (splits3.length === 0) continue;

      ctx.save();
      ctx.font = ax3.font;
      ctx.fillStyle = ax3.stroke;
      ctx.strokeStyle = ax3.ticks.stroke;
      ctx.lineWidth = ax3.ticks.width;

      // Format labels
      var labels;
      if (ax3.values) {
        labels = ax3.values(self, splits3);
      } else {
        labels = splits3.map(function (v) { return v == null ? '' : String(v); });
      }

      var tickSize = ax3.ticks.size;
      var gap = ax3.gap;
      var isX = (ax3.side === 2 || ax3.side === 0);

      ctx.beginPath();

      for (var ti = 0; ti < splits3.length; ti++) {
        var lbl = labels[ti];
        if (lbl === '' || lbl == null) continue;
        var tpos;

        if (isX) {
          // Bottom x-axis
          tpos = valToPos(splits3[ti], sc3.min, sc3.max, pl, pr);
          ctx.textAlign = 'center';
          ctx.textBaseline = 'top';
          ctx.fillText(lbl, tpos, pb + tickSize + gap);
          // Tick mark
          ctx.moveTo(crisp(tpos), pb);
          ctx.lineTo(crisp(tpos), pb + tickSize);
        } else if (ax3.side === 3) {
          // Left y-axis
          tpos = valToPos(splits3[ti], sc3.min, sc3.max, pb, pt);
          ctx.textAlign = 'right';
          ctx.textBaseline = 'middle';
          ctx.fillText(lbl, pl - tickSize - gap, tpos);
          // Tick mark
          ctx.moveTo(pl, crisp(tpos));
          ctx.lineTo(pl - tickSize, crisp(tpos));
        } else if (ax3.side === 1) {
          // Right y-axis
          tpos = valToPos(splits3[ti], sc3.min, sc3.max, pb, pt);
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          ctx.fillText(lbl, pr + tickSize + gap, tpos);
          // Tick mark
          ctx.moveTo(pr, crisp(tpos));
          ctx.lineTo(pr + tickSize, crisp(tpos));
        }
      }
      ctx.stroke();
      ctx.restore();
    }

    // ── Draw series (clipped to plot area) ──
    ctx.save();
    ctx.beginPath();
    ctx.rect(pl, pt, pw, ph);
    ctx.clip();

    for (var si2 = 1; si2 < self._series.length; si2++) {
      var ser = self._series[si2];
      if (!ser.show) continue;
      var xArr = d[0];
      var yArr = d[si2];
      if (!xArr || !yArr || xArr.length === 0) continue;

      var xSc = self._scales.x;
      var ySc = self._scales[ser.scale];
      if (!ySc) continue;

      // Find visible range via binary search
      var vr2 = visRange(xArr, xSc.min, xSc.max);
      var vi0 = vr2[0], vi1 = vr2[1];

      if (vi0 >= xArr.length || vi1 < 0) continue;

      // Build line path
      ctx.beginPath();
      var started = false;
      var firstX, lastX;
      for (var pi = vi0; pi <= vi1; pi++) {
        var xv = xArr[pi];
        var yv = yArr[pi];
        if (yv == null) continue;
        var px = valToPos(xv, xSc.min, xSc.max, pl, pr);
        var py = valToPos(yv, ySc.min, ySc.max, pb, pt);
        if (!started) {
          ctx.moveTo(px, py);
          firstX = px;
          started = true;
        } else {
          ctx.lineTo(px, py);
        }
        lastX = px;
      }

      if (!started) continue;

      // Stroke the line
      ctx.strokeStyle = ser.stroke;
      ctx.lineWidth = ser.width;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.stroke();

      // Fill area under line (if configured)
      if (ser.fill) {
        var baseline = pb; // y=0 at bottom of plot
        ctx.lineTo(lastX, baseline);
        ctx.lineTo(firstX, baseline);
        ctx.closePath();
        ctx.fillStyle = ser.fill;
        ctx.fill();
      }
    }

    ctx.restore();

    // Fire draw hook (user draws border etc.)
    self._fire('draw');
  };

  // ── Section 7: Public API ─────────────────────────────────────────────────

  proto.setData = function (newData) {
    this.data = newData;
    this._scheduleRedraw();
  };

  proto.setScale = function (scaleKey, range) {
    if (!this._scales[scaleKey]) this._scales[scaleKey] = {};
    this._scales[scaleKey].min = range.min;
    this._scales[scaleKey].max = range.max;
    this._scheduleRedraw();
  };

  proto.setSeries = function (idx, updates) {
    if (idx < this._series.length) {
      if ('show' in updates) {
        this._series[idx].show = updates.show;
      }
      this._scheduleRedraw();
    }
  };

  proto.setSize = function (dims) {
    this._width = dims.width;
    this._height = dims.height;
    this._applySize();
    this._scheduleRedraw();
  };

  return AttoPlot;
})();
