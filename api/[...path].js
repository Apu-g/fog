import { getState, postNode, postSpeed, postSystem } from '../lib/vercel-runtime.js';

function send(res, code, data) {
  res.statusCode = code;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(data));
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body || '{}'); } catch { throw Object.assign(new Error('Invalid JSON'), { status: 400 }); }
  }
  let text = '';
  for await (const chunk of req) {
    text += chunk;
    if (text.length > 12000) throw Object.assign(new Error('Payload too large'), { status: 400 });
  }
  try { return JSON.parse(text || '{}'); } catch { throw Object.assign(new Error('Invalid JSON'), { status: 400 }); }
}

function routePath(req) {
  const q = req.query?.path;
  if (Array.isArray(q) && q.length) return '/api/' + q.join('/');
  if (typeof q === 'string' && q) return '/api/' + q;
  try {
    const url = new URL(req.url || '/', 'http://localhost');
    return url.pathname.replace(/\/+$/, '') || '/';
  } catch {
    return String(req.url || '/');
  }
}

export default async function handler(req, res) {
  const path = routePath(req);
  try {
    if (req.method === 'GET' && path === '/api/health') return send(res, 200, { ok: true, service: 'vercel-runtime' });
    if (req.method === 'GET' && path === '/api/state') return send(res, 200, getState());

    if (req.method === 'POST' && path === '/api/node') return send(res, 200, postNode(await readBody(req)));
    if (req.method === 'POST' && path === '/api/speed') return send(res, 200, postSpeed(await readBody(req)));
    if (req.method === 'POST' && path === '/api/system') return send(res, 200, postSystem(await readBody(req)));

    return send(res, 404, { error: 'No such API' });
  } catch (e) {
    const status = Number(e?.status) || (req.method === 'GET' ? 500 : 400);
    return send(res, status >= 400 ? status : 500, { error: e?.message || 'Request failed' });
  }
}
