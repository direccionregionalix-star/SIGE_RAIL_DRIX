# SIGEC Los Ríos — backend HTTP (capa segura delante de Neon)

Micro-servicio que expone el geocodificador de predios SII de **Los Ríos** al SIGE
estático, replicando el contrato PostgREST que el cliente (`js/sigec-client.js`)
ya consume. Existe porque **el navegador no puede (ni debe) hablar con Postgres**:
la credencial de Neon vive **solo aquí, como variable de entorno del servidor**.

```
Navegador (SIGE)  ──HTTPS──►  este backend  ──Postgres/TLS──►  Neon (predios SII)
   sin credencial              DATABASE_URL (env)               rol read-only ideal
```

## Endpoints (idénticos al SIGEC de Araucanía)

| Método | Ruta | Cuerpo | Devuelve |
|---|---|---|---|
| `GET`  | `/health` | — | `{ ok:true }` |
| `POST` | `/rest/v1/rpc/sigec_buscar` | `{ p_comuna, p_query, p_limite?, p_umbral? }` | filas `rol, direccion, comuna_nom, destino, sector, lat, lon, area_m2, match_method, geom_geojson, score` |
| `POST` | `/rest/v1/rpc/sigec_registrar_seleccion` | `{ … }` | `204` (no-op por defecto) |

## Seguridad

- **`DATABASE_URL`**: cadena de Neon, **solo** env del servidor; nunca en el repo ni en el HTML.
  Recomendado un rol `SELECT`-only, no el owner:
  ```sql
  CREATE ROLE sige_ro LOGIN PASSWORD '…';
  GRANT CONNECT ON DATABASE neondb TO sige_ro;
  GRANT USAGE ON SCHEMA public TO sige_ro;
  GRANT SELECT ON <tabla_predios> TO sige_ro;
  ```
- **`SIGEC_API_KEY`** (opcional): key publicable read-only que el cliente manda como
  `apikey`/`Bearer`. **No** es la cadena de Postgres. Si se omite, el endpoint queda
  abierto (los predios SII son públicos).
- **CORS**: fijar `CORS_ORIGIN` al origen del SIGE de Los Ríos en producción.
- El input del usuario **siempre** va parametrizado (`$1..$3`); los nombres de
  tabla/columna se validan como identificadores. Ver `sigec.js` y los tests.

## Esquema (base Neon de Los Ríos, verificado)

Los predios viven en dos tablas unidas por `id_parcela`, con geometría PostGIS:

```
catastro_atributos(id_parcela, cut_estandar, direccion, destino,
                   avaluo_total, superficie_terreno, villa, apodo)
catastro_geom(id_parcela, geometry)     -- PostGIS
```

Mapeo al contrato SIGEC (armado en `sigec.js`):

| contrato | origen |
|---|---|
| `rol` | `id_parcela` |
| `direccion` | `direccion` |
| `comuna_nom` | `cut_estandar` (código; el nombre lo resuelve el cliente vía region-config) |
| `destino` | `destino` |
| `sector` | `COALESCE(villa, apodo)` |
| `area_m2` | `superficie_terreno` |
| `lat` / `lon` | `ST_Y/ST_X(ST_Centroid(geometría→4326))` |
| `geom_geojson` | `ST_AsGeoJSON(geometría→4326)` |

Los defaults en [`.env.example`](.env.example) ya son estos; solo se ajustan si
cambia el esquema. **`pg_trgm` no está instalado** → por defecto `SIGEC_FUZZY=ilike`.
Para ranking difuso: `CREATE EXTENSION pg_trgm;` y `SIGEC_FUZZY=trgm`.

**SRID confirmado:** las geometrías ya están en **EPSG:4326** (220k filas; ~1.9k con
geometría nula, que el backend filtra con `IS NOT NULL`). Por eso `SIGEC_SRID=0`
(autodetección) es correcto — no hay que fijarlo.

**Traducción de CUT (importante):** la base usa el CUT **INE de 5 dígitos**
(`cut_estandar`, ej. `14102` = Corral), pero el padrón/cliente manda el **SII de
4 dígitos** (`1402`). El backend traduce automáticamente (`mapComuna`, ver
`sigec.js`), incluido el salto de provincia (La Unión `1409` → `14201`). Si el
padrón real ya viniera en 5 dígitos, la traducción es idempotente (passthrough).

## Correr local

```bash
cd server
cp .env.example .env         # completa DATABASE_URL (git ignora .env)
npm install
npm start                    # http://localhost:3000/health
npm test                     # tests de contrato (no requieren base real)
```

## Deploy en Railway (paso del Director)

1. Nuevo servicio Railway apuntando a este repo, **Root Directory = `server/`**.
2. Variables: `DATABASE_URL` (cadena de Neon), y las `SIGEC_COL_*` / `SIGEC_TABLE`
   según el esquema real; opcional `SIGEC_API_KEY` y `CORS_ORIGIN`.
3. Deploy. Railway inyecta `PORT`. Verifica `GET /health`.
4. Copia la **URL pública** del servicio.

## Cablear el SIGE de Los Ríos a este backend

Una vez con la URL (y, si aplica, la key publicable):

1. En `js/region-config.js` → `geocoder.primary: 'sigec'`.
2. Apuntar el cliente SIGEC a esta URL/key. Dos opciones:
   - **Rápida:** en la app, ⚙ → configuración avanzada SIGEC → pegar URL + key.
   - **Definitiva:** hacer que `js/sigec-client.js` tome su URL/key por defecto de
     `region-config.js` (pequeño cambio de cliente; te lo dejo listo cuando el
     endpoint exista).

El contrato de salida del SIGE (run, tipo_geo_id, latitud, longitud, …) **no cambia**.
