// tools/verify_geocode_queue.mjs — Verificación de js/geocode-queue.js
// ═══════════════════════════════════════════════════════════════════════════════
// Acá lo que se verifica NO es la comodidad del operador: es que el SIGE no se
// gane el bloqueo de la IP de SERVEL en Nominatim. La política de uso de OSM es
// una promesa que hicimos en el código, y una promesa sin test es una intención.
//
// Se asevera:
//   · un solo hilo — las consultas salen estrictamente en serie;
//   · el espaciado mínimo entre consultas de red se respeta en ambos modos;
//   · el caché evita repreguntar, incluso lo que ya sabemos que NO existe
//     (repetir consultas es lo que la política llama "cliente defectuoso");
//   · la cascada para en el primer acierto y no gasta consultas de más;
//   · el tope del modo asistido se cumple;
//   · pausar y detener funcionan de verdad.
//
// No toca la red: se inyecta un fetch falso y un sleep falso (reloj virtual),
// así el test corre en milisegundos.
//
// Uso: node tools/verify_geocode_queue.mjs

import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

let passed = 0, failed = 0;
const ok = (c, m) => { if (c) { passed++; console.log(`  ✓ ${m}`); } else { failed++; console.error(`  ✗ ${m}`); } };
const eq = (a, b, m) => ok(a === b, `${m}  (esperado ${JSON.stringify(b)}, obtenido ${JSON.stringify(a)})`);

// ── Shims ─────────────────────────────────────────────────────────────────────
function makeLS() {
  const m = new Map();
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) };
}
globalThis.localStorage = makeLS();

const q = await import(pathToFileURL(join(ROOT, 'js', 'geocode-queue.js')).href);

// Reloj virtual: registramos cuánto se "durmió" sin dormir de verdad.
function reloj() {
  let t = 0;
  const esperas = [];
  return { ahora: () => t, esperas, sleep: async (ms) => { esperas.push(ms); t += ms; } };
}

// fetch falso: registra el orden y el instante de cada llamada.
function fakeFetch(respuestas, rj, traza) {
  let enVuelo = 0;
  return async (url) => {
    enVuelo++;
    if (enVuelo > 1) throw new Error('CONCURRENCIA: dos consultas en vuelo a la vez');
    const qs = decodeURIComponent(new URL(url).searchParams.get('q') || '');
    traza.push({ q: qs, t: rj.ahora() });
    const r = respuestas(qs);
    enVuelo--;
    return { ok: true, json: async () => (r ? [{ lat: String(r.lat), lon: String(r.lon), display_name: qs }] : []) };
  };
}

const fila = (calle, numero, localidad, comuna) => ({ calle, numero, localidad, comuna, callNorm: calle, numNorm: numero });

// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n▎ Cascada de consultas');
const casc = q.construirCascada(fila('PICARTE', '1200', '', 'VALDIVIA'), 'Los Ríos');
eq(casc.length, 2, 'con calle y número: dos niveles (portal y calle)');
eq(casc[0].nivel, 1, 'primer nivel es el portal');
ok(casc[0].q.includes('PICARTE 1200') && casc[0].q.includes('VALDIVIA') && casc[0].q.includes('Los Ríos'),
   'la consulta de nivel 1 lleva calle, número, comuna y región');
const cascRural = q.construirCascada(fila('', '', 'LLIFEN', 'FUTRONO'), 'Los Ríos');
eq(cascRural.length, 1, 'fila rural sin calle: solo el nivel de localidad');
eq(cascRural[0].nivel, 3, 'y ese nivel es el 3');
eq(q.construirCascada(fila('', '', '', ''), 'Los Ríos').length, 0, 'fila sin texto: ningún nivel (no se consulta)');

console.log('\n▎ Un solo hilo y espaciado (modo asistido)');
q.cacheLimpiar();
let rj = reloj(); let traza = [];
let cola = q.crearCola({ modo: 'asistido', fetchImpl: fakeFetch(() => null, rj, traza), sleepImpl: rj.sleep });
let trabajos = [1, 2, 3].map(i => ({ id: 'k' + i, cut: '14101', niveles: [{ nivel: 1, precision: 'portal', q: `CALLE ${i} 10, VALDIVIA, Los Ríos, Chile` }] }));
let res = await cola.procesar(trabajos);
eq(traza.length, 3, 'tres trabajos, tres consultas');
ok(traza.every((c, i) => i === 0 || c.t > traza[i - 1].t), 'las consultas salen estrictamente en serie');
const gaps = traza.slice(1).map((c, i) => c.t - traza[i].t);
ok(gaps.every(g => g >= q.MODOS.asistido.intervaloMs), `espaciado ≥ ${q.MODOS.asistido.intervaloMs} ms entre consultas (gaps: ${gaps})`);
eq(res.sinMatch, 3, 'ninguna resolvió');

