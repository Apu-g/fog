import { trainModel } from './model.js';
import { makeZone, applyScenario, simulateTick, snapshot, addEvent, injectReading, recordTraceStage } from './simulator.js';
import { randomUUID } from 'node:crypto';

const ids = ['north', 'east', 'south'];
const peers = { north: 4201, east: 4202, south: 4203 }; // kept for shape compatibility

function freshState() {
  const models = Object.fromEntries(ids.map((id, i) => [id, trainModel([11, 29, 53][i])]));
  const zones = Object.fromEntries(ids.map(id => [id, makeZone(id)]));
  const cloud = {
    online: true,
    start: Date.now(),
    latest: new Map(),
    series: [],
  };
  const nodeOnline = Object.fromEntries(ids.map(id => [id, true]));
  const pending = Object.fromEntries(ids.map(id => [id, []]));
  const lastSim = Object.fromEntries(ids.map(id => [id, Date.now()]));
  return { models, zones, cloud, nodeOnline, pending, lastSim, born: Date.now() };
}

const g = globalThis.__agrofogVercel ??= freshState();

function ensureZone(id) {
  if (!g.zones[id] || !g.models[id]) throw new Error('Unknown fog node');
}

function cloudState() {
  const now = Date.now();
  const nodes = [...g.cloud.latest.values()];
  const fresh = nodes.filter(n => now - n.receivedAt < 6000);
  return {
    connected: true,
    pid: 0,
    uptime: now - g.cloud.start,
    lastReceived: Math.max(0, ...nodes.map(n => n.receivedAt)),
    records: g.cloud.series.length,
    activeNodes: fresh.length,
    storedNodes: nodes.length,
    totalLiters: Number(fresh.reduce((s, n) => s + n.waterLiters, 0).toFixed(1)),
    avgMoisture: fresh.length ? Number((fresh.reduce((s, n) => s + (n.moisture ?? 0), 0) / fresh.length).toFixed(1)) : null,
    history: g.cloud.series.slice(-22),
    latest: fresh,
  };
}

function ingestCloud(summary) {
  g.cloud.latest.set(summary.id, { ...summary, receivedAt: Date.now() });
  g.cloud.series.push({ id: summary.id, tick: summary.tick, moisture: summary.moisture, pump: summary.pump, traceId: summary.traceId || null, time: Date.now() });
  if (g.cloud.series.length > 600) g.cloud.series.splice(0, g.cloud.series.length - 600);
}

function flushCloud(id) {
  const zone = g.zones[id];
  const queue = g.pending[id];
  while (queue.length) {
    const packet = queue[0];
    if (!g.cloud.online) break;
    ingestCloud(packet);
    queue.shift();
    if (packet.traceId) {
      const trace = zone.traces.find(t => t.id === packet.traceId);
      if (trace && trace.cloud.status !== 'delivered') {
        trace.cloud = { status: 'delivered', time: Date.now() };
        recordTraceStage(trace, 'cloud', 'Cloud aggregator acknowledged telemetry receipt');
      }
    }
  }
  if (!g.cloud.online) {
    for (const packet of queue) {
      if (!packet.traceId) continue;
      const trace = zone.traces.find(t => t.id === packet.traceId);
      if (trace && trace.cloud.status === 'pending') {
        trace.cloud = { status: 'queued', time: Date.now() };
        recordTraceStage(trace, 'queue', 'Cloud unreachable; message retained in local outbox');
      }
    }
  }
}

