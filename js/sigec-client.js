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
// Credenciales por defecto (anon key pública, read-only por RLS). Se pueden
// sobrescribir desde el modal ⚙ si algún día se rota el proyecto.

const SIGEC_DEFAULT_URL = 'https://cbqpeusznwotoeftkegw.supabase.co';
const SIGEC_DEFAULT_KEY = 'sb_publishable_jp4zBRi9mDjZREBckfkyIA_kZ0dcHon';

const LS_URL = 'sige_sigec_url';
const LS_KEY = 'sige_sigec_key';

function cfg() {
  return {
    url: (localStorage.getItem(LS_URL) || SIGEC_DEFAULT_URL).replace(/\/$/, ''),
    key: localStorage.getItem(LS_KEY) || SIGEC_DEFAULT_KEY
  };
}

export function saveConfig(url, key) {
  if (url && url.trim()) localStorage.setItem(LS_URL, url.trim()); else localStorage.removeItem(LS_URL);
  if (key && key.trim()) localStorage.setItem(LS_KEY, key.trim()); else localStorage.removeItem(LS_KEY);
}

export function getConfig() { return cfg(); }

// Siempre hay credenciales (las por defecto), así que SIGEC está disponible out-of-the-box
export function isAvailable() { return Boolean(cfg().url && cfg().key); }

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
