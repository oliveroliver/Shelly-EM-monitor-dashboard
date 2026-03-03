// Shelly EM Gen3 emulator — Bun runtime
// Run with: bun emulator.js
// Config: config.json (same directory)

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// ── Config ────────────────────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadConfig() {
  const raw = readFileSync(join(__dirname, 'config.json'), 'utf8');
  return JSON.parse(raw);
}

const cfg = loadConfig();
const { server, device, grid, simulation, appliances: APPLIANCE_DEFS, seed } = cfg;

// ── Simulation state ──────────────────────────────────────────────────────────

const active = new Map(); // id → { label, baseW, pf, noiseAmp, noiseFreq, noiseAmp2, noiseFreq2, phaseOffset, endTime }
let nextEventMs = 0;
let currentState = { power: 0, voltage: grid.nominalVoltage, current: 0, pf: 0.99 };

function rand(lo, hi) { return lo + Math.random() * (hi - lo); }

function ts() {
  return new Date().toTimeString().slice(0, 8);
}

function activeList() {
  return [...active.values()].map(a => a.label).join(', ') || '(none)';
}

function startAppliance(def, nowMs) {
  const baseW = rand(def.wRange[0], def.wRange[1]);
  const dur   = def.alwaysOn ? Infinity : rand(def.minDur, def.maxDur);
  active.set(def.id, {
    label:        def.label,
    baseW,
    pf:           def.pf,
    noiseAmp:     def.noiseAmp,
    noiseFreq:    def.noiseFreq,
    noiseAmp2:    def.noiseAmp2  || 0,
    noiseFreq2:   def.noiseFreq2 || 0,
    phaseOffset:  Math.random() * Math.PI * 2,
    endTime:      nowMs + dur,
  });
  console.log(`[${ts()}]  ON  ${def.label} (~${Math.round(baseW)}W)  [${activeList()}]`);
}

function triggerEvent(nowMs) {
  const canStart = APPLIANCE_DEFS.filter(p => !p.alwaysOn && !active.has(p.id));
  const canStop  = APPLIANCE_DEFS.filter(p => !p.alwaysOn &&  active.has(p.id));
  if (canStart.length > 0 && (Math.random() < 0.65 || canStop.length === 0)) {
    const def = canStart[Math.floor(Math.random() * canStart.length)];
    startAppliance(def, nowMs);
  } else if (canStop.length > 0) {
    const def = canStop[Math.floor(Math.random() * canStop.length)];
    active.delete(def.id);
    console.log(`[${ts()}]  OFF ${def.label}  [${activeList()}]`);
  }
  nextEventMs = nowMs + rand(simulation.eventMinMs, simulation.eventMaxMs);
}

function computeState(nowMs) {
  const t = nowMs / 1000;

  // Expire finished appliances
  for (const [id, inst] of active) {
    if (nowMs > inst.endTime) {
      active.delete(id);
      console.log(`[${ts()}]  OFF ${inst.label}  (timer expired)  [${activeList()}]`);
    }
  }

  // Scheduled random events
  if (nowMs >= nextEventMs) triggerEvent(nowMs);

  let P_total = 0, S_total = 0;
  for (const [, inst] of active) {
    const P = Math.max(0,
      inst.baseW
      + inst.noiseAmp  * Math.sin(2 * Math.PI * inst.noiseFreq  * t + inst.phaseOffset)
      + inst.noiseAmp2 * Math.sin(2 * Math.PI * inst.noiseFreq2 * t + inst.phaseOffset + 2.1)
      + (Math.random() - 0.5) * inst.baseW * 0.018
    );
    P_total += P;
    S_total += P / inst.pf;
  }

  const PF = S_total > 0 ? P_total / S_total : 0.99;
  const V  = grid.nominalVoltage
    + grid.voltageSwing  * Math.sin(2 * Math.PI * 0.02 * t + 0.3)
    + grid.voltageRipple * Math.sin(2 * Math.PI * 0.7  * t + 1.1)
    + grid.voltageNoise  * (Math.random() - 0.5) * 2;
  const I  = S_total > 0 ? S_total / Math.max(V, 1) : 0;

  return { power: P_total, voltage: V, current: I, pf: PF };
}

