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
  // ⚠️ Estas llaves son las que el código lee de verdad (regionName, regionCode,
  // instance). Una versión anterior de esta plantilla usaba region/codigo/
  // codigoRomano, que NO existen en ninguna parte del SIGE: quien la copiara
  // obtenía una instancia muda. Si cambias un nombre acá, cámbialo también en
  // js/app.js (applyRegionConfigUI) y en js/sigec-client.js.
  regionName: 'NOMBRE_REGION',     // ej. 'Los Ríos'
  regionCode: 'NN',                // CUT de región como string, ej. '14'
  instance:   'SIGE NN (NOMBRE_REGION)',   // lo que va en el <title>

  // Geocodificación cliente-side.
  //  · primary:  motor de la región — 'sigec' si tiene catastro propio, si no 'nominatim'.
  //  · fallback: motor genérico de respaldo.
  //  · sigec.url: DÉJALA VACÍA en el repo. El endpoint se configura en ⚙ APIs,
  //    que vive en el localStorage de cada equipo. Una URL de servicio escrita
  //    acá muere con el servicio y deja el botón colgando sin explicación.
  //  · sigec.catastro: qué hay detrás de SIGEC en esta región; es lo que la UI
  //    muestra. null si la región no tiene catastro propio.
  //      ej. { nombre: 'predios SII de Araucanía', volumen: '576k' }
  geocoder: {
    primary:  'nominatim',
    fallback: 'nominatim',
    sigec: { url: '', key: '', catastro: null }
  },

  // Diccionario CUT (INE/SII) → nombre oficial de comuna.
  // Llaves como string, con el MISMO largo con que llegan en el padrón
  // (en Los Ríos son 5 dígitos: '14101'). Valores en MAYÚSCULA, sin tilde.
  // No inventes correlativos: usa el CUT oficial, que no es secuencial entre
  // provincias.
  comunas: {
    // 'NNNNN': 'NOMBRE_COMUNA',
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
