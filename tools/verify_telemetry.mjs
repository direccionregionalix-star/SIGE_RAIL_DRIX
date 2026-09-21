// tools/verify_telemetry.mjs — Verificación de js/telemetry.js
// ═══════════════════════════════════════════════════════════════════════════════
// Lo que se asevera acá no es "que cuente bien" sino las DOS promesas que le
// hicimos al operador y a SERVEL:
//   1. Nunca sale nada por red (no hay fetch en el módulo).
//   2. Nunca rompe el SIGE, ni con localStorage caído.
// …más que los contadores efectivamente cuenten.
//
// Uso: node tools/verify_telemetry.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

let passed = 0, failed = 0;
const ok = (cond, msg) => { if (cond) { passed++; console.log(`  ✓ ${msg}`); } else { failed++; console.error(`  ✗ ${msg}`); } };
const eq = (a, b, msg) => ok(a === b, `${msg}  (esperado ${JSON.stringify(b)}, obtenido ${JSON.stringify(a)})`);

// ── Shim de localStorage ──────────────────────────────────────────────────────
function makeLS() {
  const m = new Map();
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: k => m.delete(k),
    _map: m
  };
}
globalThis.localStorage = makeLS();
globalThis.fetch = () => { throw new Error('telemetry.js no debe usar la red'); };

// URL file://, no ruta del SO: en Windows 'C:' se toma como protocolo.
const t = await import(pathToFileURL(join(ROOT, 'js', 'telemetry.js')).href);

// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n▎ Promesa 1: no hay red');
const fuente = readFileSync(join(ROOT, 'js', 'telemetry.js'), 'utf8');
ok(!/\bfetch\s*\(/.test(fuente), 'el módulo no contiene ninguna llamada a fetch()');
ok(!/XMLHttpRequest|navigator\.sendBeacon|WebSocket|EventSource/.test(fuente),
   'no usa XHR, sendBeacon, WebSocket ni EventSource');

console.log('\n▎ Promesa 2: apagado por defecto');
eq(t.isOn(), false, 'arranca apagado');
t.clasificado('k1', 'EXACTO', false);
eq(t.snapshot().clasificacion.EXACTO, 0, 'apagado no registra nada');

console.log('\n▎ Contadores');
t.setOn(true);
ok(t.isOn(), 'setOn(true) enciende');

t.clusterAbierto('k1');
t.clasificado('k1', 'EXACTO', false);
t.clasificado('k1', 'NO GEO', true);          // reclasificación
t.clasificado('k2', 'LOCALIDAD', false);
const s1 = t.snapshot();
eq(s1.clasificacion.EXACTO, 1, 'cuenta EXACTO');
eq(s1.clasificacion['NO GEO'], 1, 'cuenta NO GEO');
eq(s1.clasificacion.LOCALIDAD, 1, 'cuenta LOCALIDAD');
eq(s1.clasificacion.reclasificaciones, 1, 'cuenta reclasificaciones');
ok(s1.clasificacion.tiempoDecision.n === 1, 'cronometra solo el cluster que estaba abierto');

t.geocoder('nominatim', 'ok', 300);
t.geocoder('nominatim', 'sinResultado', 900);
t.geocoder('nominatim', 'error', 5000);
t.geocoder('inexistente', 'ok', 100);          // motor desconocido: se ignora sin romper
const g = t.snapshot().geocoder.nominatim;
eq(g.llamadas, 3, 'cuenta llamadas del geocoder');
eq(g.ok, 1, 'cuenta éxitos');
eq(g.error, 1, 'cuenta errores');
eq(g.latencia['<500ms'], 1, 'bucket <500ms');
eq(g.latencia['<1s'], 1, 'bucket <1s');
eq(g.latencia['<8s'], 1, 'bucket <8s');

console.log('\n▎ Padrón y CUT sin resolver');
t.padronCargado({
  filas: 10, clusters: 4,
  cuts: ['14101', '14101', '1409'],
  cutsNoResueltos: ['1409'],
  columnasNoReconocidas: ['MOVER A ESTE RECINTO']
});
const p = t.snapshot().padron;
eq(p.filas, 10, 'acumula filas');
eq(p.cutLargo['5 dígitos'], 2, 'histograma de largo de CUT (5 dígitos)');
eq(p.cutLargo['4 dígitos'], 1, 'histograma de largo de CUT (4 dígitos)');
eq(p.cutNoResueltos['1409'], 1, 'registra el CUT que no resuelve');

console.log('\n▎ Privacidad: nada identificable en el volcado');
const crudo = JSON.stringify(t.snapshot());
ok(!/\d{7,8}-[\dkK]/.test(crudo), 'el volcado no contiene ningún RUN');
ok(!/PICARTE|GENERAL LAGOS|ESMERALDA/i.test(crudo), 'el volcado no contiene direcciones');
ok(!/-3[89]\.\d{3,}/.test(crudo), 'el volcado no contiene coordenadas');

console.log('\n▎ Indicadores derivados');
const ind = t.indicadores();
eq(ind.clustersClasificados, 3, 'total clasificado');
eq(ind.pctNoGeo, 33.3, '% NO GEO');
eq(ind.geocoder.nominatim.tasaExito, 33.3, 'tasa de éxito de Nominatim');

console.log('\n▎ Resiliencia: localStorage caído no rompe nada');
globalThis.localStorage = {
  getItem: () => { throw new Error('storage bloqueado'); },
  setItem: () => { throw new Error('storage bloqueado'); },
  removeItem: () => { throw new Error('storage bloqueado'); }
};
let explotó = false;
try {
  t.isOn(); t.sesionInicio(); t.clasificado('k9', 'CALLE', false);
  t.geocoder('sigec', 'error', 10); t.padronCargado({ filas: 1, cuts: ['x'] });
  t.exporte('esri_json', 5); t.pinManual(); t.reset();
} catch (e) { explotó = true; }
ok(!explotó, 'ninguna anotación lanza con el storage bloqueado');

console.log(`\n${failed === 0 ? '✅' : '❌'}  ${passed} aserciones OK, ${failed} fallidas`);
process.exit(failed === 0 ? 0 : 1);
