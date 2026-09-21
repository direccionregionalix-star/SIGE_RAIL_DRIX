// geocode-queue.js — Geocodificación asistida por lotes contra Nominatim/OSM
// ═══════════════════════════════════════════════════════════════════════════════
// Por qué existe
// ─────────────
// El Auto-Urbanos del SIGE depende de SIGEC (catastro de predios). Las regiones
// que no tienen catastro propio —Los Ríos hoy— quedaban SIN ningún modo
// automático: el operador aprieta 📍 Nominatim cluster por cluster, uno por uno.
// Esto le da un lote, respetando la política de uso de OSM al pie de la letra.
//
// LA POLÍTICA DE USO (operations.osmfoundation.org/policies/nominatim)
// ───────────────────────────────────────────────────────────────────
// Nominatim es un servicio gratuito mantenido por donaciones. Abusarlo hace que
// bloqueen la IP — y acá la IP es la de SERVEL, compartida por toda la
// institución. Por eso el módulo respeta, sin opción de saltárselo:
//
//   · Máximo absoluto 1 consulta/segundo para uso interactivo.
//   · Para lotes largos: máximo 4 consultas/minuto (una cada 15 s).
//   · Un solo hilo. Una sola máquina. Nada distribuido.
//   · Los resultados DEBEN cachearse del lado del cliente. Repetir la misma
//     consulta hace que te clasifiquen como cliente defectuoso y te bloqueen.
//   · La aplicación debe identificarse por User-Agent o Referer. Desde el
//     navegador no se puede fijar User-Agent, pero el Referer va solo y apunta
//     al sitio del SIGE: eso cumple.
//
// De ahí los dos modos. No son una preferencia de velocidad: son los dos
// regímenes que la política distingue.
//
//   ASISTIDO — 1,1 s entre consultas, tope de 60 consultas NUEVAS por corrida.
//              Es uso interactivo: el operador está sentado mirando. ~1 minuto.
//   MASIVO   — 15 s entre consultas, sin tope de cantidad. Es el régimen de
//              lote largo. Miles de registros = horas. Pausable y reanudable.
//
// Lo que de verdad baja el costo no es el modo: es el caché y la cascada. Un
// padrón repite muchísima dirección, y los clusters ya agrupan por clave.

export const MODOS = {
  asistido: { intervaloMs: 1100,  topeConsultas: 60,   etiqueta: 'Asistido (1/s, hasta 60)' },
  masivo:   { intervaloMs: 15000, topeConsultas: null, etiqueta: 'Masivo (4/min, sin tope)' }
};

const LS_CACHE = 'sige_geocache_v1';
const MAX_CACHE = 5000;          // entradas; más allá se poda lo más viejo
const CACHE_TTL_DIAS = 180;      // una dirección no se muda; medio año es prudente

// ── Caché ─────────────────────────────────────────────────────────────────────
// Obligatorio por política, pero además es la mejora de rendimiento real: en un
// padrón la misma calle aparece decenas de veces.
let _cache = null;

function cacheLoad() {
  if (_cache) return _cache;
  try {
    const raw = localStorage.getItem(LS_CACHE);
    _cache = raw ? JSON.parse(raw) : {};
  } catch (e) { _cache = {}; }
  return _cache;
}

function cacheSave() {
  try {
    const c = cacheLoad();
    const claves = Object.keys(c);
    if (claves.length > MAX_CACHE) {
      // Poda por antigüedad: nos quedamos con las MAX_CACHE más recientes.
      claves.sort((a, b) => (c[b].ts || 0) - (c[a].ts || 0));
      const podado = {};
      for (const k of claves.slice(0, MAX_CACHE)) podado[k] = c[k];
      _cache = podado;
    }
    localStorage.setItem(LS_CACHE, JSON.stringify(_cache));
  } catch (e) { /* cuota llena: seguimos sin caché persistente */ }
}

function cacheGet(clave) {
  const e = cacheLoad()[clave];
  if (!e) return null;
  const dias = (Date.now() - (e.ts || 0)) / 86400000;
  if (dias > CACHE_TTL_DIAS) return null;
  return e;
}

function cacheSet(clave, valor) {
  cacheLoad()[clave] = { ...valor, ts: Date.now() };
  cacheSave();
}

export function cacheStats() {
  const c = cacheLoad();
  const vals = Object.values(c);
  return {
    entradas: vals.length,
    aciertos: vals.filter(v => !v.miss).length,
    fallos: vals.filter(v => v.miss).length
  };
}

export function cacheLimpiar() {
  try { _cache = {}; localStorage.removeItem(LS_CACHE); } catch (e) { /* noop */ }
}

// ── Cascada de consultas ──────────────────────────────────────────────────────
// Antes se mandaba "calle, comuna, Chile" de una sola forma: si Nominatim no la
// tenía así, se perdía el registro. La cascada prueba de lo específico a lo
// general y PARA en el primer acierto, anotando con qué nivel se resolvió —
// porque un acierto de nivel 3 no es lo mismo que uno de nivel 1 y el operador
// necesita saberlo antes de confirmar.
//
// nivel 1 → calle + número  (precisión de portal)
// nivel 2 → solo calle      (precisión de eje de calle)
// nivel 3 → localidad       (precisión de lugar poblado)
export function construirCascada(row, regionName) {
  const limpio = v => String(v ?? '').trim().replace(/\s+/g, ' ');
  const calle = limpio(row.callNorm || row.calle);
  const numero = limpio(row.numNorm || row.numero);
  const localidad = limpio(row.localidad);
  const comuna = limpio(row.comuna);
  const cola = [comuna, regionName, 'Chile'].filter(Boolean).join(', ');

  const niveles = [];
  if (calle && numero) niveles.push({ nivel: 1, precision: 'portal', q: `${calle} ${numero}, ${cola}` });
  if (calle)           niveles.push({ nivel: 2, precision: 'calle',  q: `${calle}, ${cola}` });
  if (localidad)       niveles.push({ nivel: 3, precision: 'localidad', q: `${localidad}, ${cola}` });
  return niveles;
}

