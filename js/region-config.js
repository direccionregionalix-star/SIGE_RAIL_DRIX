// region-config.js — Configuración regional del SIGE (patrón region_config)
// Instancia actual: SIGE XIV — Región de Los Ríos (código 14).

export const REGION_CONFIG = {
  regionName: 'Los Ríos',
  regionCode: '14',
  instance: 'SIGE XIV (Los Ríos) — instancia TEMPORAL de prueba',
  geocoder: {
    // Los Ríos NO tiene catastro de predios propio publicado. El motor primario
    // es Nominatim (client-side, requiere salida a openstreetmap.org).
    primary: 'nominatim',
    fallback: 'nominatim',

    // SIGEC XIV: el backend vivía en Railway y murió al vencer el trial
    // (sigeraildrix-production-6c8c… → 404). Se deja la URL VACÍA a propósito:
    // una URL muerta hardcodeada deja el botón 🔍 SIGEC colgando sin decir por
    // qué. Con url vacía y regionCode ≠ '09', sigec-client.js marca SIGEC como
    // NO disponible en vez de consultar en silencio los predios de Araucanía,
    // que para un padrón de Los Ríos no devuelven nada útil.
    //
    // Para reactivarlo: levantar el backend de server/ (o un PostgREST sobre el
    // catastro XIV) y pegar su URL en el modal ⚙ APIs — NO aquí. El endpoint es
    // infraestructura, no código; en el modal vive en el localStorage de cada PC
    // y no queda versionado en un repo público. Si además pasa a ser el motor
    // principal de la región, recién ahí primary vuelve a 'sigec'.
    // `catastro` describe QUÉ hay detrás de SIGEC en esta región, y es lo que la
    // UI muestra. En null porque Los Ríos no tiene catastro propio: así la
    // pantalla no promete "576k predios SII de Araucanía" como hacía antes.
    sigec: { url: '', key: '', catastro: null }
  },
  // CUT/INE de 5 dígitos (como en el padrón y el catastro). Los Ríos SIEMPRE es
  // 5 dígitos; no hay cero a la izquierda que se pierda (eso es de Araucanía).
  comunas: {
    '14101': 'VALDIVIA',
    '14102': 'CORRAL',
    '14103': 'LANCO',
    '14104': 'LOS LAGOS',
    '14105': 'MAFIL',
    '14106': 'MARIQUINA',
    '14107': 'PAILLACO',
    '14108': 'PANGUIPULLI',
    '14201': 'LA UNION',
    '14202': 'FUTRONO',
    '14203': 'LAGO RANCO',
    '14204': 'RIO BUENO'
  }
};

export function normalizeCut(v) {
  if (v === null || v === undefined) return '';
  const m = String(v).match(/\d+/);
  if (!m) return '';
  return m[0].replace(/^0+(\d)/, '$1');
}

export function comunaName(cut) {
  const c = normalizeCut(cut);
  return REGION_CONFIG.comunas[c] || '';
}

export function isRegionComuna(cut) {
  const c = normalizeCut(cut);
  return Object.prototype.hasOwnProperty.call(REGION_CONFIG.comunas, c);
}

export function comunaSeed() {
  const seed = {};
  for (const [cut, nom] of Object.entries(REGION_CONFIG.comunas)) {
    seed[cut] = nom;
    seed[String(parseInt(cut, 10))] = nom;
    seed['0' + cut] = nom;
  }
  return seed;
}
