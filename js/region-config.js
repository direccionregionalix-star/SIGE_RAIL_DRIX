// region-config.js — Configuración regional del SIGE (patrón region_config)
// ═══════════════════════════════════════════════════════════════════════════════
// Este módulo aísla TODO lo que depende de la región en un solo lugar, para que
// la misma base de código sirva a cualquier región sin hardcodear comunas ni
// geocodificadores dispersos por la app.
//
// Instancia actual: SIGE XIV — Región de Los Ríos (código 14).
//
// ⚠️ Lo que este archivo NO toca (universal, idéntico a Araucanía):
//   · Dominios de tipo geo: 1=LOCALIDAD/RURAL, 2=EXACTO, 3=CALLE, 4=NO GEO
//   · Nombres de campos y contrato de salida (run, tipo_geo_id, latitud, longitud…)
//   · RUN como llave. La regla "NO GEO no se recalcula".
//
// Geocodificación:
//   · primary=null  → esta región NO tiene un SIGEC propio todavía. En DRIX el
//                     SIGEC de Araucanía SÍ está cableado (predios SII Supabase),
//                     por eso NO se elimina: se condiciona a "opcional" cuando la
//                     región activa no lo usa como motor primario.
//   · fallback='nominatim' → se opera con Nominatim (y con el índice SII local
//                     opcional, si el analista carga uno de la región).

export const REGION_CONFIG = {
  regionName: 'Los Ríos',
  regionCode: '14',
  instance: 'SIGE XIV (Los Ríos) — instancia TEMPORAL de prueba',
  geocoder: {
    primary: null,          // sin SIGEC propio ACTIVO aún (ver sigec.url abajo)
    fallback: 'nominatim',  // Nominatim + SII local opcional
    // Para ACTIVAR el SIGEC de Los Ríos cuando el backend esté desplegado:
    //   1) desplegar server/ en Railway (ver server/README.md) → obtener su URL
    //   2) poner esa URL aquí y, si el backend usa SIGEC_API_KEY, la key publicable
    //   3) cambiar primary a 'sigec'
    // Con url vacía, el cliente usa su fallback histórico (no rompe nada).
    sigec: { url: '', key: '' }
  },
  // Tabla de comunas (código SII de 4 dígitos → nombre canónico en MAYÚSCULAS).
  // Permite resolver el CUT a nombre sin depender de un GeoJSON de referencia.
  comunas: {
    '1401': 'VALDIVIA',
    '1402': 'CORRAL',
    '1403': 'LANCO',
    '1404': 'LOS LAGOS',
    '1405': 'MAFIL',
    '1406': 'MARIQUINA',      // San José de la Mariquina
    '1407': 'PAILLACO',
    '1408': 'PANGUIPULLI',
    '1409': 'LA UNION',
    '1410': 'FUTRONO',
    '1411': 'LAGO RANCO',
    '1412': 'RIO BUENO'
  }
};

// Normaliza un código de comuna a su forma canónica de 4 dígitos.
// Acepta '1401', '01401', '1401.0', ' 1401 ' → '1401'.
export function normalizeCut(v) {
  if (v === null || v === undefined) return '';
  const m = String(v).match(/\d+/);
  if (!m) return '';
  return m[0].replace(/^0+(\d)/, '$1');
}

// Devuelve el nombre de la comuna para un CUT de la región, o '' si no aplica.
export function comunaName(cut) {
  const c = normalizeCut(cut);
  return REGION_CONFIG.comunas[c] || '';
}

// ¿El CUT pertenece a la región configurada? (No rechaza nada: solo informa.)
export function isRegionComuna(cut) {
  const c = normalizeCut(cut);
  return Object.prototype.hasOwnProperty.call(REGION_CONFIG.comunas, c);
}

// Semilla { CUT → NOMBRE } lista para inyectar en el diccionario de comunas
// que arma normalizeData() (mismos formatos con y sin cero a la izquierda).
export function comunaSeed() {
  const seed = {};
  for (const [cut, nom] of Object.entries(REGION_CONFIG.comunas)) {
    seed[cut] = nom;                                  // '1401'
    seed[String(parseInt(cut, 10))] = nom;            // '1401' (idempotente aquí)
    seed['0' + cut] = nom;                            // '01401' por si viene con cero
  }
  return seed;
}
