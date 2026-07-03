// constants.js — Constantes compartidas del SIGE (única fuente de verdad)
// ═══════════════════════════════════════════════════════════════════════════════
// Antes estos valores estaban duplicados en io.js (×2), app.js y core.js. Cualquier
// cambio obligaba a tocar varios lugares con riesgo de desincronización. Ahora viven
// acá y todos los módulos los importan.

// Mapa dominio → id numérico para Enterprise/ArcGIS.
// 'RURAL' es alias histórico de 'LOCALIDAD' (mismo id) por compatibilidad.
export const DOMINIOS = {
  'LOCALIDAD': 1,
  'RURAL':     1,
  'EXACTO':    2,
  'CALLE':     3,
  'NO GEO':    4,
};

// Inverso id → nombre canónico (RURAL colapsa en LOCALIDAD)
export const DOMINIOS_INV = {
  1: 'LOCALIDAD',
  2: 'EXACTO',
  3: 'CALLE',
  4: 'NO GEO',
};

export const REVISADO_SI = 2;   // dom_revisado: 2 = revisado/confirmado

// Campos estándar del esquema Esri (para exportación)
export const ESRI_FIELDS = [
  { name: 'run',         type: 'esriFieldTypeInteger', alias: 'run' },
  { name: 'tipo_geo_id', type: 'esriFieldTypeInteger', alias: 'tipo_geo_id' },
  { name: 'latitud',     type: 'esriFieldTypeDouble',  alias: 'latitud' },
  { name: 'longitud',    type: 'esriFieldTypeDouble',  alias: 'longitud' },
  { name: 'calle',       type: 'esriFieldTypeString',  alias: 'calle',     length: 150 },
  { name: 'numero',      type: 'esriFieldTypeString',  alias: 'numero',    length: 20  },
  { name: 'localidad',   type: 'esriFieldTypeString',  alias: 'localidad', length: 100 },
  { name: 'resto',       type: 'esriFieldTypeString',  alias: 'resto',     length: 150 },
];
