// telemetry.js — Medición local del USO del SIGE (opt-in, sin red)
// ═══════════════════════════════════════════════════════════════════════════════
// Por qué existe
// ─────────────
// Hasta ahora las mejoras al SIGE se decidían por intuición: "parece que se
// demoran en los rurales", "parece que Nominatim falla harto". Este módulo
// convierte esas frases en números, para que la transferencia tecnológica a
// Los Ríos se ajuste con evidencia y no con supuestos.
//
// Qué NO es
// ─────────
// · NO es el reporter (js/reporter.js). El reporter publica AVANCE (cuánto se
//   lleva georreferenciado) a un repo de estado, con token por funcionario.
//   Esto mide USO (cómo se llega a ese avance) y NO sale nunca del navegador.
// · NO manda nada por red. No hay fetch en este archivo. A propósito: es padrón
//   electoral y el sitio es público.
// · NO guarda datos personales. Nunca RUN, nunca dirección, nunca coordenada
//   individual. Solo CONTADORES, HISTOGRAMAS y códigos de comuna (CUT), que son
//   territorio, no persona.
//
// Cómo se activa
// ──────────────
// Apagado por defecto. El operador lo enciende en ⚙ APIs → "Medición de uso".
// Los datos viven en el localStorage de SU PC y se entregan con un botón que
// descarga un JSON. Ese JSON se analiza con `node tools/telemetry_report.mjs`.
//
// Regla de oro: este módulo JAMÁS puede romper el SIGE. Todo va envuelto en
// try/catch y cualquier fallo es silencioso — medir no puede costarle el turno
// a nadie.

import { REGION_CONFIG } from './region-config.js';

export const SCHEMA_VERSION = 1;

const LS_ON   = 'sige_telemetry_on';
const LS_DATA = 'sige_telemetry_v1';

const MAX_CUT_KEYS = 200;   // tope del histograma de CUT no resueltos
const MAX_COL_KEYS = 60;    // tope del histograma de encabezados no reconocidos

// Buckets de latencia en ms. Sirven para sacar una mediana aproximada sin
// guardar cada medición (que sería una serie temporal, y eso ya es rastro).
const BUCKETS = [250, 500, 1000, 2000, 4000, 8000, Infinity];
const BUCKET_LABELS = ['<250ms', '<500ms', '<1s', '<2s', '<4s', '<8s', '>=8s'];

// ── Estado en memoria ─────────────────────────────────────────────────────────
let _data = null;
let _openedAt = 0;      // timestamp de apertura del cluster en foco
let _openedKey = '';

function nowMs() { return Date.now(); }

function vacio() {
  return {
    schema: SCHEMA_VERSION,
    meta: {
      region: (REGION_CONFIG && REGION_CONFIG.regionCode) || '',
      regionNombre: (REGION_CONFIG && REGION_CONFIG.regionName) || '',
      creado: new Date().toISOString(),
      actualizado: null,
      sesiones: 0
    },
    padron: {
      cargas: 0,
      filas: 0,
      clusters: 0,
      // Largo del CUT tal como viene en la planilla: detecta planillas con
      // formato distinto al que el region_config sabe resolver.
      cutLargo: {},
      cutNoResueltos: {},
      columnasNoReconocidas: {}
    },
    clasificacion: {
      // Conteo final por dominio del contrato SIGE.
      EXACTO: 0, CALLE: 0, LOCALIDAD: 0, 'NO GEO': 0,
      // Cambios de tipo sobre un cluster YA clasificado: proxy de duda/reproceso.
      reclasificaciones: 0,
      // Distribución del tiempo desde que se abre el cluster hasta que se decide.
      tiempoDecision: histoVacio()
    },
    geocoder: {
      nominatim: motorVacio(),
      sigec: motorVacio(),
      google: motorVacio()
    },
    acciones: {
      pinManual: 0,
      autoUrbanos: { corridas: 0, candidatos: 0, exitosos: 0, sinMatch: 0 },
      reasignacion: { filasCruzadas: 0, sinIdentificar: 0, ignoradas: 0 },
      sigecIndisponible: 0     // veces que se intentó SIGEC sin endpoint válido
    },
    exportes: {}
  };
}

