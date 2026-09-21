# SIGE — Región de Los Ríos (XIV)

Despliegue regional del **SIGE (Sistema de Información Geográfica Electoral)** para
la **Región de Los Ríos (XIV, código 14)**, sobre el repositorio canónico de
producción `direccionregionalix-star/SIGE_RAIL_DRIX`.

Es una adaptación **aditiva**: toda la lógica de negocio universal permanece
intacta. Lo único regional vive aislado en `js/region-config.js`.

## Qué cambió (respecto de la base canónica)

Archivos **nuevos**:

| Archivo | Rol |
|---|---|
| `js/region-config.js` | Config regional de Los Ríos: región, código, geocoder y diccionario CUT→comuna (12 comunas). Expone `REGION_CONFIG`, `comunaSeed()` y `comunaName()`. |
| `js/region-config.template.js` | Plantilla para replicar el SIGE en otra región. |
| `padron_prueba_los_rios.csv` | Padrón de prueba con **15 filas y RUN ficticios** para el piloto/demo. |
| `docs/comunicaciones/01_contexto_repo_canonico.md` | Por qué DRIX es la base y no el repo personal. |
| `docs/comunicaciones/02_alcance_y_pendientes.md` | Alcance del cambio y bloqueos institucionales (SERVEL / Railway). |
| `tools/verify_region_config.mjs` | Harness que ejercita los exportadores reales y verifica el contrato. |
| `js/telemetry.js` | Medición local de uso (opt-in, sin red, sin datos personales). |
| `tools/telemetry_report.mjs` | Analiza el JSON de medición y traduce cada umbral superado en una acción. |
| `tools/verify_telemetry.mjs` | Verifica las garantías de la telemetría (sin red, sin PII, a prueba de fallos). |
| `.github/workflows/ci.yml` | CI: contrato, telemetría, backend e higiene del repo en cada PR. |

Ediciones **mínimas** a archivos existentes (solo wiring, contrato intacto):

1. `js/core.js` → `resolveComunaName`: fallback CUT→nombre vía `region_config`
   (permite operar sin maestro de localidades ni GeoJSON).
2. `js/app.js` → `normalizeData`: siembra el diccionario de comunas con
   `comunaSeed()`; `applyRegionConfigUI()` marca el título (XIV) y condiciona SIGEC.
3. `index.html` → `<title>` marca XIV Los Ríos; `id` estable en el bloque SIGEC.
4. `package.json` → `"type": "module"` (declara lo que el código ya es: ES modules;
   no afecta al navegador ni a `serve`; habilita el harness Node).

## Geocodificación en Los Ríos

Los Ríos **no tiene catastro de predios propio publicado**. El motor es
**Nominatim / OpenStreetMap** (`geocoder.primary: 'nominatim'`), que corre
client-side y **requiere red saliente** a `openstreetmap.org`.

**SIGEC en XIV está sin catastro regional.** El backend vivía en Railway y murió
al vencer el trial. `geocoder.sigec.url` queda **vacía a propósito**: con URL
vacía y `regionCode: '14'`, `js/sigec-client.js` declara SIGEC *no disponible* en
vez de consultar el catastro de Araucanía con un CUT de Los Ríos — que devuelve
cero y no explica nada. El modal ⚙ muestra el motivo y el Auto-Urbanos queda
deshabilitado.

Para reactivarlo: levantar `server/` (o un PostgREST sobre el catastro XIV) y
pegar la URL en **⚙ APIs** — nunca en el repo; el CI corta el build si aparece
una URL `*.up.railway.app` en el front. Detalle en
`docs/comunicaciones/03_despliegue_y_entornos.md`.

## Contrato de salida (UNIVERSAL — no se toca)

- Dominios de tipo geo: `1 LOCALIDAD · 2 EXACTO · 3 CALLE · 4 NO GEO`.
- Columnas de salida: `run, tipo_geo_id, latitud, longitud` (+ `calle/numero/localidad/resto` en GeoJSON).
- **`RUN` como llave** de match hacia SIGEA.
- **Regla de oro: "NO GEO no se recalcula"** — conserva siempre la coordenada original del padrón.

## Verificación local

```bash
node tools/verify_region_config.mjs            # contrato SIGE + region_config
node tools/verify_telemetry.mjs                # medición: sin red, sin datos personales
node --test server/test/contract.test.mjs      # contrato del backend SIGEC
```

El primero ejercita los exportadores **reales** (`js/io.js`) con el padrón de
prueba y verifica columnas de salida, que NO GEO conserva coordenadas originales,
que EXACTO usa la coordenada corregida, RUN como llave, y que `region_config`
resuelve CUT→nombre contra el canon oficial de 5 dígitos.

Los tres corren en cada PR vía `.github/workflows/ci.yml`. Antes de eso, los
únicos "checks" del repo eran los deploys de Railway: el PR #1 se mergeó en verde
con este harness fallando 16 de 32 aserciones.

### CUT: 5 dígitos, no correlativos

El código único territorial de Los Ríos es de **5 dígitos** y no es correlativo
—la provincia del Ranco parte en `142xx`:

`14101` Valdivia · `14102` Corral · `14103` Lanco · `14104` Los Lagos ·
`14105` Máfil · `14106` Mariquina · `14107` Paillaco · `14108` Panguipulli ·
`14201` La Unión · `14202` Futrono · `14203` Lago Ranco · `14204` Río Bueno

Una versión anterior usó códigos correlativos de 4 dígitos (`1401`…`1412`) que no
existen como CUT oficial. **No se agregó una tabla de alias 4→5**: el mapeo no es
derivable (`1409` → `14201`) y no hay evidencia de que ese formato circule en
planillas reales. En vez de adivinar, la telemetría registra los CUT que no
resuelven para decidirlo con datos.

## Medición de uso

`js/telemetry.js` acumula contadores **locales** de cómo se usa el SIGE —tipos
finales, tiempos de decisión, éxito y latencia de cada geocoder, CUT sin
resolver— para priorizar mejoras con evidencia. Opt-in en ⚙ APIs, sin red, sin
datos personales. El análisis se hace con:

```bash
node tools/telemetry_report.mjs sige_telemetria_*.json
```

Ver `docs/comunicaciones/04_medicion_de_uso.md`.

## Replicar en otra región

```bash
cp js/region-config.template.js js/region-config.js
# rellenar region, codigo, geocoder y comunas → listo
```

## Estado

Piloto/demo con **datos ficticios**. **No** desplegar a producción con padrón real
hasta que **SERVEL** defina qué cuenta institucional aloja producción (dato
electoral). El servicio y URL de Railway son paso del Director.
