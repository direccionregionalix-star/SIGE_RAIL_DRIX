// coords.js — Resolución de coordenadas finales (la "Regla de Oro" NO GEO)
// ═══════════════════════════════════════════════════════════════════════════════
// LA REGLA NO GEO es la regla de negocio más crítica del sistema: cuando un cluster
// se marca como 'NO GEO', la exportación DEBE conservar las coordenadas originales
// del Excel/padrón, ignorando cualquier pin puesto en el mapa.
//
// Antes esta lógica estaba copiada 3 veces en io.js (backup, geojson, append). Un
// cambio en una sola copia, olvidando las otras, exportaría datos corruptos a
// Enterprise SIN ningún error visible. Ahora vive en UN solo lugar.

function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = parseFloat(v);
  return isNaN(n) ? null : n;
}

/**
 * Devuelve las coordenadas finales que deben exportarse para una fila.
 * @param {object} r        registro normalizado (tiene latFinal/lonFinal si fue geocodificado)
 * @param {object} cluster  cluster al que pertenece (aporta tipo si la fila no lo tiene)
 * @param {object} rawRow   fila cruda original (fuente de las coordenadas originales)
 * @returns {{ lat: number|null, lon: number|null, tipo: string }}
 */
export function resolveFinalCoords(r, cluster, rawRow) {
  const tipoFinal = r.tipo || (cluster && cluster.tipo) || null;
  const origLat = num(rawRow && (rawRow.latitud ?? rawRow.geo_lat));
  const origLon = num(rawRow && (rawRow.longitud ?? rawRow.geo_lon));

  let lat, lon;
  if (tipoFinal === 'NO GEO') {
    // Regla de Oro: NO GEO conserva siempre la coordenada original
    lat = origLat;
    lon = origLon;
  } else {
    lat = r.latFinal != null ? num(r.latFinal) : origLat;
    lon = r.lonFinal != null ? num(r.lonFinal) : origLon;
  }

  return { lat, lon, tipo: tipoFinal };
}
