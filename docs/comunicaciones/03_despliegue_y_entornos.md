# 03 — Despliegue, entornos y qué migración estamos haciendo en realidad

## El problema de fondo: son TRES migraciones, no una

Se venían tratando como un solo movimiento, y por eso se enredaron. Separadas:

| # | Migración | De | A | Estado |
|---|---|---|---|---|
| 1 | **De repositorio** | `SebaGeoZ92/SIGE_RAIL` (personal) | `direccionregionalix-star/SIGE_RAIL_DRIX` (DR) | ✅ Hecha |
| 2 | **De región** (transferencia tecnológica) | Araucanía (IX) | Los Ríos (XIV) | 🟡 Código listo, catastro no |
| 3 | **De hosting** | Railway | GitHub Pages | 🟡 De hecho ya ocurrió, sin decidirse |

Cada una tiene un dueño y un criterio de término distinto. Mezclarlas es lo que
produjo el PR #1: un merge que movió repositorio, región y supuestos de
despliegue al mismo tiempo, sin que ninguna de las tres quedara cerrada.

## Migración 3 en detalle: Railway vs GitHub Pages

Lo que confundía era que Railway alojaba **dos servicios distintos** del mismo repo:

- **Servicio estático** (`…-a337`): corría `npx serve .` sobre la raíz. Eso es
  *exactamente* lo mismo que hace GitHub Pages. No aportaba nada que Pages no dé.
- **Servicio backend** (`…-6c8c`): corría `server/index.js`, el SIGEC de Los Ríos
  sobre Neon Postgres, con `DATABASE_URL` como variable de entorno. **Esto Pages
  no puede hacerlo jamás**: Pages sirve archivos, no ejecuta procesos ni guarda
  secretos.

Al vencer el trial murieron los dos. Pages siguió arriba y el front sigue
funcionando; lo único que se perdió fue el geocodificador SIGEC regional.

### Regla que adoptamos

> **El front va en GitHub Pages. Siempre. Es estático, versionado y gratis.**
> Railway (o lo que lo reemplace) es solo para `server/`, y su URL **nunca** se
> hardcodea en el repo: se configura en el modal ⚙ APIs, que vive en el
> localStorage de cada equipo.

El CI corta el build si vuelve a aparecer una URL `*.up.railway.app` en el front
(`.github/workflows/ci.yml`, job *higiene*). No es purismo: una URL de trial
hardcodeada en un repo público es una bomba de tiempo que estalla en silencio
—el botón queda ahí, se aprieta, no pasa nada, y nadie sabe por qué.

## Cómo está quedando la degradación

Con `sigec.url` vacío y `regionCode: '14'`, `js/sigec-client.js` declara SIGEC
**no disponible** en vez de consultar el catastro de Araucanía con un CUT de Los
Ríos (que devuelve cero y no explica nada). El front lo dice en el modal ⚙,
deshabilita el Auto-Urbanos, y la telemetría cuenta cada intento fallido.

Ese contador es la métrica que decide la migración 2: si los analistas de Los
Ríos intentan usar SIGEC muchas veces, hay demanda real para levantar el catastro
XIV. Si no lo intentan nunca, Nominatim basta y el backend no se repone.

## Lo que sigue bloqueado (y no lo desbloquea el código)

1. **Cuenta institucional de producción.** Es padrón electoral. Mientras SERVEL
   no zanje qué cuenta aloja producción, esto es piloto con datos ficticios. El
   CI ahora impide versionar un padrón real por accidente (job *higiene*).
2. **Catastro de predios XIV.** Los Ríos no tiene equivalente al SII de
   Araucanía publicado. Sin eso, SIGEC regional no existe, con o sin Railway.
3. **Repo de estado del reporter.** `js/reporter.js` publica el avance a
   `SebaGeoZ92/sigea_estado` — una cuenta **personal**. Si el repo canónico se
   movió a la DR, el repo de estado debería moverse también; si no, el avance
   institucional de Los Ríos queda escribiéndose en el GitHub personal de un
   funcionario. No se tocó en este PR porque es decisión, no código.