function motorVacio() {
  return { llamadas: 0, ok: 0, sinResultado: 0, error: 0, latencia: histoVacio() };
}
function histoVacio() {
  const h = { n: 0, sumaMs: 0 };
  BUCKET_LABELS.forEach(l => { h[l] = 0; });
  return h;
}

function anotaHisto(h, ms) {
  if (!h || !isFinite(ms) || ms < 0) return;
  h.n++;
  h.sumaMs += Math.round(ms);
  for (let i = 0; i < BUCKETS.length; i++) {
    if (ms < BUCKETS[i]) { h[BUCKET_LABELS[i]]++; return; }
  }
}

function bump(obj, clave, tope) {
  if (!obj || clave === '' || clave === null || clave === undefined) return;
  const k = String(clave).slice(0, 40);
  if (!(k in obj) && tope && Object.keys(obj).length >= tope) return;  // no crece sin control
  obj[k] = (obj[k] || 0) + 1;
}

// ── Persistencia ──────────────────────────────────────────────────────────────
function load() {
  if (_data) return _data;
  try {
    const raw = localStorage.getItem(LS_DATA);
    const parsed = raw ? JSON.parse(raw) : null;
    _data = (parsed && parsed.schema === SCHEMA_VERSION) ? parsed : vacio();
  } catch (e) { _data = vacio(); }
  return _data;
}

function save() {
  try {
    if (!_data) return;
    _data.meta.actualizado = new Date().toISOString();
    localStorage.setItem(LS_DATA, JSON.stringify(_data));
  } catch (e) { /* cuota llena o storage bloqueado: seguimos sin medir */ }
}

/** Envuelve cualquier anotación: si falla, el SIGE ni se entera. */
function safe(fn) {
  return function (...args) {
    try {
      if (!isOn()) return;
      const d = load();
      fn(d, ...args);
      save();
    } catch (e) { /* medir nunca rompe */ }
  };
}

// ── Interruptor ───────────────────────────────────────────────────────────────
export function isOn() {
  try { return localStorage.getItem(LS_ON) === '1'; } catch (e) { return false; }
}

export function setOn(on) {
  try {
    localStorage.setItem(LS_ON, on ? '1' : '0');
    if (on) { load(); save(); }
  } catch (e) { /* noop */ }
}

export function reset() {
  try { _data = vacio(); localStorage.removeItem(LS_DATA); } catch (e) { /* noop */ }
}

// ── Anotaciones ───────────────────────────────────────────────────────────────

export const sesionInicio = safe((d) => { d.meta.sesiones++; });

/**
 * Padrón cargado y normalizado.
 * @param {object} info { filas, clusters, cuts:[], cutsNoResueltos:[], columnasNoReconocidas:[] }
 */
export const padronCargado = safe((d, info = {}) => {
  d.padron.cargas++;
  d.padron.filas += Number(info.filas) || 0;
  d.padron.clusters += Number(info.clusters) || 0;
  (info.cuts || []).forEach(c => {
    const dig = String(c ?? '').replace(/\D/g, '');
    bump(d.padron.cutLargo, dig ? `${dig.length} dígitos` : 'vacío', 12);
  });
  (info.cutsNoResueltos || []).forEach(c => bump(d.padron.cutNoResueltos, c, MAX_CUT_KEYS));
  (info.columnasNoReconocidas || []).forEach(c => bump(d.padron.columnasNoReconocidas, c, MAX_COL_KEYS));
});

/** Se abrió un cluster: arranca el cronómetro de decisión. */
export function clusterAbierto(key) {
  try {
    if (!isOn()) return;
    _openedAt = nowMs();
    _openedKey = String(key || '');
  } catch (e) { /* noop */ }
}

/** Se clasificó un cluster. `yaTenia` = tenía tipo antes (reclasificación). */
export const clasificado = safe((d, key, tipo, yaTenia) => {
  if (Object.prototype.hasOwnProperty.call(d.clasificacion, tipo)) d.clasificacion[tipo]++;
  if (yaTenia) d.clasificacion.reclasificaciones++;
  if (_openedAt && String(key || '') === _openedKey) {
    anotaHisto(d.clasificacion.tiempoDecision, nowMs() - _openedAt);
    _openedAt = 0; _openedKey = '';
  }
});

