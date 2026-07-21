// region-config.js — Configuración regional del SIGE (patrón region_config)
// Instancia actual: SIGE XIV — Región de Los Ríos (código 14).

export const REGION_CONFIG = {
  regionName: 'Los Ríos',
  regionCode: '14',
  instance: 'SIGE XIV (Los Ríos) — instancia TEMPORAL de prueba',
  geocoder: {
    primary: 'sigec',       // SIGEC de Los Ríos ACTIVO (backend en Railway)
    fallback: 'nominatim',  // Nominatim como respaldo
    sigec: { url: 'https://sigeraildrix-production-6c8c.up.railway.app', key: '' }
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