function communicate(id, trace = null) {
  const zone = g.zones[id];
  const summary = {
    id: zone.id, label: zone.label, crop: zone.crop, moisture: zone.moisture, temperature: zone.temperature,
    pump: zone.pump, waterLiters: zone.waterLiters, tick: zone.tick, decision: zone.modelDecision?.status, receivedAt: Date.now(),
    ...(trace ? { traceId: trace.id } : {})
  };
  g.pending[id].push(summary);
  if (g.pending[id].length > 600) g.pending[id].shift();
  if (g.cloud.online) flushCloud(id);
  else {
    if (trace) {
      trace.cloud = { status: 'queued', time: Date.now() };
      recordTraceStage(trace, 'queue', 'Cloud unreachable; message retained in local outbox');
    }
  }

  if (trace || zone.tick % 3 === 0) {
    for (const peerId of ids) {
      if (peerId === id) continue;
      if (trace) trace.peers[peerId] = { status: 'pending', time: Date.now() };
      if (g.nodeOnline[peerId]) {
        const peer = g.zones[peerId];
        peer.peerReadings[id] = {
          id, label: zone.label, temperature: zone.temperature, moisture: zone.moisture,
          decision: String(zone.modelDecision?.status || ''), traceId: trace?.id || null, time: Date.now()
        };
        if (trace) {
          trace.peers[peerId] = { status: 'delivered', time: Date.now() };
          recordTraceStage(trace, 'peer', 'Peer fog node ' + peerId + ' acknowledged direct packet');
        }
      } else {
        delete g.zones[id].peerReadings?.[peerId];
        if (trace) {
          trace.peers[peerId] = { status: 'unreachable', time: Date.now() };
          recordTraceStage(trace, 'peer', 'Peer fog node ' + peerId + ' unreachable');
        }
      }
    }
  }
}

function tickZone(id, trace = null) {
  const zone = g.zones[id];
  simulateTick(zone, g.models[id]);
  if (trace) {
    trace.decision = { ...zone.modelDecision };
    trace.pump = zone.pump;
    recordTraceStage(trace, 'inference', 'Local model predicted ' + Math.round(trace.decision.probability * 100) + '% irrigation demand');
    recordTraceStage(trace, 'pump', zone.pump ? 'Local pump switched ON' : 'Local pump held OFF');
  }
  communicate(id, trace);
}

function advanceSimulation() {
  const now = Date.now();
  for (const id of ids) {
    if (!g.nodeOnline[id]) continue;
    const zone = g.zones[id];
    const interval = Math.max(250, Math.round(1400 / (zone.speed || 1)));
    let steps = Math.floor((now - g.lastSim[id]) / interval);
    steps = Math.min(Math.max(steps, 0), 8); // cap catch-up work per request
    for (let i = 0; i < steps; i++) tickZone(id);
    if (steps > 0) g.lastSim[id] += steps * interval;
    if (now - g.lastSim[id] > interval * 4) g.lastSim[id] = now;
  }
}

function nodeSnapshot(id) {
  if (!g.nodeOnline[id]) {
    const label = { north: 'North Field', east: 'East Orchard', south: 'South Greenhouse' }[id];
    return { id, label, offline: true, events: [], history: [] };
  }
  return { ...snapshot(g.zones[id], g.models[id], g.cloud.online), pid: 0, queuedPackets: g.pending[id].length, offline: false };
}

export function getState() {
  advanceSimulation();
  for (const id of ids) if (g.nodeOnline[id]) flushCloud(id);
  const nodes = ids.map(nodeSnapshot);
  const cloud = g.cloud.online ? cloudState() : null;
  return {
    time: Date.now(),
    nodes,
    cloud,
    cloudOnline: !!cloud,
    simulation: true,
    project: 'AgroFog AI',
    localNodesOnline: nodes.filter(n => !n.offline).length,
    vercel: true,
  };
}

