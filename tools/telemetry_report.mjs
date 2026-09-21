// tools/telemetry_report.mjs — Lee el JSON de medición y dice qué hacer con él.
// ═══════════════════════════════════════════════════════════════════════════════
// Uso:  node tools/telemetry_report.mjs sige_telemetria_14_2026-09-30.json [...]
//
// Acepta varios archivos (uno por analista) y los suma antes de analizar. La
// gracia no es el volcado de contadores sino la sección DIAGNÓSTICO: umbrales
// explícitos que convierten un número en una acción concreta sobre el SIGE.
//
// Los umbrales de abajo son HIPÓTESIS DE PARTIDA, no verdades. La primera
// medición de Los Ríos sirve justamente para calibrarlos; cuando haya línea
// base real, se ajustan aquí y queda documentado el porqué.

import { readFileSync } from 'node:fs';

const UMBRALES = {
  pctNoGeo:            15,    // % NO GEO sobre el total clasificado
  tasaReclasificacion: 10,    // % de clusters que se reclasifican
  msDecision:          45000, // ms promedio para decidir un cluster
  tasaExitoGeocoder:   70,    // % mínimo de éxito de un motor para considerarlo sano
  msGeocoder:          3000   // ms promedio tolerable por consulta
};

const archivos = process.argv.slice(2);
if (!archivos.length) {
  console.error('Uso: node tools/telemetry_report.mjs <archivo.json> [más archivos...]');
  process.exit(2);
}

// ── Suma recursiva de contadores ──────────────────────────────────────────────
function sumar(a, b) {
  if (b === null || b === undefined) return a;
  if (typeof b === 'number') return (typeof a === 'number' ? a : 0) + b;
  if (typeof b !== 'object') return a === undefined ? b : a;
  const out = (typeof a === 'object' && a !== null) ? { ...a } : {};
  for (const [k, v] of Object.entries(b)) out[k] = sumar(out[k], v);
  return out;
}

const docs = archivos.map(f => {
  try { return JSON.parse(readFileSync(f, 'utf8')); }
  catch (e) { console.error(`✗ No se pudo leer ${f}: ${e.message}`); process.exit(2); }
});

for (const d of docs) {
  if (d.schema !== 1) console.error(`⚠ ${archivos[docs.indexOf(d)]}: schema ${d.schema}, se esperaba 1`);
}

// La metadata no se suma (son strings); se toma la del primero y se cuenta equipos.
const meta = docs[0].meta || {};
const total = docs
  .map(d => ({ padron: d.padron, clasificacion: d.clasificacion, geocoder: d.geocoder, acciones: d.acciones, exportes: d.exportes }))
  .reduce((a, b) => sumar(a, b));

// ── Derivados ─────────────────────────────────────────────────────────────────
const cl = total.clasificacion || {};
const totalCl = (cl.EXACTO || 0) + (cl.CALLE || 0) + (cl.LOCALIDAD || 0) + (cl['NO GEO'] || 0);
const pct = n => totalCl ? +((n / totalCl) * 100).toFixed(1) : null;
const prom = h => (h && h.n) ? Math.round(h.sumaMs / h.n) : null;
const tasaOk = m => (m && m.llamadas) ? +((m.ok / m.llamadas) * 100).toFixed(1) : null;

const ind = {
  equipos: docs.length,
  clustersClasificados: totalCl,
  pctExacto: pct(cl.EXACTO || 0),
  pctCalle: pct(cl.CALLE || 0),
  pctLocalidad: pct(cl.LOCALIDAD || 0),
  pctNoGeo: pct(cl['NO GEO'] || 0),
  tasaReclasificacion: totalCl ? +(((cl.reclasificaciones || 0) / totalCl) * 100).toFixed(1) : null,
  msDecision: prom(cl.tiempoDecision)
};

