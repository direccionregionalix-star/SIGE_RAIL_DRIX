// tools/verify_region_config.mjs — Harness de verificación del region_config (XIV Los Ríos)
// ═══════════════════════════════════════════════════════════════════════════════
// Ejercita los EXPORTADORES REALES de js/io.js con el padrón de prueba y asevera
// el contrato universal del SIGE:
//   · columnas de salida exactas (run, tipo_geo_id, latitud, longitud + calle/numero/localidad/resto)
//   · NO GEO conserva la coordenada ORIGINAL (ignora el pin del mapa)
//   · EXACTO usa la coordenada CORREGIDA
//   · RUN como llave
//   · region_config resuelve CUT→nombre (comunaName / resolveComunaName)
//
// Uso:  node tools/verify_region_config.mjs
// Sale con código 0 si todo pasa; 1 si alguna aserción falla.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// ── Aserciones mínimas ────────────────────────────────────────────────────────
let passed = 0, failed = 0;
function ok(cond, msg) {
  if (cond) { passed++; console.log(`  ✓ ${msg}`); }
  else { failed++; console.error(`  ✗ ${msg}`); }
}
function eq(a, b, msg) { ok(a === b, `${msg}  (esperado ${JSON.stringify(b)}, obtenido ${JSON.stringify(a)})`); }

// ── Shims de navegador (los exportadores corren client-side) ──────────────────
const blobs = [];      // contenido de cada Blob creado
const excels = [];     // hojas capturadas de XLSX.writeFile
globalThis.setTimeout = (fn) => { fn(); return 0; };   // ejecuta callbacks sincrónicamente
globalThis.alert = () => {};
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
globalThis.Blob = class { constructor(parts) { this.__content = (parts || []).join(''); blobs.push(this.__content); } };
globalThis.URL = { createObjectURL: () => 'blob:mock', revokeObjectURL: () => {} };
globalThis.document = {
  getElementById: () => null,
  createElement: () => ({ click() {}, set href(_) {}, set download(_) {} })
};
globalThis.window = {
  XLSX: {
    utils: {
      book_new: () => ({ __sheets: [] }),
      json_to_sheet: (data) => ({ __data: data }),
      book_append_sheet: (wb, ws, name) => { wb.__sheets.push({ name, data: ws.__data }); }
    },
    writeFile: (wb, name) => { excels.push({ name, sheets: wb.__sheets }); }
  }
};

// ── Carga de módulos REALES ───────────────────────────────────────────────────
const io = await import(join(ROOT, 'js', 'io.js'));
const region = await import(join(ROOT, 'js', 'region-config.js'));
const core = await import(join(ROOT, 'js', 'core.js'));
const { DOMINIOS } = await import(join(ROOT, 'js', 'constants.js'));

// ── Padrón de prueba → rawData (llaves que consumen los exportadores) ─────────
function parseCsv(text) {
  const [head, ...rows] = text.trim().split(/\r?\n/);
  const cols = head.split(',').map(c => c.trim().toLowerCase());
  return rows.map(line => {
    const vals = line.split(',');
    const o = {};
    cols.forEach((c, i) => { o[c] = (vals[i] ?? '').trim(); });
    return o;
  });
}
const csv = readFileSync(join(ROOT, 'padron_prueba_los_rios.csv'), 'utf8');
const rawData = parseCsv(csv).map(r => ({
  run: r.run, calle: r.calle, numero: r.numero, resto: r.resto,
  localidad: r.localidad, comuna: r.comuna,
  latitud: r.latitud || '', longitud: r.longitud || ''
}));

// ── Escenarios: post-geocodificación (tipo + coordenada de trabajo) ───────────
// Guardamos las coords originales para comparar contra la salida.
const ORIG = rawData.map(r => ({ lat: r.latitud, lon: r.longitud }));

// idx 0 (run 35100001, Valdivia): EXACTO con coordenada CORREGIDA
// idx 2 (run 35100003, Corral):   NO GEO con un PIN erróneo (debe ignorarse)
// idx 8 (run 35100009, Panguipulli): LOCALIDAD
// idx 10 (run 35100011, sin coords): NO GEO sin coordenada → fuera del GeoJSON
const CORR_LAT = -39.8150, CORR_LON = -73.2465;
const PIN_LAT = -12.0000, PIN_LON = -70.0000;

const rows = rawData.map((raw, id) => {
  let tipo = 'CALLE', latFinal = null, lonFinal = null, metodo = 'Nominatim';
  if (id === 0)  { tipo = 'EXACTO';    latFinal = CORR_LAT; lonFinal = CORR_LON; }
  if (id === 2)  { tipo = 'NO GEO';    latFinal = PIN_LAT;  lonFinal = PIN_LON; metodo = 'pin manual'; }
  if (id === 8)  { tipo = 'LOCALIDAD'; latFinal = -39.6430; lonFinal = -72.3340; }
  if (id === 10) { tipo = 'NO GEO';    latFinal = null;     lonFinal = null; }
  return { id, tipo, latFinal, lonFinal, metodo,
           calle: raw.calle, numero: raw.numero, comuna: raw.comuna, codComuna: raw.comuna };
});
const clusters = { todo: { key: 'todo', rows, tipo: null, latFinal: null, lonFinal: null, metodo: null } };

// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n▎ region_config: CUT → nombre de comuna');
const esperadas = {
  '1401': 'VALDIVIA', '1402': 'CORRAL', '1403': 'LANCO', '1404': 'LOS LAGOS',
  '1405': 'MAFIL', '1406': 'MARIQUINA', '1407': 'PAILLACO', '1408': 'PANGUIPULLI',
  '1409': 'LA UNION', '1410': 'FUTRONO', '1411': 'LAGO RANCO', '1412': 'RIO BUENO'
};
for (const [cut, nom] of Object.entries(esperadas)) eq(region.comunaName(cut), nom, `comunaName('${cut}')`);
eq(region.comunaName(1408), 'PANGUIPULLI', 'comunaName(1408) numérico');
eq(region.comunaName('9999'), '', 'comunaName CUT desconocido → ""');
const seed = region.comunaSeed();
ok(seed['1401'] === 'VALDIVIA' && seed['1412'] === 'RIO BUENO', 'comunaSeed() siembra las 12 comunas');
eq(core.resolveComunaName({ codComuna: '1408' }), 'PANGUIPULLI', 'resolveComunaName usa fallback region_config');
eq(core.resolveComunaName({ comuna: '1401' }), 'VALDIVIA', 'resolveComunaName con CUT en campo comuna');

console.log('\n▎ Exportador REAL buildGeoJSONExport (Esri JSON)');
blobs.length = 0;
io.buildGeoJSONExport(clusters, rawData, 'padron');
const esri = JSON.parse(blobs[blobs.length - 1]);
const feats = esri.features;
eq(feats.length, rawData.length, 'una feature por fila del padrón');

const ATTR_KEYS = ['run', 'tipo_geo_id', 'latitud', 'longitud', 'calle', 'numero', 'localidad', 'resto'];
const keys0 = Object.keys(feats[0].attributes);
ok(keys0.length === ATTR_KEYS.length && ATTR_KEYS.every((k, i) => k === keys0[i]),
   `columnas de salida exactas: ${ATTR_KEYS.join(', ')}`);

const byRun = n => feats.find(f => f.attributes.run === n);
eq(byRun(35100001).attributes.run, 35100001, 'RUN como llave (numérico, sin DV)');
eq(byRun(35100001).attributes.tipo_geo_id, DOMINIOS['EXACTO'], 'EXACTO → tipo_geo_id 2');
eq(byRun(35100001).attributes.latitud, CORR_LAT, 'EXACTO usa la coordenada CORREGIDA');

const noGeo = byRun(35100003);
eq(noGeo.attributes.tipo_geo_id, DOMINIOS['NO GEO'], 'NO GEO → tipo_geo_id 4');
eq(noGeo.attributes.latitud, parseFloat(ORIG[2].lat), 'NO GEO conserva la latitud ORIGINAL');
eq(noGeo.attributes.longitud, parseFloat(ORIG[2].lon), 'NO GEO conserva la longitud ORIGINAL');
ok(noGeo.attributes.latitud !== PIN_LAT, 'NO GEO IGNORA el pin del mapa');
eq(byRun(35100009).attributes.tipo_geo_id, DOMINIOS['LOCALIDAD'], 'LOCALIDAD → tipo_geo_id 1');

console.log('\n▎ Exportador REAL buildEntregaQA (GeoJSON + Excel SIGEA)');
blobs.length = 0; excels.length = 0;
io.buildEntregaQA(clusters, rawData, 'padron');
const entregaGeo = JSON.parse(blobs.find(b => b.includes('FeatureCollection')));
eq(entregaGeo.type, 'FeatureCollection', 'GeoJSON estándar FeatureCollection');
// La fila NO GEO sin coordenada (run 35100011) NO entra al GeoJSON…
ok(!entregaGeo.features.some(f => f.properties.run === 35100011), 'fila sin coordenada excluida del GeoJSON');
// …pero SÍ está en el Excel plano (todas las filas).
const excelData = excels[0].sheets[0].data;
ok(excelData.some(r => r.run === 35100011), 'fila sin coordenada SÍ presente en el Excel SIGEA');
const noGeoXls = excelData.find(r => r.run === 35100003);
eq(noGeoXls.latitud, parseFloat(ORIG[2].lat), 'Excel: NO GEO conserva latitud original');
eq(excelData.length, rawData.length, 'Excel incluye TODAS las filas');

// ── Resumen ───────────────────────────────────────────────────────────────────
console.log(`\n${failed === 0 ? '✅' : '❌'}  ${passed} aserciones OK, ${failed} fallidas`);
process.exit(failed === 0 ? 0 : 1);
