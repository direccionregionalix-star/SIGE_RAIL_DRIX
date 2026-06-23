// reporter.js — Reporte de avance SIGE → SIGEA (vía repo GitHub sigea_estado)
// ═══════════════════════════════════════════════════════════════════════════════
// Publica un snapshot de avance a `sige/{usuario}.json` en el repo de estado que
// el SIGEA ya usa. Un archivo POR FUNCIONARIO para evitar colisiones de SHA en
// la API de GitHub (dos analistas escribiendo a la vez al mismo archivo fallaría).
//
// El usuario y el token (fine-grained, permiso "contents" SOLO sobre el repo de
// estado) se configuran en el modal ⚙ y viven en el localStorage de cada PC.
// El token NO está en este código, por lo que no queda expuesto en el sitio
// público de Netlify.
//
// Privacidad: solo viajan AGREGADOS (conteos por tipo, porcentajes, nombre de
// archivo). Ningún RUT, dirección ni coordenada individual sale del browser.
//
// Disparadores:
//   1. Timer: cada INTERVAL_MIN minutos, solo si el avance cambió desde el último push
//   2. Al exportar (Esri JSON / Append) — foto del estado entregado
//   3. Botón manual "Reportar ahora" en el modal ⚙

import { state } from './store.js';

// ── Configuración ───────────────────────────────────────────────
const REPO         = 'SebaGeoZ92/sigea_estado'; // owner/repo del estado publicado
const BRANCH       = 'main';
const INTERVAL_MIN = 30;                 // minutos mínimos entre pushes automáticos
const TICK_MS      = 5 * 60 * 1000;      // el timer revisa cada 5 min si corresponde

const LS_USER  = 'sige_reporter_user';
const LS_TOKEN = 'sige_reporter_token';
const LS_LAST  = 'sige_reporter_last';   // { ts, hash } del último push exitoso

let _timer = null;
let _lastResult = null;                  // { ok, ts, msg } para mostrar en la UI

// ── Config helpers ──────────────────────────────────────────────
export function getConfig() {
  return {
    user:  (localStorage.getItem(LS_USER)  || '').trim(),
    token: (localStorage.getItem(LS_TOKEN) || '').trim()
  };
}

export function saveConfig(user, token) {
  localStorage.setItem(LS_USER,  (user  || '').trim());
  localStorage.setItem(LS_TOKEN, (token || '').trim());
}

export function isConfigured() {
  const { user, token } = getConfig();
  return Boolean(user && token);
}

export function getStatus() {
  return { configured: isConfigured(), last: _lastResult, intervalMin: INTERVAL_MIN };
}

// ── Snapshot del avance ─────────────────────────────────────────
function extractRecinto(fileName) {
  // El SIGEA nombra "{cod_recinto}_{nombre}_padron" → tomamos el primer bloque de dígitos
  const m = String(fileName || '').match(/\d{3,6}/);
  return m ? m[0] : null;
}

export function buildSnapshot() {
  const clusters = Object.values(state.clusters || {});
  if (!clusters.length) return null;

  const conf = { EXACTO: 0, CALLE: 0, LOCALIDAD: 0, NO_GEO: 0 };
  let totalRows = 0, pendientes = 0, porRevisar = 0;

  clusters.forEach(c => {
    c.rows.forEach(r => {
      totalRows++;
      const tipo = r.tipo || c.tipo;
      const review = r.needsReview || c.needsReview;
      if (!tipo)  { pendientes++; return; }
      if (review) { porRevisar++; return; }
      const key = tipo === 'NO GEO' ? 'NO_GEO' : (tipo === 'RURAL' ? 'LOCALIDAD' : tipo);
      if (key in conf) conf[key]++;
    });
  });

  const confirmados = conf.EXACTO + conf.CALLE + conf.LOCALIDAD + conf.NO_GEO;

  return {
    usuario:     getConfig().user || null,
    recinto_cod: extractRecinto(state.origFileName),
    archivo:     state.origFileName || null,
    timestamp:   new Date().toISOString(),
    avance: {
      total_registros:   totalRows,
      total_clusters:    clusters.length,
      confirmados:       conf,
      confirmados_total: confirmados,
      por_revisar:       porRevisar,
      pendientes:        pendientes,
      pct: totalRows ? Math.round((confirmados / totalRows) * 1000) / 10 : 0
    },
    origen: 'SIGE 4.1'
  };
}

// Hash simple del avance para detectar si hubo cambios desde el último push
function snapshotHash(snap) {
  return snap ? JSON.stringify(snap.avance) + '|' + snap.archivo : '';
}

