// region-config.js — Configuración regional del SIGE (patrón region_config)
// Instancia actual: SIGE XIV — Región de Los Ríos (código 14).

export const REGION_CONFIG = {
  regionName: 'Los Ríos',
  regionCode: '14',
  instance: 'SIGE XIV (Los Ríos) — instancia TEMPORAL de prueba',
  geocoder: {
    primary: 'sigec',       // SIGEC de Los Ríos ACTIVO (backend en Railway)
    fallback: 'nominatim',  // Nominatim como respaldo
    // Backend SIGEC de Los Ríos (capa HTTP delante de Neon, ver server/).
    // La key va vacía porque el backend no exige SIGEC_API_KEY (predios públicos).
    sigec: { url: 'https://sigeraildrix-production-6c8c.up.railway.app', key: '' }
  },
  // Tabla de comunas (código SII de 4 dígitos → nombre canónico en MAYÚSCULAS).
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

// Semilla { CUT → NOMBRE } para inyectar en el diccionario de comunas.
export function comunaSeed() {
  const seed = {};
  for (const [cut, nom] of Object.entries(REGION_CONFIG.comunas)) {
    seed[cut] = nom;
    seed[String(parseInt(cut, 10))] = nom;
    seed['0' + cut] = nom;
  }
  return seed;
}
