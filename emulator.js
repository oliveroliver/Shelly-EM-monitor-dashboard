// Shelly EM Gen3 emulator — dual-purpose
// - Browser: import { EmulatorEngine } from './emulator.js'
// - Bun server: bun emulator.js
// Config: config.json (same directory)

// ── Simulation engine ─────────────────────────────────────────────────────────

export class EmulatorEngine {
  constructor(cfg) {
    const { device, grid, simulation, appliances: APPLIANCE_DEFS, seed } = cfg;
    this.device          = device;
    this.grid            = grid;
    this.simulation      = simulation;
    this.APPLIANCE_DEFS  = APPLIANCE_DEFS;
    this.active          = new Map();
    this.nextEventMs     = 0;
    this.currentState    = { power: 0, voltage: grid.nominalVoltage, current: 0, pf: 0.99 };
    this._seed(seed);
  }

  _ts() {
    return new Date().toTimeString().slice(0, 8);
  }

  _rand(lo, hi) {
    return lo + Math.random() * (hi - lo);
  }

  _activeList() {
    return [...this.active.values()].map(a => a.label).join(', ') || '(none)';
  }

  _startAppliance(def, nowMs) {
    const baseW = this._rand(def.wRange[0], def.wRange[1]);
    const dur   = def.alwaysOn ? Infinity : this._rand(def.minDur, def.maxDur);
    this.active.set(def.id, {
      label:       def.label,
      baseW,
      pf:          def.pf,
      noiseAmp:    def.noiseAmp,
      noiseFreq:   def.noiseFreq,
      noiseAmp2:   def.noiseAmp2  || 0,
      noiseFreq2:  def.noiseFreq2 || 0,
      phaseOffset: Math.random() * Math.PI * 2,
      endTime:     nowMs + dur,
    });
    console.log(`[${this._ts()}]  ON  ${def.label} (~${Math.round(baseW)}W)  [${this._activeList()}]`);
  }

  _triggerEvent(nowMs) {
    const canStart = this.APPLIANCE_DEFS.filter(p => !p.alwaysOn && !this.active.has(p.id));
    const canStop  = this.APPLIANCE_DEFS.filter(p => !p.alwaysOn &&  this.active.has(p.id));
    if (canStart.length > 0 && (Math.random() < 0.65 || canStop.length === 0)) {
      const def = canStart[Math.floor(Math.random() * canStart.length)];
      this._startAppliance(def, nowMs);
    } else if (canStop.length > 0) {
      const def = canStop[Math.floor(Math.random() * canStop.length)];
      this.active.delete(def.id);
      console.log(`[${this._ts()}]  OFF ${def.label}  [${this._activeList()}]`);
    }
    this.nextEventMs = nowMs + this._rand(this.simulation.eventMinMs, this.simulation.eventMaxMs);
  }