export function claveCache(cut, q) {
  return `${String(cut || '')}|${q.toLowerCase()}`;
}

// ── Consulta unitaria ─────────────────────────────────────────────────────────
// `fetchImpl` se inyecta para poder testear sin red (y para no tocar jamás la
// red en CI).
export async function consultarNominatim(q, fetchImpl = fetch) {
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}` +
              `&format=json&limit=1&countrycodes=cl&addressdetails=0`;
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`Nominatim ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data) || !data.length) return null;
  const lat = parseFloat(data[0].lat), lon = parseFloat(data[0].lon);
  if (!isFinite(lat) || !isFinite(lon)) return null;
  return { lat, lon, display: data[0].display_name || '' };
}

// ── La cola ───────────────────────────────────────────────────────────────────
// Un solo hilo, de verdad: un bucle secuencial con espera entre consultas. No
// hay Promise.all en ninguna parte y es a propósito — la política pide
// explícitamente un único hilo.
export function crearCola({ modo = 'asistido', fetchImpl = fetch, sleepImpl = null } = {}) {
  const cfg = MODOS[modo] || MODOS.asistido;
  const dormir = sleepImpl || (ms => new Promise(r => setTimeout(r, ms)));

  let pausado = false, detenido = false, corriendo = false;
  let consultasRed = 0;

  return {
    get estado() { return { pausado, detenido, corriendo, consultasRed, modo, ...cfg }; },
    pausar()   { pausado = true; },
    reanudar() { pausado = false; },
    detener()  { detenido = true; pausado = false; },

    /**
     * Procesa una lista de trabajos.
     * @param {Array} trabajos  [{ id, cut, niveles:[{nivel,precision,q}] }]
     * @param {object} cb  { onResultado(res), onProgreso(p) }
     * @returns {Promise<object>} resumen
     */
    async procesar(trabajos, { onResultado = () => {}, onProgreso = () => {} } = {}) {
      corriendo = true; detenido = false; consultasRed = 0;
      let resueltos = 0, sinMatch = 0, desdeCache = 0, errores = 0, omitidosPorTope = 0;

      for (let i = 0; i < trabajos.length; i++) {
        if (detenido) break;
        while (pausado && !detenido) await dormir(200);
        if (detenido) break;

        const t = trabajos[i];
        let hallazgo = null, huboRed = false, falló = false;

        for (const nv of (t.niveles || [])) {
          const k = claveCache(t.cut, nv.q);
          const enCache = cacheGet(k);

          if (enCache) {
            // El caché guarda también los fallos: repetir una consulta que ya
            // sabemos que no existe es justo lo que la política llama "cliente
            // defectuoso".
            if (!enCache.miss) { hallazgo = { ...enCache, ...nv, fuente: 'cache' }; break; }
            continue;
          }

          // Tope del modo asistido: no es una cuota nuestra, es la frontera
          // entre "uso interactivo" y "lote", que la política trata distinto.
          if (cfg.topeConsultas !== null && consultasRed >= cfg.topeConsultas) {
            omitidosPorTope++;
            break;
          }

          if (huboRed) await dormir(cfg.intervaloMs);   // espaciado ENTRE consultas de red
          huboRed = true;
          consultasRed++;

          try {
            const r = await consultarNominatim(nv.q, fetchImpl);
            if (r) { cacheSet(k, r); hallazgo = { ...r, ...nv, fuente: 'nominatim' }; break; }
            cacheSet(k, { miss: true });
          } catch (e) {
            falló = true;
            break;   // error de red: no insistimos con los niveles siguientes
          }
        }

        if (hallazgo) { resueltos++; onResultado({ trabajo: t, hallazgo }); }
        else if (falló) { errores++; }
        else { sinMatch++; onResultado({ trabajo: t, hallazgo: null }); }

        onProgreso({
          hechos: i + 1, total: trabajos.length,
          resueltos, sinMatch, desdeCache, errores, consultasRed, omitidosPorTope
        });

        // Espaciado antes del PRÓXIMO trabajo, solo si este usó la red.
        if (huboRed && i < trabajos.length - 1 && !detenido) await dormir(cfg.intervaloMs);
      }

      corriendo = false;
      return { resueltos, sinMatch, errores, consultasRed, omitidosPorTope, detenido,
               procesados: Math.min(trabajos.length, trabajos.length) };
    }
  };
}

/** Estimación honesta de duración, para decírsela al operador ANTES de empezar. */
export function estimar(nTrabajos, modo = 'asistido') {
  const cfg = MODOS[modo] || MODOS.asistido;
  const n = cfg.topeConsultas !== null ? Math.min(nTrabajos, cfg.topeConsultas) : nTrabajos;
  const seg = Math.round((n * cfg.intervaloMs) / 1000);
  if (seg < 90) return `~${seg} s`;
  if (seg < 5400) return `~${Math.round(seg / 60)} min`;
  return `~${(seg / 3600).toFixed(1)} h`;
}
