# 04 — Medición de uso: mejorar el SIGE con datos, desde nuestro lado

## Por qué

Las mejoras al SIGE se venían decidiendo por impresión: *"parece que se demoran
en los rurales"*, *"parece que Nominatim falla harto"*. Ninguna de esas frases se
puede priorizar ni defender ante un director. Este módulo las convierte en
números que **nosotros** podemos levantar sin depender de que Los Ríos cambie
nada de su lado — que es justamente la restricción con la que trabajamos.

## Qué mide y qué NO

| Mide | No mide |
|---|---|
| Cuántos clusters terminan EXACTO / CALLE / LOCALIDAD / NO GEO | Ningún RUN |
| Cuánto demora decidir un cluster (histograma) | Ninguna dirección |
| Tasa de éxito, "sin resultado" y error de cada geocoder, con latencia | Ninguna coordenada individual |
| Cuántas veces se reclasifica un cluster ya decidido | Ninguna secuencia temporal de acciones |
| Qué códigos de comuna (CUT) **no resuelve** el `region_config` | Nada que identifique a un operador |
| Intentos de usar SIGEC sin catastro regional | |
| Rendimiento del Auto-Urbanos y del cruce de reasignación | |

El CUT es código de **territorio**, no de persona: es el único identificador que
se guarda, y a propósito, porque es el que diagnostica el problema más caro que
tenemos (planillas que llegan en un formato que el sistema no sabe leer).

## Garantías, verificadas en CI

`tools/verify_telemetry.mjs` corre en cada PR y asevera:

- que `js/telemetry.js` **no contiene** `fetch`, `XMLHttpRequest`, `sendBeacon`,
  `WebSocket` ni `EventSource` — no hay canal de salida, punto;
- que arranca **apagado** y que apagado no registra nada;
- que el volcado no contiene RUN, direcciones ni coordenadas (se busca el patrón
  a la fuerza sobre el JSON serializado);
- que **ninguna** anotación lanza excepción con el `localStorage` bloqueado.

Esa última importa más de lo que parece: medir no puede costarle el turno a
nadie. Si la medición falla, falla en silencio y el SIGE sigue.

## Ciclo de trabajo

1. El analista activa **⚙ APIs → Medición de uso** en su equipo (opt-in explícito).
2. Trabaja normal. Los contadores se acumulan en su `localStorage`.
3. Al cierre de la jornada o de la entrega: **📥 Descargar medición** → un JSON.
4. Ese JSON llega a nosotros por el canal que ya usamos (correo, SharePoint).
5. `node tools/telemetry_report.mjs medicion_*.json` — acepta varios archivos y
   los suma, así que se puede consolidar a todo el equipo en un comando.

## De número a decisión

El reporte no vuelca contadores y se lava las manos: cada hallazgo sobre umbral
trae la acción concreta. Ejemplos de la tabla de umbrales actual:

- **CUT sin resolver > 0** → el padrón llega en un formato que el `region_config`
  no lee. Decidir si se agrega el mapeo (documentando su fuente) o se corrige
  aguas arriba. *Deliberadamente no inventamos una tabla de alias 4→5 dígitos:
  el mapeo no es derivable (1409 → 14201) y no hay evidencia de que ese formato
  circule. La telemetría es lo que va a decidirlo.*
- **NO GEO > 15%** → es deuda que vuelve en la próxima entrega. Cruzar contra las
  comunas más frecuentes: si se concentra en pocas comunas rurales, falta maestro
  de localidades, no esfuerzo del operador.
- **Geocoder con éxito < 70%** → el reporte distingue si predominan *errores*
  (infraestructura: endpoint caído, CORS, rate limit) o *sin resultado* (calidad
  de la dirección). Son dos arreglos completamente distintos y hasta ahora se
  confundían.
- **Reclasificaciones > 10%** → reclasificar es dudar: el criterio no está claro
  en la UI o la pre-clasificación propone mal.
- **Intentos de SIGEC indisponible > 0** → hay demanda real de catastro XIV.
  Es el argumento con evidencia para pedir levantar el backend, o la razón para
  sacar el botón de la vista.

**Los umbrales de `tools/telemetry_report.mjs` son hipótesis de partida, no
verdades.** La primera medición de Los Ríos sirve para calibrarlos; cuando haya
línea base real se ajustan ahí, con el porqué escrito al lado.

## Relación con el reporter

`js/reporter.js` publica **avance** (cuánto se lleva georreferenciado) a un repo
de estado, con token de GitHub por funcionario. Esto mide **uso** (cómo se llega
a ese avance) y no sale del navegador. Son complementarios y no se pisan: uno
responde *¿vamos bien?*, el otro *¿por qué nos cuesta?*.