// ── Salida ────────────────────────────────────────────────────────────────────
const fmt = (v, suf = '') => (v === null || v === undefined) ? 's/d' : `${v}${suf}`;
const linea = (k, v) => console.log(`  ${k.padEnd(34)} ${v}`);

console.log(`\n▎ SIGE — medición de uso`);
linea('Región', `${meta.regionNombre || '?'} (${meta.region || '?'})`);
linea('Equipos agregados', String(docs.length));
linea('Ventana', `${(meta.creado || '?').slice(0, 10)} → ${(docs[0].meta?.actualizado || '?').slice(0, 10)}`);

console.log(`\n▎ Padrón`);
linea('Cargas', String(total.padron?.cargas ?? 0));
linea('Filas procesadas', String(total.padron?.filas ?? 0));
linea('Clusters generados', String(total.padron?.clusters ?? 0));
linea('Formato de CUT visto', Object.entries(total.padron?.cutLargo || {}).map(([k, v]) => `${k}: ${v}`).join(' · ') || 's/d');
const noRes = Object.entries(total.padron?.cutNoResueltos || {}).sort((a, b) => b[1] - a[1]);
linea('CUT sin resolver (distintos)', String(noRes.length));
if (noRes.length) console.log(`    top: ${noRes.slice(0, 10).map(([k, v]) => `${k}×${v}`).join(', ')}`);

console.log(`\n▎ Clasificación (contrato SIGE)`);
linea('Clusters clasificados', String(totalCl));
linea('EXACTO', fmt(ind.pctExacto, '%'));
linea('CALLE', fmt(ind.pctCalle, '%'));
linea('LOCALIDAD', fmt(ind.pctLocalidad, '%'));
linea('NO GEO', fmt(ind.pctNoGeo, '%'));
linea('Reclasificaciones', fmt(ind.tasaReclasificacion, '%'));
linea('Tiempo medio de decisión', fmt(ind.msDecision, ' ms'));

console.log(`\n▎ Geocodificadores`);
for (const [nombre, m] of Object.entries(total.geocoder || {})) {
  if (!m || !m.llamadas) { linea(nombre, 'sin uso'); continue; }
  linea(nombre, `${m.llamadas} consultas · éxito ${fmt(tasaOk(m), '%')} · sin resultado ${m.sinResultado} · error ${m.error} · ${fmt(prom(m.latencia), ' ms')}`);
}

console.log(`\n▎ Acciones`);
const ac = total.acciones || {};
linea('Pin manual', String(ac.pinManual ?? 0));
linea('SIGEC indisponible (intentos)', String(ac.sigecIndisponible ?? 0));
linea('Auto-Urbanos', `${ac.autoUrbanos?.corridas ?? 0} corridas · ${ac.autoUrbanos?.exitosos ?? 0} con match · ${ac.autoUrbanos?.sinMatch ?? 0} sin match`);
linea('Reasignación de recintos', `${ac.reasignacion?.filasCruzadas ?? 0} cruzadas · ${ac.reasignacion?.sinIdentificar ?? 0} sin identificar`);

// ── Diagnóstico ───────────────────────────────────────────────────────────────
console.log(`\n▎ Diagnóstico`);
const hallazgos = [];