// ── Seed startup ──────────────────────────────────────────────────────────────

{
  const now = Date.now();
  if (seed.alwaysOnAtStart) {
    APPLIANCE_DEFS.filter(p => p.alwaysOn).forEach(def => startAppliance(def, now));
  }
  const gentlePool = APPLIANCE_DEFS.filter(p => seed.gentleAppliances.includes(p.id));
  gentlePool
    .sort(() => Math.random() - 0.5)
    .slice(0, seed.gentleCount)
    .forEach(def => startAppliance(def, now));
  nextEventMs = now + rand(simulation.startEventMinMs, simulation.startEventMaxMs);
  currentState = computeState(now);
  console.log(`[${ts()}]  INIT  [${activeList()}]`);
}

// ── WebSocket client registry ─────────────────────────────────────────────────

const wsClients = new Set();

// ── RPC dispatcher ────────────────────────────────────────────────────────────

function buildEM1Status(channel) {
  const s = currentState;
  return {
    id:         channel,
    current:    parseFloat(s.current.toFixed(3)),
    voltage:    parseFloat(s.voltage.toFixed(2)),
    act_power:  parseFloat(s.power.toFixed(2)),
    aprt_power: parseFloat((s.current * s.voltage).toFixed(2)),
    pf:         parseFloat(s.pf.toFixed(3)),
    freq:       grid.frequency,
  };
}

function handleRpc(msgStr) {
  let req;
  try { req = JSON.parse(msgStr); } catch { return null; }

  const id     = req.id   ?? 0;
  const method = req.method ?? '';
  const params = req.params ?? {};

  if (method === 'EM1.GetStatus') {
    const ch = params.id ?? device.channel;
    return { id, src: device.id, result: buildEM1Status(ch) };
  }

  if (method === 'Shelly.GetDeviceInfo') {
    return {
      id,
      src: device.id,
      result: {
        name:  device.id,
        id:    device.id,
        mac:   device.mac,
        model: device.model,
        fw_id: device.firmware,
      },
    };
  }

  // Unknown method
  return { id, src: device.id, error: { code: -105, message: 'Method not found' } };
}

// ── HTTP helper ───────────────────────────────────────────────────────────────

function serveFile(filePath, contentType) {
  try {
    const body = readFileSync(filePath);
    return new Response(body, { headers: { 'Content-Type': contentType } });
  } catch {
    return new Response('Not Found', { status: 404 });
  }
}

// ── Bun server ────────────────────────────────────────────────────────────────

Bun.serve({
  port:     server.port,
  hostname: server.host,

  fetch(req, bunServer) {
    const url = new URL(req.url);

    // WebSocket upgrade at /rpc
    if (url.pathname === '/rpc') {
      const upgraded = bunServer.upgrade(req);
      if (upgraded) return undefined;
      return new Response('WebSocket upgrade required', { status: 426 });
    }

    // HTTP: serve index.html for any other path
    return serveFile(join(__dirname, 'index.html'), 'text/html; charset=utf-8');
  },

  websocket: {
    open(ws) {
      wsClients.add(ws);
      console.log(`[${ts()}]  WS  client connected  (total: ${wsClients.size})`);
    },
    message(ws, msg) {
      const reply = handleRpc(typeof msg === 'string' ? msg : msg.toString());
      if (reply) ws.send(JSON.stringify(reply));
    },
    close(ws) {
      wsClients.delete(ws);
      console.log(`[${ts()}]  WS  client disconnected  (total: ${wsClients.size})`);
    },
  },
});

console.log(`Shelly EM Gen3 emulator running on http://${server.host === '0.0.0.0' ? 'localhost' : server.host}:${server.port}`);
console.log(`WebSocket RPC endpoint: ws://localhost:${server.port}/rpc`);

// ── Simulation tick ───────────────────────────────────────────────────────────

setInterval(() => {
  currentState = computeState(Date.now());
}, simulation.tickIntervalMs);
