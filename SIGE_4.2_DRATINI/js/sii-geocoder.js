// sii-geocoder.js — Módulo Geocodificador SII v4.0 "Dratini"
// ═══════════════════════════════════════════════════════════════════════════════
// 100% offline. Los datos del usuario (RUT, nombres) NUNCA pasan por este módulo.
// Solo recibe calle, número, comuna y retorna coordenadas desde el índice local.
//
// API pública:
//   SIIGeocoder.load(file)               → Promise<{ total_keys, total_streets }>
//   SIIGeocoder.geocode(calle, num, com)  → { lat, lon, confianza, metodo } | null
//   SIIGeocoder.isLoaded()               → boolean
//   SIIGeocoder.getStats()               → { total_keys, total_streets, fileName }

import { nd } from './utils.js';

// ── Estado interno ──────────────────────────────────────────────
let _index   = null;   // { "CALLE|NUM|COMUNA": { lat, lon, dir, dest, n } }
let _streets = null;   // { "CALLE|COMUNA": [1, 3, 5, ...] ordenados }
let _meta    = null;

// ── Tabla de prefijos (debe ser idéntica al Python) ─────────────
const PREFIXES = [
    ['AVENIDA ', 'AV '], ['AVDA ', 'AV '], ['PASAJE ', 'PJ '],
    ['PSJE ', 'PJ '],    ['CAMINO ', 'CM '], ['CALLE ', ''],
    ['VILLA ', 'V '],    ['POBLACION ', 'POB '], ['POBL ', 'POB '],
];

// ── Normalización (espejo exacto del build_sii_index.py) ────────
function normalizeText(s) {
    if (!s) return '';
    let t = nd(String(s).trim()).toUpperCase();
    return t.replace(/[°#.,;:\-]/g, ' ').replace(/\s+/g, ' ').trim();
}

function expandPrefix(calle) {
    for (const [longForm, shortForm] of PREFIXES) {
        if (calle.startsWith(longForm)) return shortForm + calle.slice(longForm.length);
    }
    return calle;
}

function normalizeNumero(num) {
    if (!num) return '';
    return String(num).replace(/\D/g, '').replace(/^0+(\d)/, '$1') || '';
}

function makeKey(calle, numero, comuna) {
    const c = expandPrefix(normalizeText(calle));
    const n = normalizeNumero(numero);
    const com = normalizeText(comuna);
    return `${c}|${n}|${com}`;
}

function makeStreetKey(calle, comuna) {
    return `${expandPrefix(normalizeText(calle))}|${normalizeText(comuna)}`;
}

// ── Carga del .json.gz ──────────────────────────────────────────
export async function load(file) {
    if (!file) throw new Error('No se proporcionó archivo');

    const arrayBuffer = await file.arrayBuffer();
    let jsonText;

    try {
        // DecompressionStream es API nativa del browser (Chrome 80+, Firefox 113+)
        const ds = new DecompressionStream('gzip');
        const writer = ds.writable.getWriter();
        const reader = ds.readable.getReader();
        writer.write(new Uint8Array(arrayBuffer));
        writer.close();

        const chunks = [];
        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            if (value) chunks.push(value);
        }
        const total = chunks.reduce((s, c) => s + c.length, 0);
        const merged = new Uint8Array(total);
        let offset = 0;
        for (const chunk of chunks) { merged.set(chunk, offset); offset += chunk.length; }
        jsonText = new TextDecoder('utf-8').decode(merged);
    } catch {
        // Fallback: quizás es JSON plano sin comprimir
        jsonText = new TextDecoder('utf-8').decode(new Uint8Array(arrayBuffer));
    }

    const data = JSON.parse(jsonText);
    _index   = data.index;
    _streets = data.streets;
    _meta    = {
        version:       data.version,
        generated:     data.generated,
        total_keys:    data.total_keys    || Object.keys(_index).length,
        total_streets: data.total_streets || Object.keys(_streets || {}).length,
        fileName:      file.name
    };

    console.log(`✅ SII Geocoder cargado: ${_meta.total_keys.toLocaleString()} direcciones en ${file.name}`);
    return _meta;
}

// ── Motor de geocodificación ────────────────────────────────────
/**
 * Niveles de confianza (en orden de intento):
 *   'sii_exacto'    → clave calle+numero+comuna encontrada directamente
 *   'sii_par'       → número no encontrado, se usó el par/impar más cercano (≤20)
 *   'sii_calle'     → sin número válido, retorna centroide de la calle
 */
export function geocode(calle, numero, comuna) {
    if (!_index) return null;

    // Nivel 1 — Match exacto
    const exactKey = makeKey(calle, numero, comuna);
    if (_index[exactKey]) {
        const e = _index[exactKey];
        return { lat: e.lat, lon: e.lon, confianza: 'sii_exacto', metodo: `SII · ${e.dir}`, n: e.n };
    }

    if (!_streets) return null;
    const streetKey = makeStreetKey(calle, comuna);
    const numeros   = _streets[streetKey];
    if (!numeros || numeros.length === 0) return null;

    const numInt = parseInt(normalizeNumero(numero), 10);

    // Nivel 2 — Número par/impar más cercano (respeta la paridad vial chilena)
    if (!isNaN(numInt) && numInt > 0) {
        const sameParity = numeros.filter(n => n % 2 === numInt % 2);
        const pool       = sameParity.length > 0 ? sameParity : numeros;
        const closest    = pool.reduce((best, n) => Math.abs(n - numInt) < Math.abs(best - numInt) ? n : best);

        if (Math.abs(closest - numInt) <= 20) {
            const approxKey = makeKey(calle, String(closest), comuna);
            if (_index[approxKey]) {
                const e = _index[approxKey];
                return { lat: e.lat, lon: e.lon, confianza: 'sii_par', metodo: `SII aprox. · ${e.dir} (pedido: ${numero})`, n: e.n };
            }
        }
    }

    // Nivel 3 — Centroide de calle
    const coords = numeros.reduce((acc, n) => {
        const k = makeKey(calle, String(n), comuna);
        if (_index[k]) acc.push([_index[k].lat, _index[k].lon]);
        return acc;
    }, []);

    if (coords.length > 0) {
        const lat = Math.round(coords.reduce((s, c) => s + c[0], 0) / coords.length * 1e7) / 1e7;
        const lon = Math.round(coords.reduce((s, c) => s + c[1], 0) / coords.length * 1e7) / 1e7;
        const calleNorm = expandPrefix(normalizeText(calle));
        return { lat, lon, confianza: 'sii_calle', metodo: `SII calle · ${calleNorm} (${coords.length} predios)`, n: coords.length };
    }

    return null;
}

// ── Utilidades ──────────────────────────────────────────────────
export const isLoaded = () => _index !== null;
export const getStats = () => _meta ? { ..._meta } : null;
