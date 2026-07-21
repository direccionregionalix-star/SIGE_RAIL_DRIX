# 01 — Contexto: repositorio canónico

## Repositorio de producción

El repositorio **canónico de producción** es
`direccionregionalix-star/SIGE_RAIL_DRIX` (confirmado por el proto-admin de SIGE).
Es el que alimenta el deploy de Railway.

## Por qué no el repo personal

`SebaGeoZ92/SIGE_RAIL` (personal) es el **origen histórico**, pero quedó
**desactualizado/divergido**. Evidencia comparando `app.js`:

- Personal `app.js` (raíz): 1817 líneas · sha256 `09fb3d9e…`
- Personal `js/app.js`: 1697 líneas · sha256 `0d5fb311…`
- **Canónico (referencia proto-admin): 1661 líneas · sha256 `074e05b8…`**

El personal tiene **dos** `app.js`; el canónico tiene **uno** (~1661 líneas), señal
de una consolidación/refactor posterior (refactor "Auto-Urbanos" + fix de
SyntaxError) que el personal no incluye.

## Verificación en DRIX (PASO 0)

Confirmado en este repositorio:

- `js/app.js` → **1661 líneas**
- sha256 → **`074e05b8b85ca686d13b271deb977cfc147c0440448db083c7e6e08638b03eb4`**

Coincide **exactamente** con la referencia canónica. La estructura de DRIX es
**modular** (`js/core.js`, `js/io.js`, `js/normalizer.js`, `js/coords.js`,
`js/constants.js`, …), un único `app.js` bajo `js/`.

> Pendiente de PASO 0.2 (externo): contrastar el hash del `app.js` **servido** por
> Railway (consola F12 sobre la URL de producción) contra el del repo. Si difieren,
> hay drift deploy↔repo y debe resolverse antes de desplegar.

## Implicancia

El `region_config` de Los Ríos se re-aplica **aquí, sobre DRIX** (base correcta),
no sobre el repo personal. El diff previo en el personal
(`claude/sige-xiv-los-rios-9kvu99`, PR #1 de SIGE_RAIL) sirvió de referencia de
patrón, pero el wiring se adaptó a la estructura real de DRIX.
