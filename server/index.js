// server/index.js — Backend HTTP del SIGEC de Los Ríos (delante de Neon)
// ═══════════════════════════════════════════════════════════════════════════════
// Capa mínima que el SIGE estático puede consumir por HTTPS. Réplica del contrato
// PostgREST que ya usa js/sigec-client.js:
//   POST /rest/v1/rpc/sigec_buscar
//   POST /rest/v1/rpc/sigec_registrar_seleccion
//
// SEGURIDAD:
//   · DATABASE_URL (cadena de Neon) vive SOLO como env del servidor.
//   · SIGEC_API_KEY (opcional) es una key publicable read-only del API, no la BD.
//   · CORS restringido a CORS_ORIGIN (default '*' para pruebas).
//
// Deploy: Railway (Nixpacks). Ver server/README.md.

import http from 'node:http';
import { schemaFromEnv } from './sigec.js';
import { checkAuth, handleBuscar, handleRegistrar } from './handlers.js';
import { runQuery } from './db.js';

const PORT        = process.env.PORT || 3000;
const API_KEY     = process.env.SIGEC_API_KEY || '';
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';
const SCHEMA      = schemaFromEnv();

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', CORS_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'authorization, apikey, content-type');
  res.setHeader('Access-Control-Max-Age', '86400');
}

function send(res, status, json) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(json === null ? '' : JSON.stringify(json));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => { data += c; if (data.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return send(res, 204, null);

  const url = req.url.split('?')[0];

  if (req.method === 'GET' && (url === '/' || url === '/health')) {
    return send(res, 200, { ok: true, service: 'sigec-los-rios', table: SCHEMA.table });
  }

  if (req.method === 'POST' && url.endsWith('/rpc/sigec_buscar')) {
    if (!checkAuth(req.headers, API_KEY)) return send(res, 401, { error: 'no autorizado' });
    try {
      const body = await readBody(req);
      const r = await handleBuscar(SCHEMA, runQuery, body);
      return send(res, r.status, r.json);
    } catch (e) {
      return send(res, 500, { error: 'SIGEC error', detail: String(e.message).slice(0, 200) });
    }
  }

  if (req.method === 'POST' && url.endsWith('/rpc/sigec_registrar_seleccion')) {
    if (!checkAuth(req.headers, API_KEY)) return send(res, 401, { error: 'no autorizado' });
    const r = await handleRegistrar();
    return send(res, r.status, r.json);
  }

  return send(res, 404, { error: 'no encontrado' });
});

server.listen(PORT, () => {
  console.log(`SIGEC Los Ríos escuchando en :${PORT} (tabla ${SCHEMA.table}, fuzzy ${SCHEMA.fuzzy})`);
});