// ── GitHub Contents API ─────────────────────────────────────────
function toBase64Utf8(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  bytes.forEach(b => { bin += String.fromCharCode(b); });
  return btoa(bin);
}

function sanitizeUser(user) {
  // Solo alfanuméricos, guion y guion bajo — evita rutas raras en el repo
  return String(user || '').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 40);
}

async function ghGetSha(path, token) {
  const res = await fetch(`https://api.github.com/repos/${REPO}/contents/${path}?ref=${BRANCH}`, {
    headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github+json' }
  });
  if (res.status === 404) return null;        // el archivo aún no existe → primer push
  if (!res.ok) throw new Error(`GitHub GET ${res.status}`);
  const data = await res.json();
  return data.sha || null;
}

async function ghPutFile(path, contentObj, token, sha) {
  const body = {
    message: `SIGE avance ${contentObj.usuario || ''} ${contentObj.recinto_cod || ''} (${contentObj.avance?.pct ?? 0}%)`.trim(),
    content: toBase64Utf8(JSON.stringify(contentObj, null, 2)),
    branch:  BRANCH
  };
  if (sha) body.sha = sha;

  const res = await fetch(`https://api.github.com/repos/${REPO}/contents/${path}`, {
    method:  'PUT',
    headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github+json', 'Content-Type': 'application/json' },
    body:    JSON.stringify(body)
  });
  if (!res.ok) {
    const errTxt = await res.text().catch(() => '');
    throw new Error(`GitHub PUT ${res.status}: ${errTxt.slice(0, 120)}`);
  }
  return true;
}

// ── Push ────────────────────────────────────────────────────────
/**
 * Publica el snapshot actual.
 * @param {string} trigger - 'timer' | 'export' | 'manual'
 * @param {boolean} force  - true ignora el throttle y el hash (manual/export)
 * @returns {Promise<{ok:boolean, msg:string}>}
 */
export async function pushReport(trigger = 'manual', force = false) {
  if (!isConfigured()) {
    return setResult(false, 'Configura usuario y token en ⚙');
  }

  const snap = buildSnapshot();
  if (!snap) {
    return setResult(false, 'Sin datos cargados — nada que reportar');
  }

  // Throttle + detección de cambios (solo para el timer)
  const last = readLast();
  const hash = snapshotHash(snap);
  if (!force) {
    const elapsedMin = (Date.now() - (last.ts || 0)) / 60000;
    if (elapsedMin < INTERVAL_MIN) return { ok: true, msg: 'throttled' };
    if (hash === last.hash)        return { ok: true, msg: 'sin cambios' };
  }

  const { user, token } = getConfig();
  const cleanUser = sanitizeUser(user);
  if (!cleanUser) return setResult(false, 'Usuario inválido');
  const path = `sige/${cleanUser}.json`;

  try {
    const sha = await ghGetSha(path, token);
    await ghPutFile(path, snap, token, sha);
    writeLast({ ts: Date.now(), hash });
    console.log(`📡 SIGE reportó avance (${trigger}): ${snap.avance.pct}% → ${REPO}/${path}`);
    return setResult(true, `Reportado ${snap.avance.pct}% (${new Date().toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })})`);
  } catch (err) {
    console.warn('📡 Reporte SIGE falló:', err.message);
    if (err.message.includes('401') || err.message.includes('403')) {
      return setResult(false, 'Token inválido o sin permisos');
    }
    if (err.message.includes('409')) {
      return setResult(false, 'Conflicto de escritura — reintenta en un momento');
    }
    return setResult(false, 'Error de red — se reintentará');
  }
}

function setResult(ok, msg) {
  _lastResult = { ok, ts: Date.now(), msg };
  const el = document.getElementById('reporter-status');
  if (el) {
    el.className = 'api-status ' + (ok ? 'api-ok' : 'api-empty');
    el.textContent = msg;
  }
  return { ok, msg };
}

function readLast() {
  try { return JSON.parse(localStorage.getItem(LS_LAST) || '{}'); } catch { return {}; }
}
function writeLast(obj) {
  localStorage.setItem(LS_LAST, JSON.stringify(obj));
}

// ── Ciclo de vida ───────────────────────────────────────────────
export function init() {
  if (_timer) return;
  _timer = setInterval(() => { pushReport('timer', false); }, TICK_MS);
  console.log(`📡 Reporter SIGE activo — push automático cada ${INTERVAL_MIN} min si hay cambios.`);
}

export function stop() {
  if (_timer) { clearInterval(_timer); _timer = null; }
}
