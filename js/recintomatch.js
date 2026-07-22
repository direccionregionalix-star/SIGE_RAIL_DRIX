// recinto-match.js — Cruce "MOVER A ESTE RECINTO" (nombre) → recinto del maestro.
// ═══════════════════════════════════════════════════════════════════════════════
// Portado de cruzar_recinto_nuevo.py. Puro y testeable (sin DOM). Sirve para
// convertir el nombre del recinto destino en su coordenada base.
//
// Cascada de match (en orden), idéntica al script Python:
//   1. exacto (normalizado)
//   2. contención de texto (substring en cualquier sentido)
//   2b. contención por CONJUNTO DE PALABRAS (cubre "falta/sobra una palabra",
//       ej. "ESCUELA PATRICIO LYNCH" ⊆ "ESCUELA BASICA PATRICIO LYNCH")
//   3. similitud (último recurso, ≥ 0.90) → SIEMPRE marcado para revisar
//   4. sin identificar (no inventa coordenada)
//
// MEJORA sobre el script original: se filtra PRIMERO por la comuna del elector
// (COMI ↔ comuna del recinto) para no cruzar un recinto homónimo de otra comuna.

const UMBRAL_SIMILITUD = 0.90;

export function normalizar(texto) {
  if (texto === null || texto === undefined) return '';
  let t = String(texto).trim().toUpperCase();
  t = t.normalize('NFKD').replace(/[̀-ͯ]/g, '');   // sin tildes/diéresis
  t = t.replace(/[.\-'´`]/g, ' ');
  t = t.replace(/\s+/g, ' ').trim();
  return t;
}

// Similitud de texto (coeficiente de Dice sobre bigramas). Sustituye a difflib
// del script; solo se usa como último recurso y siempre se marca para revisar.
function similitud(a, b) {
  const x = a.replace(/\s+/g, ''), y = b.replace(/\s+/g, '');
  if (x === y) return 1;
  if (x.length < 2 || y.length < 2) return 0;
  const big = s => { const m = new Map(); for (let i = 0; i < s.length - 1; i++) { const g = s.slice(i, i + 2); m.set(g, (m.get(g) || 0) + 1); } return m; };
  const A = big(x), B = big(y);
  let inter = 0;
  for (const [g, c] of A) if (B.has(g)) inter += Math.min(c, B.get(g));
  return (2 * inter) / ((x.length - 1) + (y.length - 1));
}

function isSubset(a, b) { for (const x of a) if (!b.has(x)) return false; return a.size > 0; }

// Agrega recinto_norm y comuna_norm al maestro (una vez, al cargarlo).
export function prepararRecintos(filas) {
  return (filas || []).map(f => ({
    ...f,
    recinto_norm: normalizar(f.recinto),
    comuna_norm: normalizar(f.comuna)
  }));
}

// Cruza un nombre contra un conjunto de recintos YA acotado por comuna.
export function matchRecinto(nombre, recintos) {
  const norm = normalizar(nombre);
  if (!norm) return { fila: null, metodo: 'vacio', score: 0 };

  // 1. exacto
  for (const f of recintos) if (f.recinto_norm === norm) return { fila: f, metodo: 'exacto', score: 1 };

  // 2 + 2b. contención (substring o subconjunto de palabras)
  const cand = [];
  const palabras = new Set(norm.split(' '));
  for (const f of recintos) {
    const b = f.recinto_norm;
    let hit = b && (b.includes(norm) || norm.includes(b));
    if (!hit) {
      const pf = new Set(b.split(' '));
      hit = isSubset(palabras, pf) || isSubset(pf, palabras);
    }
    if (hit) cand.push(f);
  }
  if (cand.length === 1) return { fila: cand[0], metodo: 'contencion', score: 0.95 };
  if (cand.length > 1) {
    const mejor = cand.reduce((best, f) =>
      similitud(norm, f.recinto_norm) > similitud(norm, best.recinto_norm) ? f : best);
    return { fila: mejor, metodo: 'contencion_ambigua', score: 0.80 };
  }

  // 3. similitud (último recurso)
  let mejor = null, mejorScore = 0;
  for (const f of recintos) {
    const s = similitud(norm, f.recinto_norm);
    if (s > mejorScore) { mejor = f; mejorScore = s; }
  }
  if (mejor && mejorScore >= UMBRAL_SIMILITUD) return { fila: mejor, metodo: 'similitud', score: mejorScore };

  // 4. sin identificar — no se inventa coordenada
  return { fila: null, metodo: 'sin_identificar', score: mejorScore };
}

/**
 * Cruce completo: filtra por comuna (nombre) y luego busca el nombre.
 * @param {string} nombre        valor de "MOVER A ESTE RECINTO"
 * @param {string} comunaNombre  nombre de la comuna del elector (resuelto desde COMI)
 * @param {Array}  recintos      maestro preparado (prepararRecintos)
 * @returns {{fila, metodo, score, scopedComuna:boolean}}
 */
export function cruzarRecinto(nombre, comunaNombre, recintos) {
  const cNorm = normalizar(comunaNombre);
  const scoped = cNorm ? recintos.filter(f => f.comuna_norm === cNorm) : [];
  const usar = scoped.length ? scoped : recintos;   // si la comuna no acota, no bloquea
  const res = matchRecinto(nombre, usar);
  res.scopedComuna = Boolean(cNorm && scoped.length);
  return res;
}

// Métodos que igual cruzan pero conviene revisar a ojo (no dar por sentado).
export const METODOS_REVISAR = new Set(['contencion_ambigua', 'similitud']);

// ─────────────────────────────────────────────────────────────────────────────
// Carga del maestro de recintos (desde CSV/tabla o desde GeoJSON de puntos)
// ─────────────────────────────────────────────────────────────────────────────

function pick(obj, aliases) {
  const pares = Object.keys(obj || {}).map(k => [k, normalizar(k)]);
  for (const a of aliases) { const an = normalizar(a); const h = pares.find(([, kn]) => kn === an); if (h) return h[0]; }
  for (const a of aliases) { const an = normalizar(a); const h = pares.find(([, kn]) => kn.includes(an)); if (h) return h[0]; }
  return null;
}

// Desde filas de tabla (CSV/XLSX): codigo_rec, recinto, comuna, latitud, longitud.
export function maestroDesdeFilas(rows) {
  if (!rows || !rows.length) return [];
  const r0 = rows[0];
  const kCod = pick(r0, ['codigo_rec', 'cod_recinto', 'cod_re', 'id_recinto', 'codigo']);
  const kNom = pick(r0, ['recinto', 'nombre', 'glosa']);
  const kCom = pick(r0, ['comuna']);
  const kLat = pick(r0, ['latitud', 'lat', 'y']);
  const kLon = pick(r0, ['longitud', 'lon', 'lng', 'x']);
  const filas = rows.map(r => ({
    codigo_rec: String((kCod ? r[kCod] : '') ?? '').trim(),
    recinto: String((kNom ? r[kNom] : '') ?? '').trim(),
    comuna: String((kCom ? r[kCom] : '') ?? '').trim(),
    latitud: String((kLat ? r[kLat] : '') ?? '').trim(),
    longitud: String((kLon ? r[kLon] : '') ?? '').trim()
  })).filter(f => f.recinto);
  return prepararRecintos(filas);
}

// Desde un GeoJSON de puntos de recintos.
export function maestroDesdeGeoJSON(gj) {
  if (!gj || !gj.features) return [];
  const filas = gj.features.map(f => {
    const p = f.properties || {};
    const kNom = pick(p, ['recinto', 'nombre', 'glosa', 'nom']);
    const kCod = pick(p, ['codigo_rec', 'cod_recinto', 'cod_recint', 'id_recinto', 'codigo']);
    const kCom = pick(p, ['comuna']);
    let lon = '', lat = '';
    if (f.geometry && f.geometry.type === 'Point' && Array.isArray(f.geometry.coordinates)) {
      lon = String(f.geometry.coordinates[0] ?? ''); lat = String(f.geometry.coordinates[1] ?? '');
    }
    return {
      codigo_rec: String((kCod ? p[kCod] : '') ?? '').trim(),
      recinto: String((kNom ? p[kNom] : '') ?? '').trim(),
      comuna: String((kCom ? p[kCom] : '') ?? '').trim(),
      latitud: lat, longitud: lon
    };
  }).filter(f => f.recinto);
  return prepararRecintos(filas);
}

// Construye un GeoJSON de puntos (para el mapa) a partir del maestro.
export function geojsonDesdeMaestro(maestro) {
  return {
    type: 'FeatureCollection',
    features: (maestro || []).filter(f => f.latitud && f.longitud).map(f => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [parseFloat(f.longitud), parseFloat(f.latitud)] },
      properties: { recinto: f.recinto, codigo_rec: f.codigo_rec, comuna: f.comuna }
    }))
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Resolución de una fila de la planilla de reasignación
// ─────────────────────────────────────────────────────────────────────────────
const VACIOS = /^(null|na|n\/a|-|s\/i|sin informacion)$/i;

/**
 * Decide qué hacer con una fila de la planilla:
 *   · MOVER vacío  → { ignorar:true }  (elector correcto, el SIGE lo ignora)
 *   · MOVER lleno  → cruza el recinto destino (acotado por comuna) y devuelve la
 *                    coordenada base (lat/lon), método y si conviene revisar.
 * @param {object} row           fila cruda del Excel
 * @param {{mover:string, comi?:string, comuna?:string}} cols  nombres de columna
 * @param {(comi:any)=>string} comunaNameFn  resuelve COMI → nombre de comuna
 * @param {Array} maestro        maestro preparado
 */
export function resolverFilaReasignacion(row, cols, comunaNameFn, maestro) {
  const mover = String((cols.mover ? row[cols.mover] : '') ?? '').trim();
  if (!mover || VACIOS.test(mover)) return { ignorar: true };

  let comuna = '';
  if (cols.comi && comunaNameFn) comuna = comunaNameFn(row[cols.comi]) || '';
  if (!comuna && cols.comuna) comuna = String(row[cols.comuna] ?? '').trim();

  const res = cruzarRecinto(mover, comuna, maestro);
  if (res.fila) {
    return {
      ignorar: false, sinIdentificar: false,
      lat: parseFloat(res.fila.latitud), lon: parseFloat(res.fila.longitud),
      metodo: res.metodo, score: res.score, revisar: METODOS_REVISAR.has(res.metodo),
      recinto: res.fila.recinto, codigo_rec: res.fila.codigo_rec, comuna, mover
    };
  }
  return { ignorar: false, sinIdentificar: true, lat: null, lon: null, metodo: res.metodo, score: res.score, revisar: false, comuna, mover };
}