console.log('\n▎ Espaciado del modo masivo (4 consultas/minuto)');
q.cacheLimpiar();
rj = reloj(); traza = [];
cola = q.crearCola({ modo: 'masivo', fetchImpl: fakeFetch(() => null, rj, traza), sleepImpl: rj.sleep });
await cola.procesar(trabajos);
const gapsM = traza.slice(1).map((c, i) => c.t - traza[i].t);
ok(gapsM.every(g => g >= 15000), `espaciado ≥ 15 s en modo masivo (gaps: ${gapsM})`);
eq(q.MODOS.masivo.intervaloMs, 15000, 'el intervalo masivo es 15 s (4/min, como pide la política)');

console.log('\n▎ La cascada para en el primer acierto');
q.cacheLimpiar();
rj = reloj(); traza = [];
cola = q.crearCola({ modo: 'asistido', fetchImpl: fakeFetch(s => (s.startsWith('PICARTE 1200') ? { lat: -39.8, lon: -73.2 } : null), rj, traza), sleepImpl: rj.sleep });
res = await cola.procesar([{ id: 'k1', cut: '14101', niveles: q.construirCascada(fila('PICARTE', '1200', 'ALGO', 'VALDIVIA'), 'Los Ríos') }]);
eq(traza.length, 1, 'acierta en el nivel 1 y NO consulta los niveles siguientes');
eq(res.resueltos, 1, 'queda resuelto');

console.log('\n▎ Cascada que baja de nivel');
q.cacheLimpiar();
rj = reloj(); traza = [];
cola = q.crearCola({ modo: 'asistido', fetchImpl: fakeFetch(s => (s.startsWith('PICARTE,') ? { lat: -39.8, lon: -73.2 } : null), rj, traza), sleepImpl: rj.sleep });
let capturado = null;
res = await cola.procesar([{ id: 'k1', cut: '14101', niveles: q.construirCascada(fila('PICARTE', '1200', '', 'VALDIVIA'), 'Los Ríos') }],
  { onResultado: r => { capturado = r; } });
eq(traza.length, 2, 'falla el portal, prueba la calle');
eq(capturado.hallazgo.nivel, 2, 'reporta el nivel que efectivamente acertó');
eq(capturado.hallazgo.precision, 'calle', 'y su precisión, para que el operador sepa qué está confirmando');

console.log('\n▎ Caché: no se repregunta (ni los aciertos ni los fallos)');
q.cacheLimpiar();
rj = reloj(); traza = [];
const mismaFila = () => ({ id: 'x', cut: '14101', niveles: [{ nivel: 1, precision: 'portal', q: 'PICARTE 1200, VALDIVIA, Los Ríos, Chile' }] });
cola = q.crearCola({ modo: 'asistido', fetchImpl: fakeFetch(() => ({ lat: -39.8, lon: -73.2 }), rj, traza), sleepImpl: rj.sleep });
await cola.procesar([mismaFila(), mismaFila(), mismaFila()]);
eq(traza.length, 1, 'tres trabajos con la misma dirección → UNA sola consulta de red');

q.cacheLimpiar();
rj = reloj(); traza = [];
cola = q.crearCola({ modo: 'asistido', fetchImpl: fakeFetch(() => null, rj, traza), sleepImpl: rj.sleep });
await cola.procesar([mismaFila(), mismaFila()]);
eq(traza.length, 1, 'un fallo también se cachea: no se repregunta lo que ya sabemos que no existe');
ok(q.cacheStats().fallos >= 1, 'el caché contabiliza los fallos');

console.log('\n▎ Tope del modo asistido');
q.cacheLimpiar();
rj = reloj(); traza = [];
cola = q.crearCola({ modo: 'asistido', fetchImpl: fakeFetch(() => null, rj, traza), sleepImpl: rj.sleep });
const muchos = Array.from({ length: 80 }, (_, i) => ({ id: 'k' + i, cut: '14101', niveles: [{ nivel: 1, precision: 'portal', q: `C${i} 1, VALDIVIA, Los Ríos, Chile` }] }));
res = await cola.procesar(muchos);
eq(traza.length, q.MODOS.asistido.topeConsultas, `no pasa de ${q.MODOS.asistido.topeConsultas} consultas de red`);
ok(res.omitidosPorTope > 0, 'informa cuántos quedaron fuera por el tope');

console.log('\n▎ Detener corta de verdad');
q.cacheLimpiar();
rj = reloj(); traza = [];
let colaRef = null;
colaRef = q.crearCola({
  modo: 'asistido',
  fetchImpl: fakeFetch(() => { if (traza.length >= 2) colaRef.detener(); return null; }, rj, traza),
  sleepImpl: rj.sleep
});
res = await colaRef.procesar(muchos.slice(0, 20));
ok(traza.length <= 3, `se detiene casi inmediato (consultas: ${traza.length})`);
ok(res.detenido, 'el resumen marca que fue detenido');

console.log('\n▎ Estimación honesta de duración');
ok(/s$/.test(q.estimar(10, 'asistido')), 'lotes chicos se estiman en segundos');
ok(/h$/.test(q.estimar(2000, 'masivo')), '2000 registros en masivo se estiman en HORAS, no en minutos');

console.log(`\n${failed === 0 ? '✅' : '❌'}  ${passed} aserciones OK, ${failed} fallidas`);
process.exit(failed === 0 ? 0 : 1);
