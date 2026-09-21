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

En DRIX el geocodificador **SIGEC** (predios SII de Araucanía) **sí está en uso**
(botones `🔍 SIGEC`, `window.geoSIGEC`, backend Supabase). Por eso **NO se
desactiva**: se **condiciona por región** vía `REGION_CONFIG.geocoder.primary`.
Para Los Ríos (`primary: null`) queda marcado *opcional*; sigue disponible como
consulta cruzada.

## Pendientes / bloqueos (no code)

1. **SERVEL** debe zanjar **qué cuenta institucional aloja producción** — es padrón
   electoral. **No** mergear a `main` ni desplegar con datos reales hasta entonces.
   La demo con datos ficticios puede seguir como **piloto**.
2. **PASO 0.2**: verificar hash del `app.js` servido por Railway vs. repo (drift
   deploy↔repo). Requiere acceso a la consola de la URL de producción.
3. **Nominatim** requiere red saliente a `openstreetmap.org` (corre client-side).
4. **Railway** (servicio nuevo + URL) = paso del Director.

## Proceso

- Trabajo en **rama + PR sobre DRIX** (no sobre el repo personal).
- Rama de desarrollo: `claude/session-6ddbfn`.
