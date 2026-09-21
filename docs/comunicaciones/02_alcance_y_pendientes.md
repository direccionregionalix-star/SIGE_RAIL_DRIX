# 02 — Alcance y pendientes

## Alcance del cambio

Adaptación **regional aditiva** del SIGE para **Los Ríos (XIV)**. El objetivo es
que el sistema opere en Los Ríos sin tocar el contrato de salida ni la lógica
universal.

### Aditivo (archivos nuevos)
- `js/region-config.js` — config Los Ríos (12 comunas, geocoder Nominatim).
- `js/region-config.template.js` — plantilla de réplica nacional.
- `padron_prueba_los_rios.csv` — 15 filas, RUN ficticios.
- `README_SIGE_XIV.md` y `docs/comunicaciones/`.
- `tools/verify_region_config.mjs` — harness de verificación.
- `js/telemetry.js` + `tools/telemetry_report.mjs` — medición local de uso
  (opt-in, sin red). Ver `04_medicion_de_uso.md`.
- `.github/workflows/ci.yml` — CI que corre el harness, la telemetría y los tests
  del backend en cada PR.

### Wiring (ediciones mínimas)
- `js/core.js` → fallback CUT→nombre vía `region_config`.
- `js/app.js` → siembra de comunas + etiquetado regional de la UI.
- `index.html` → `<title>` XIV + `id` estable en bloque SIGEC.
- `package.json` → `"type": "module"` (habilita el harness; sin efecto en runtime).

## UNIVERSAL — lo que NO se tocó

- Dominios de tipo geo (`1/2/3/4`) y nombres de campos.
- Contrato de salida idéntico: `run, tipo_geo_id, latitud, longitud`
  (+ `calle/numero/localidad/resto` en GeoJSON).
- **`RUN` como llave**.
- **Regla "NO GEO no se recalcula"** (conserva la coordenada original).

## Decisión sobre SIGEC

> **Actualizado.** Entre el 21-jul y el merge del PR #1, `region-config.js` cambió
> a `primary: 'sigec'` apuntando a un backend en Railway, y esta sección quedó
> describiendo una configuración que ya no existía. El backend murió con el trial
> (404). Lo que sigue es el estado real del código.

En DRIX el geocodificador **SIGEC** (predios SII de Araucanía) **sí está en uso**
(botones `🔍 SIGEC`, `window.geoSIGEC`, backend Supabase). Por eso **NO se
desactiva**: se **condiciona por región** vía `REGION_CONFIG.geocoder.primary`.

Para Los Ríos: `primary: 'nominatim'` y `geocoder.sigec.url` **vacía**. Con la URL
vacía y `regionCode: '14'`, `js/sigec-client.js` declara SIGEC **no disponible**
en vez de consultar en silencio el catastro de Araucanía con un CUT de Los Ríos
—que devuelve cero resultados sin explicar por qué. El modal ⚙ muestra el motivo
y el Auto-Urbanos queda deshabilitado.

Para reactivarlo: levantar `server/` (o un PostgREST sobre el catastro XIV) y
pegar la URL en **⚙ APIs**, nunca en el repo. Ver `03_despliegue_y_entornos.md`.

## Pendientes / bloqueos (no code)

1. **SERVEL** debe zanjar **qué cuenta institucional aloja producción** — es padrón
   electoral. **No** desplegar con datos reales hasta entonces; la demo con datos
   ficticios sigue como **piloto**.
   > El PR #1 se mergeó a `main` el 21-sep antes de que esto se zanjara. Lo
   > mergeado es código y un padrón de 15 filas con RUN ficticios, así que no hubo
   > exposición de datos reales, pero la condición de producción sigue en pie. El
   > CI ahora bloquea que entre al repo cualquier CSV con columna RUN que no sea
   > el padrón de prueba.
2. **PASO 0.2**: verificar hash del `app.js` servido por Railway vs. repo (drift
   deploy↔repo). Requiere acceso a la consola de la URL de producción.
3. **Nominatim** requiere red saliente a `openstreetmap.org` (corre client-side).
4. **Railway** (servicio nuevo + URL) = paso del Director.

## Proceso

- Trabajo en **rama + PR sobre DRIX** (no sobre el repo personal).
- Rama de desarrollo: `claude/session-6ddbfn`.
