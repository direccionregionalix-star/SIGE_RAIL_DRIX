// region-config.template.js — PLANTILLA de configuración regional del SIGE
// ═══════════════════════════════════════════════════════════════════════════════
// CÓMO REPLICAR EL SIGE EN OTRA REGIÓN
//
//   1. Copiar este archivo a `region-config.js`:
//          cp js/region-config.template.js js/region-config.js
//   2. Rellenar los valores de ABAJO con los de la región destino.
//   3. Nada más. El resto del sistema es UNIVERSAL y NO cambia:
//        · contrato de salida (run, tipo_geo_id, latitud, longitud + calle/numero/
//          localidad/resto en GeoJSON)
//        · dominios de tipo geo (1 LOCALIDAD · 2 EXACTO · 3 CALLE · 4 NO GEO)
//        · RUN como llave de match
//        · regla de oro: "NO GEO no se recalcula"
//
// Los helpers comunaSeed() y comunaName() son idénticos entre regiones: solo
// leen REGION_CONFIG.comunas. NO los edites al replicar.

export const REGION_CONFIG = {
  region:       'NOMBRE_REGION',   // ej. 'Los Ríos'
  codigo:       0,                 // código numérico de región (CUT), ej. 14
  codigoRomano: 'XX',              // etiqueta institucional, ej. 'XIV'

  // Geocodificación cliente-side.
  //  · primary:  motor propio de la región, ej. 'sigec' (Araucanía) o null si no hay.
  //  · fallback: motor genérico cuando no hay primario, ej. 'nominatim'.
  geocoder: {
    primary:  null,
    fallback: 'nominatim'
  },

  // Diccionario CUT (SII) → nombre oficial de comuna.
  // Llaves como string SIN cero a la izquierda; valores en MAYÚSCULA.
  comunas: {
    // 'XXXX': 'NOMBRE_COMUNA',
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers derivados (NO editar al replicar) — ver region-config.js para docs.
// ─────────────────────────────────────────────────────────────────────────────

export function comunaSeed() {
  const seed = {};
  for (const [cut, nombre] of Object.entries(REGION_CONFIG.comunas)) {
    const nom = String(nombre).trim().toUpperCase();
    const raw = String(cut).trim();
    if (!raw) continue;
    seed[raw] = nom;
    const asInt = parseInt(raw, 10);
    if (!Number.isNaN(asInt)) seed[asInt.toString()] = nom;
  }
  return seed;
}

export function comunaName(cut) {
  if (cut === null || cut === undefined) return '';
  const raw = String(cut).trim();
  if (!raw) return '';
  const dict = REGION_CONFIG.comunas;
  if (dict[raw]) return dict[raw];
  const asInt = parseInt(raw, 10);
  if (!Number.isNaN(asInt) && dict[asInt.toString()]) return dict[asInt.toString()];
  return '';
}
