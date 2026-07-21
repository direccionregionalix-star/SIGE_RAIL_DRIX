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

Ediciones **mínimas** a archivos existentes (solo wiring, contrato intacto):

1. `js/core.js` → `resolveComunaName`: fallback CUT→nombre vía `region_config`
   (permite operar sin maestro de localidades ni GeoJSON).
2. `js/app.js` → `normalizeData`: siembra el diccionario de comunas con
   `comunaSeed()`; `applyRegionConfigUI()` marca el título (XIV) y condiciona SIGEC.
3. `index.html` → `<title>` marca XIV Los Ríos; `id` estable en el bloque SIGEC.
4. `package.json` → `"type": "module"` (declara lo que el código ya es: ES modules;
   no afecta al navegador ni a `serve`; habilita el harness Node).

## Geocodificación en Los Ríos

Los Ríos **no tiene padrón de predios propio** (`geocoder.primary: null`). Se usa
**Nominatim / OpenStreetMap** como motor (`geocoder.fallback: 'nominatim'`), que
corre client-side y **requiere red saliente** a `openstreetmap.org`.

El geocodificador **SIGEC** (predios SII de Araucanía, 576k) **NO se desactiva**:
sigue disponible como consulta cruzada, pero la UI lo marca *opcional* mientras la
región activa no lo use como primario.

## Contrato de salida (UNIVERSAL — no se toca)

- Dominios de tipo geo: `1 LOCALIDAD · 2 EXACTO · 3 CALLE · 4 NO GEO`.
- Columnas de salida: `run, tipo_geo_id, latitud, longitud` (+ `calle/numero/localidad/resto` en GeoJSON).
- **`RUN` como llave** de match hacia SIGEA.
- **Regla de oro: "NO GEO no se recalcula"** — conserva siempre la coordenada original del padrón.

## Verificación local

```bash
node tools/verify_region_config.mjs
```

Ejercita los exportadores **reales** (`js/io.js`) con el padrón de prueba y verifica
columnas de salida, que NO GEO conserva coordenadas originales, que EXACTO usa la
coordenada corregida, RUN como llave, y que `region_config` resuelve CUT→nombre.

## Replicar en otra región

```bash
cp js/region-config.template.js js/region-config.js
# rellenar region, codigo, geocoder y comunas → listo
```

## Estado

Piloto/demo con **datos ficticios**. **No** desplegar a producción con padrón real
hasta que **SERVEL** defina qué cuenta institucional aloja producción (dato
electoral). El servicio y URL de Railway son paso del Director.
