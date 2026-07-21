// server/handlers.js — Lógica de las rutas (pura y testeable, sin red)
// ═══════════════════════════════════════════════════════════════════════════════
// Cada handler recibe un `runner(text, values) => Promise<rows>` inyectado, para
// poder testear el contrato sin una base real (ver test/contract.test.mjs).

import { buildBuscarQuery } from './sigec.js';

// Verifica la key publicable read-only (gate del API, NO es la cadena de Postgres).
// Si SIGEC_API_KEY no está configurada, el endpoint es abierto (datos públicos).
export function checkAuth(headers, apiKey) {
  if (!apiKey) return true;
  const h = k => headers[k] || headers[k.toLowerCase()] || '';
  const bearer = String(h('authorization')).replace(/^Bearer\s+/i, '').trim();
  const apikey = String(h('apikey')).trim();
  return apikey === apiKey || bearer === apiKey;
}

// POST /rest/v1/rpc/sigec_buscar
// body: { p_comuna, p_query, p_limite?, p_umbral? }  → filas del contrato SIGEC
export async function handleBuscar(schema, runner, body) {
  const b = body || {};
  const query = String(b.p_query ?? '').trim();
  if (!query) return { status: 200, json: [] };

  const q = buildBuscarQuery(schema, {
    comuna: b.p_comuna,
    query,
    limite: b.p_limite
  });
  const rows = await runner(q.text, q.values);
  return { status: 200, json: rows };
}

// POST /rest/v1/rpc/sigec_registrar_seleccion — no-op seguro por defecto.
// (El aprendizaje de ranking es opcional; si no hay tabla de log, no falla.)
export async function handleRegistrar() {
  return { status: 204, json: null };
}