if (noRes.length) {
  hallazgos.push([
    'ALTA',
    `${noRes.length} código(s) de comuna que el region_config no resuelve.`,
    'Revisar si es un formato de CUT distinto al oficial de 5 dígitos. Si el formato es estable y legítimo, agregar el mapeo explícito a js/region-config.js (con su fuente documentada); si viene sucio del origen, corregirlo aguas arriba, no en el SIGE.'
  ]);
}
if (ind.pctNoGeo !== null && ind.pctNoGeo > UMBRALES.pctNoGeo) {
  hallazgos.push([
    'ALTA',
    `NO GEO en ${ind.pctNoGeo}% (umbral ${UMBRALES.pctNoGeo}%).`,
    'Cada NO GEO conserva la coordenada original del padrón: es deuda que vuelve. Cruzar con los CUT/comunas más frecuentes en NO GEO — si se concentra en pocas comunas rurales, el problema es falta de maestro de localidades, no del operador.'
  ]);
}
if (ind.tasaReclasificacion !== null && ind.tasaReclasificacion > UMBRALES.tasaReclasificacion) {
  hallazgos.push([
    'MEDIA',
    `${ind.tasaReclasificacion}% de clusters se reclasifican (umbral ${UMBRALES.tasaReclasificacion}%).`,
    'Reclasificar es dudar. Suele indicar que el criterio EXACTO/CALLE/LOCALIDAD no está claro en la UI o que la pre-clasificación automática propone mal. Revisar preClassifyCluster y el texto de los botones.'
  ]);
}
if (ind.msDecision !== null && ind.msDecision > UMBRALES.msDecision) {
  hallazgos.push([
    'MEDIA',
    `${Math.round(ind.msDecision / 1000)}s promedio por cluster (umbral ${UMBRALES.msDecision / 1000}s).`,
    'Ver si el tiempo se va esperando al geocoder (comparar con la latencia de abajo) o buscando a mano. Si es lo primero, cachear o precargar; si es lo segundo, el problema es de contexto en pantalla.'
  ]);
}
for (const [nombre, m] of Object.entries(total.geocoder || {})) {
  if (!m || !m.llamadas) continue;
  const t = tasaOk(m), ms = prom(m.latencia);
  if (t !== null && t < UMBRALES.tasaExitoGeocoder) {
    hallazgos.push(['ALTA', `${nombre}: solo ${t}% de éxito en ${m.llamadas} consultas.`,
      m.error > m.sinResultado
        ? 'Predominan ERRORES, no "sin resultado": es infraestructura (endpoint caído, CORS, rate limit), no calidad de dirección.'
        : 'Predomina "sin resultado": es calidad de la dirección o del catastro. Revisar la normalización antes de culpar al motor.']);
  }
  if (ms !== null && ms > UMBRALES.msGeocoder) {
    hallazgos.push(['BAJA', `${nombre}: ${ms} ms por consulta (umbral ${UMBRALES.msGeocoder} ms).`,
      'A este ritmo el Auto-Urbanos sobre miles de registros es inviable en una jornada. Medir si conviene lote nocturno.']);
  }
}
if ((ac.sigecIndisponible ?? 0) > 0) {
  hallazgos.push(['ALTA', `${ac.sigecIndisponible} intento(s) de usar SIGEC sin catastro regional disponible.`,
    'El operador está buscando una capacidad que la región no tiene. O se levanta el catastro XIV, o se le quita el botón de la vista para no gastarle tiempo.']);
}
if ((ac.reasignacion?.sinIdentificar ?? 0) > 0) {
  const sin = ac.reasignacion.sinIdentificar, cru = ac.reasignacion.filasCruzadas || 0;
  const p = (cru + sin) ? +((sin / (cru + sin)) * 100).toFixed(1) : 0;
  hallazgos.push([p > 10 ? 'ALTA' : 'MEDIA', `${sin} filas de reasignación sin identificar (${p}% de las procesadas).`,
    'El cruce por nombre de recinto no alcanza. Vale más pedir el código de recinto en la planilla de origen que seguir afinando el fuzzy.']);
}

if (!hallazgos.length) {
  console.log('  Sin hallazgos sobre umbral. Ojo: con poco volumen esto no significa que todo esté bien,');
  console.log('  significa que todavía no hay evidencia suficiente. Revisar de nuevo con más jornadas medidas.');
} else {
  const orden = { ALTA: 0, MEDIA: 1, BAJA: 2 };
  hallazgos.sort((a, b) => orden[a[0]] - orden[b[0]]);
  for (const [sev, qué, acción] of hallazgos) {
    console.log(`\n  [${sev}] ${qué}`);
    console.log(`         → ${acción}`);
  }
}
console.log('');