/**
 * Resultado de una consulta a un motor de geocodificación.
 * @param {'nominatim'|'sigec'|'google'} motor
 * @param {'ok'|'sinResultado'|'error'} resultado
 * @param {number} ms latencia medida
 */
export const geocoder = safe((d, motor, resultado, ms) => {
  const m = d.geocoder[motor];
  if (!m) return;
  m.llamadas++;
  if (resultado === 'ok') m.ok++;
  else if (resultado === 'sinResultado') m.sinResultado++;
  else m.error++;
  anotaHisto(m.latencia, ms);
});

export const pinManual = safe((d) => { d.acciones.pinManual++; });

export const sigecIndisponible = safe((d) => { d.acciones.sigecIndisponible++; });

export const autoUrbanos = safe((d, { candidatos = 0, exitosos = 0, sinMatch = 0 } = {}) => {
  const a = d.acciones.autoUrbanos;
  a.corridas++; a.candidatos += candidatos; a.exitosos += exitosos; a.sinMatch += sinMatch;
});

export const reasignacion = safe((d, { cruzadas = 0, sinIdentificar = 0, ignoradas = 0 } = {}) => {
  const r = d.acciones.reasignacion;
  r.filasCruzadas += cruzadas; r.sinIdentificar += sinIdentificar; r.ignoradas += ignoradas;
});

export const exporte = safe((d, nombre, filas) => {
  const k = String(nombre || 'desconocido');
  if (!d.exportes[k]) d.exportes[k] = { veces: 0, filas: 0 };
  d.exportes[k].veces++;
  d.exportes[k].filas += Number(filas) || 0;
});

// ── Lectura / entrega ─────────────────────────────────────────────────────────
export function snapshot() {
  try { return JSON.parse(JSON.stringify(load())); } catch (e) { return vacio(); }
}

/** Indicadores derivados: lo que en realidad se mira para decidir una mejora. */
export function indicadores() {
  const d = snapshot();
  const cl = d.clasificacion;
  const totalCl = cl.EXACTO + cl.CALLE + cl.LOCALIDAD + cl['NO GEO'];
  const pct = (n) => totalCl ? Math.round((n / totalCl) * 1000) / 10 : null;
  const medMotor = (m) => m.latencia.n ? Math.round(m.latencia.sumaMs / m.latencia.n) : null;
  const tasaOk = (m) => m.llamadas ? Math.round((m.ok / m.llamadas) * 1000) / 10 : null;

  return {
    clustersClasificados: totalCl,
    pctNoGeo: pct(cl['NO GEO']),
    pctExacto: pct(cl.EXACTO),
    pctLocalidad: pct(cl.LOCALIDAD),
    tasaReclasificacion: totalCl ? Math.round((cl.reclasificaciones / totalCl) * 1000) / 10 : null,
    msPromedioDecision: cl.tiempoDecision.n ? Math.round(cl.tiempoDecision.sumaMs / cl.tiempoDecision.n) : null,
    geocoder: {
      nominatim: { tasaExito: tasaOk(d.geocoder.nominatim), msPromedio: medMotor(d.geocoder.nominatim) },
      sigec:     { tasaExito: tasaOk(d.geocoder.sigec),     msPromedio: medMotor(d.geocoder.sigec) },
      google:    { tasaExito: tasaOk(d.geocoder.google),    msPromedio: medMotor(d.geocoder.google) }
    },
    cutNoResueltosDistintos: Object.keys(d.padron.cutNoResueltos).length,
    sigecIndisponible: d.acciones.sigecIndisponible
  };
}

/** Descarga el JSON de medición. Es el único "egreso" y lo dispara el operador. */
export function descargar() {
  try {
    const payload = { ...snapshot(), indicadores: indicadores() };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sige_telemetria_${(REGION_CONFIG && REGION_CONFIG.regionCode) || 'xx'}_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    return true;
  } catch (e) { return false; }
}