  computeState(nowMs) {
    const t = nowMs / 1000;

    // Expire finished appliances
    for (const [id, inst] of this.active) {
      if (nowMs > inst.endTime) {
        this.active.delete(id);
        console.log(`[${this._ts()}]  OFF ${inst.label}  (timer expired)  [${this._activeList()}]`);
      }
    }

    // Scheduled random events
    if (nowMs >= this.nextEventMs) this._triggerEvent(nowMs);

    let P_total = 0, S_total = 0;
    for (const [, inst] of this.active) {
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
    const V  = this.grid.nominalVoltage
      + this.grid.voltageSwing  * Math.sin(2 * Math.PI * 0.02 * t + 0.3)
      + this.grid.voltageRipple * Math.sin(2 * Math.PI * 0.7  * t + 1.1)
      + this.grid.voltageNoise  * (Math.random() - 0.5) * 2;
    const I  = S_total > 0 ? S_total / Math.max(V, 1) : 0;

    return { power: P_total, voltage: V, current: I, pf: PF };
  }

  tick(nowMs) {
    this.currentState = this.computeState(nowMs);
  }

  _seed(seed) {
    const now = Date.now();
    if (seed.alwaysOnAtStart) {
      this.APPLIANCE_DEFS.filter(p => p.alwaysOn).forEach(def => this._startAppliance(def, now));
    }
    const gentlePool = this.APPLIANCE_DEFS.filter(p => seed.gentleAppliances.includes(p.id));
    gentlePool
      .sort(() => Math.random() - 0.5)
      .slice(0, seed.gentleCount)
      .forEach(def => this._startAppliance(def, now));
    this.nextEventMs = now + this._rand(this.simulation.startEventMinMs, this.simulation.startEventMaxMs);
    this.currentState = this.computeState(now);
    console.log(`[${this._ts()}]  INIT  [${this._activeList()}]`);
  }

  _buildEM1Status(channel) {
    const s = this.currentState;
    return {
      id:         channel,
      current:    parseFloat(s.current.toFixed(3)),
      voltage:    parseFloat(s.voltage.toFixed(2)),
      act_power:  parseFloat(s.power.toFixed(2)),
      aprt_power: parseFloat((s.current * s.voltage).toFixed(2)),
      pf:         parseFloat(s.pf.toFixed(3)),
      freq:       this.grid.frequency,
    };
  }

  handleRpc(msgStr) {
    let req;
    try { req = JSON.parse(msgStr); } catch { return null; }

    const id     = req.id     ?? 0;
    const method = req.method ?? '';
    const params = req.params ?? {};

    if (method === 'EM1.GetStatus') {
      const ch = params.id ?? this.device.channel;
      return { id, src: this.device.id, result: this._buildEM1Status(ch) };
    }

    if (method === 'Shelly.GetDeviceInfo') {
      return {
        id,
        src: this.device.id,
        result: {
          name:  this.device.id,
          id:    this.device.id,
          mac:   this.device.mac,
          model: this.device.model,
          fw_id: this.device.firmware,
        },
      };
    }

    return { id, src: this.device.id, error: { code: -105, message: 'Method not found' } };
  }
}

// ── Bun server bootstrap ──────────────────────────────────────────────────────

if (typeof Bun !== 'undefined') {
  const { readFileSync } = await import('fs');
  const { join, dirname } = await import('path');
  const { fileURLToPath } = await import('url');

  const __dirname = dirname(fileURLToPath(import.meta.url));
  const cfg = JSON.parse(readFileSync(join(__dirname, 'config.json'), 'utf8'));

  const engine = new EmulatorEngine(cfg);
  const { server } = cfg;
  const wsClients = new Set();

  function serveFile(filePath, contentType) {
    try {
      const body = readFileSync(filePath);
      return new Response(body, { headers: { 'Content-Type': contentType } });
    } catch {
      return new Response('Not Found', { status: 404 });
    }
  }

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

      // Serve emulator.js and config.json alongside index.html
      if (url.pathname === '/emulator.js') {
        return serveFile(join(__dirname, 'emulator.js'), 'application/javascript; charset=utf-8');
      }
      if (url.pathname === '/config.json') {
        return serveFile(join(__dirname, 'config.json'), 'application/json; charset=utf-8');
      }

      // HTTP: serve index.html for any other path
      return serveFile(join(__dirname, 'index.html'), 'text/html; charset=utf-8');
    },

    websocket: {
      open(ws) {
        wsClients.add(ws);
        console.log(`[${new Date().toTimeString().slice(0, 8)}]  WS  client connected  (total: ${wsClients.size})`);
      },
      message(ws, msg) {
        const reply = engine.handleRpc(typeof msg === 'string' ? msg : msg.toString());
        if (reply) ws.send(JSON.stringify(reply));
      },
      close(ws) {
        wsClients.delete(ws);
        console.log(`[${new Date().toTimeString().slice(0, 8)}]  WS  client disconnected  (total: ${wsClients.size})`);
      },
    },
  });

  console.log(`Shelly EM Gen3 emulator running on http://${server.host === '0.0.0.0' ? 'localhost' : server.host}:${server.port}`);
  console.log(`WebSocket RPC endpoint: ws://localhost:${server.port}/rpc`);

  setInterval(() => engine.tick(Date.now()), cfg.simulation.tickIntervalMs);
}