export function postNode(input) {
  const id = input?.id;
  if (!peers[id]) throw Object.assign(new Error('Unknown fog node'), { status: 400 });
  if (!['scenario', 'mode', 'pump', 'reset', 'inject'].includes(input?.type)) throw Object.assign(new Error('Invalid action'), { status: 400 });
  if (!g.nodeOnline[id]) throw Object.assign(new Error('Fog node is offline'), { status: 502 });
  ensureZone(id);
  const zone = g.zones[id];
  const model = g.models[id];

  if (input.type === 'inject') {
    const v = input.value;
    const limits = { moisture: [0, 100], temperature: [-10, 60], humidity: [0, 100], rain: [0, 100] };
    if (!v || typeof v !== 'object' || Array.isArray(v) || Object.entries(limits).some(([key, [min, max]]) =>
      typeof v[key] !== 'number' || !Number.isFinite(v[key]) || v[key] < min || v[key] > max))
      throw Object.assign(new Error('Invalid sensor readings. Enter numeric values in the permitted ranges.'), { status: 400 });
    const trace = injectReading(zone, v, randomUUID());
    tickZone(id, trace);
    return { ok: true, traceId: trace.id, state: nodeSnapshot(id) };
  }
  if (input.type === 'scenario') {
    applyScenario(zone, input.value);
    tickZone(id);
  } else if (input.type === 'mode') {
    if (!['auto', 'manual'].includes(input.value)) throw Object.assign(new Error('Invalid mode'), { status: 400 });
    zone.mode = input.value;
    addEvent(zone, 'control', zone.mode === 'auto' ? 'AI autonomy restored' : 'Manual pump control enabled');
    tickZone(id);
  } else if (input.type === 'pump') {
    if (zone.mode !== 'manual' || typeof input.value !== 'boolean') throw Object.assign(new Error('Enable manual mode first'), { status: 400 });
    zone.manualPump = input.value;
    addEvent(zone, 'control', input.value ? 'Pump switched ON manually' : 'Pump switched OFF manually');
    tickZone(id);
  } else if (input.type === 'reset') {
    g.zones[id] = makeZone(id);
    g.pending[id] = [];
    g.lastSim[id] = Date.now();
    tickZone(id);
  }
  return { ok: true, state: nodeSnapshot(id) };
}

export function postSpeed(input) {
  if (![1, 2, 4].includes(input?.speed)) throw Object.assign(new Error('Invalid speed'), { status: 400 });
  let updated = 0;
  for (const id of ids) {
    if (!g.nodeOnline[id]) continue;
    g.zones[id].speed = input.speed;
    addEvent(g.zones[id], 'system', 'Simulation speed set to ' + input.speed + '×');
    updated++;
  }
  return { ok: true, updated };
}

export function postSystem(input) {
  const { action, service } = input || {};
  if (!['cloud', 'north', 'east', 'south', 'all'].includes(service) || !['stop', 'start', 'reset'].includes(action))
    throw Object.assign(new Error('Invalid system command'), { status: 400 });

  if (action === 'reset' && service === 'all') {
    const next = freshState();
    Object.assign(g, next);
    // tick once for visible initial state
    for (const id of ids) tickZone(id);
    return { ok: true, action, service };
  }
  if (service === 'cloud') {
    if (action === 'stop') {
      g.cloud.online = false;
      for (const id of ids) if (g.nodeOnline[id]) addEvent(g.zones[id], 'cloud', 'Cloud disconnected; telemetry will buffer locally');
    } else if (action === 'start') {
      g.cloud.online = true;
      g.cloud.start = Date.now();
      for (const id of ids) if (g.nodeOnline[id]) { flushCloud(id); addEvent(g.zones[id], 'cloud', 'Cloud reconnected; buffered telemetry replayed'); }
    } else throw Object.assign(new Error('Invalid system action'), { status: 400 });
    return { ok: true, action, service };
  }
  if (!ids.includes(service)) throw Object.assign(new Error('Unknown service'), { status: 400 });
  if (action === 'stop') {
    g.nodeOnline[service] = false;
  } else if (action === 'start') {
    g.nodeOnline[service] = true;
    g.zones[service] = makeZone(service);
    g.pending[service] = [];
    g.lastSim[service] = Date.now();
    tickZone(service);
  } else throw Object.assign(new Error('Invalid system action'), { status: 400 });
  return { ok: true, action, service };
}
