// server/test/contract.test.mjs — Verifica el contrato SIGEC sin base real.
// Inyecta un runner falso y asevera que la salida calza EXACTO con lo que consume
// js/sigec-client.js (rol, direccion, comuna_nom, destino, sector, lat, lon,
// area_m2, match_method, geom_geojson, score) y que la query es parametrizada.
//
// Correr:  node --test test/     (desde server/)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { schemaFromEnv, buildBuscarQuery, assertIdent, mapComuna } from '../sigec.js';
import { checkAuth, handleBuscar } from '../handlers.js';

const SCHEMA = schemaFromEnv({});   // defaults

test('mapComuna: traduce SII 4 díg. → INE 5 díg. y es idempotente', () => {
  assert.equal(mapComuna('1402'), '14102');   // Corral
  assert.equal(mapComuna('1409'), '14201');   // La Unión (salto de provincia)
  assert.equal(mapComuna('14102'), '14102');  // ya en INE → passthrough
  assert.equal(mapComuna('9999'), '9999');    // desconocido → passthrough
});

test('buildBuscarQuery: valores parametrizados, sin interpolar el input', () => {
  const q = buildBuscarQuery(SCHEMA, { comuna: '1401', query: "arauco'; DROP", limite: 5 });
  assert.deepEqual(q.values, ['14101', "arauco'; DROP", 5]);   // 1401 → 14101 (INE)
  assert.match(q.text, /\$1/); assert.match(q.text, /\$2/); assert.match(q.text, /\$3/);
  assert.ok(!q.text.includes('DROP'), 'el input del usuario nunca se interpola en el SQL');
});

test('buildBuscarQuery: usa el esquema real (JOIN dos tablas + PostGIS + filtro CUT)', () => {
  const q = buildBuscarQuery(SCHEMA, { comuna: '1401', query: 'arauco' });
  assert.match(q.text, /FROM catastro_atributos a/);
  assert.match(q.text, /JOIN catastro_geom g ON g\.id_parcela = a\.id_parcela/);
  assert.match(q.text, /ST_Centroid/);
  assert.match(q.text, /ST_AsGeoJSON/);
  assert.match(q.text, /a\.cut_estandar::text = \$1/);
});

test('buildBuscarQuery: límite se acota a [1,100]', () => {
  assert.equal(buildBuscarQuery(SCHEMA, { comuna: '1', query: 'x', limite: 9999 }).values[2], 100);
  assert.equal(buildBuscarQuery(SCHEMA, { comuna: '1', query: 'x', limite: 0 }).values[2], 20);
});

test('assertIdent: rechaza identificadores maliciosos', () => {
  assert.throws(() => assertIdent('predios; DROP TABLE x'));
  assert.equal(assertIdent('public.predios'), 'public.predios');
});

test('handleBuscar: la salida trae EXACTO las columnas del contrato del cliente', async () => {
  const CONTRATO = ['rol', 'direccion', 'comuna_nom', 'destino', 'sector',
                    'lat', 'lon', 'area_m2', 'match_method', 'geom_geojson', 'score'];
  const fakeRow = Object.fromEntries(CONTRATO.map(k => [k, k === 'lat' ? -39.8 : k]));
  const runner = async () => [fakeRow];
  const r = await handleBuscar(SCHEMA, runner, { p_comuna: '1401', p_query: 'arauco' });
  assert.equal(r.status, 200);
  assert.equal(r.json.length, 1);
  assert.deepEqual(Object.keys(r.json[0]).sort(), [...CONTRATO].sort());
});

test('handleBuscar: query vacía devuelve [] sin tocar la base', async () => {
  let llamado = false;
  const runner = async () => { llamado = true; return []; };
  const r = await handleBuscar(SCHEMA, runner, { p_comuna: '1401', p_query: '   ' });
  assert.deepEqual(r.json, []);
  assert.equal(llamado, false);
});

test('checkAuth: sin key configurada es abierto; con key exige apikey o Bearer', () => {
  assert.equal(checkAuth({}, ''), true);
  assert.equal(checkAuth({}, 'secreto'), false);
  assert.equal(checkAuth({ apikey: 'secreto' }, 'secreto'), true);
  assert.equal(checkAuth({ authorization: 'Bearer secreto' }, 'secreto'), true);
  assert.equal(checkAuth({ apikey: 'malo' }, 'secreto'), false);
});
