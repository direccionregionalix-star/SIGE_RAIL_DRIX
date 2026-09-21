// sigec-client.js — Cliente del geocodificador SIGEC (predios SII vía Supabase)
// ═══════════════════════════════════════════════════════════════════════════════
// SIGEC es la capa de geocoding centralizada del ecosistema SERVEL: 576k predios
// SII de Araucanía con búsqueda fuzzy por comuna + fragmento de dirección.
// Devuelve dirección + centroide (lat/lon) + polígono GeoJSON, rankeado por score.
//
// Sirve para los tres dominios del SIGE:
//   · EXACTO / CALLE  → centroide del predio como coordenada urbana
//   · LOCALIDAD       → predio rural como ancla de localidad
//
// Endpoint por región: SIGEC es region_config. La URL/key salen de
// REGION_CONFIG.geocoder.sigec (si están puestas); si no, se usa el fallback
// histórico (Araucanía). El modal ⚙ (localStorage) siempre tiene prioridad.
import { REGION_CONFIG } from './region-config.js';

const SIGEC_FALLBACK_URL = 'https://cbqpeusznwotoeftkegw.supabase.co';
const SIGEC_FALLBACK_KEY = 'sb_publishable_jp4zBRi9mDjZREBckfkyIA_kZ0dcHon';

const LS_URL = 'sige_sigec_url';
const LS_KEY = 'sige_sigec_key';

function regionSigec() {
  const g = REGION_CONFIG && REGION_CONFIG.geocoder && REGION_CONFIG.geocoder.sigec;
  return g && typeof g === 'object' ? g : {};
}

// Región dueña del catastro del fallback histórico (predios SII de Araucanía).
const FALLBACK_REGION = '09';

function cfg() {
  const rs = regionSigec();
  const lsUrl = localStorage.getItem(LS_URL);
  const url = (lsUrl || rs.url || SIGEC_FALLBACK_URL).replace(/\/$/, '');
  return {
    url,
    key: localStorage.getItem(LS_KEY) || rs.key || SIGEC_FALLBACK_KEY,
    // ¿Este endpoint es el catastro de Araucanía usado por una región que no es
    // Araucanía? Entonces es un fallback EQUIVOCADO, no un fallback.
    regionAjena: !lsUrl && !rs.url &&
                 String((REGION_CONFIG && REGION_CONFIG.regionCode) || FALLBACK_REGION) !== FALLBACK_REGION
  };
}

export function saveConfig(url, key) {
  if (url && url.trim()) localStorage.setItem(LS_URL, url.trim()); else localStorage.removeItem(LS_URL);
  if (key && key.trim()) localStorage.setItem(LS_KEY, key.trim()); else localStorage.removeItem(LS_KEY);
}

export function getConfig() { return cfg(); }

/**
 * ¿SIGEC es consultable para la región activa?
 *
 * Antes esto devolvía SIEMPRE true, porque las credenciales por defecto nunca
 * están vacías. Consecuencia real en la instancia XIV: el botón 🔍 SIGEC y el
 * Auto-Urbanos quedaban habilitados y consultaban el catastro de ARAUCANÍA con
 * CUT de Los Ríos — cero resultados, sin explicación para el operador.
 *
 * Ahora: hay SIGEC si hay endpoint Y ese endpoint corresponde a la región activa
 * (o el operador lo configuró a mano en ⚙ APIs).
 */
export function isAvailable() {
  const c = cfg();
  return Boolean(c.url && c.key && !c.regionAjena);
}

/** Motivo legible de la indisponibilidad, para mostrarlo en la UI en vez de fallar mudo. */
export function unavailableReason() {
  const c = cfg();
  if (!c.url || !c.key) return 'SIGEC no tiene endpoint configurado (⚙ APIs).';
  if (c.regionAjena) {
    const r = (REGION_CONFIG && REGION_CONFIG.regionName) || 'esta región';
    return `SIGEC no tiene catastro propio para ${r}: el endpoint por defecto es el de Araucanía. ` +
           `Configura la URL regional en ⚙ APIs o usa Nominatim.`;
  }
  return '';
}

function headers() {
  const { key } = cfg();
  return { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
}

/**
 * Busca predios por comuna + fragmento de dirección.
 * @param {string} comunaCod  código sin cero a la izquierda, ej '9201'
 * @param {string} query      texto libre (calle + número, o nombre de localidad)
 * @param {object} [opts]     { limite=20, umbral=0.15 }
 * @returns {Promise<Array>}  [{ rol, direccion, comuna, lat, lon, geojson, score, matchMethod, ... }]
 */
export async function buscar(comunaCod, query, opts = {}) {
  const { limite = 20, umbral = 0.15 } = opts;
  if (!query || !query.trim()) return [];
  const { url } = cfg();

  const resp = await fetch(`${url}/rest/v1/rpc/sigec_buscar`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ p_comuna: comunaCod, p_query: query, p_limite: limite, p_umbral: umbral })
  });
  if (!resp.ok) throw new Error(`SIGEC ${resp.status}: ${(await resp.text()).slice(0, 120)}`);

  const rows = await resp.json();
  return rows.map(r => ({
    rol:         r.rol,
    direccion:   r.direccion,
    comuna:      r.comuna_nom,
    destino:     r.destino,
    sector:      r.sector,
    lat:         r.lat,
    lon:         r.lon,
    areaM2:      r.area_m2,
    matchMethod: r.match_method,
    geojson:     r.geom_geojson,
    score:       r.score
  }));
}

/**
 * Registra la selección del usuario para que SIGEC mejore su ranking.
 * No bloquea ni lanza: los errores se loguean en silencio.
 */
export async function registrarSeleccion(query, comunaCod, rol) {
  if (!query || !comunaCod || !rol) return;
  const { url } = cfg();
  try {
    await fetch(`${url}/rest/v1/rpc/sigec_registrar_seleccion`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ p_query: query, p_comuna: comunaCod, p_rol: rol, p_cliente: 'sige' })
    });
  } catch (e) {
    console.warn('SIGEC registrarSeleccion falló (no crítico):', e.message);
  }
}
