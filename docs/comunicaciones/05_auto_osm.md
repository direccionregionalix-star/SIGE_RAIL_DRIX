# 05 — Auto-OSM: lote asistido para regiones sin catastro propio

## El hueco que tapa

El **Auto-Urbanos** del SIGE consulta SIGEC, el catastro de predios. Araucanía
lo tiene; Los Ríos no. Resultado: en la instancia XIV el operador no tenía
**ningún** modo automático — apretaba 📍 Nominatim cluster por cluster, uno por
uno, toda la jornada. Ese era el problema de comodidad más grande de la
instancia, bastante por encima de los textos equivocados.

**Auto-OSM** (botón 🌍 junto al Auto-Urbanos) recorre los clusters pendientes sin
coordenada y propone una. Como el Auto-Urbanos, **todo queda "Por revisar"**:
propone, no decide.

## La restricción que manda: la política de uso de OSM

Nominatim es un servicio gratuito sostenido por donaciones. Abusarlo hace que
bloqueen la IP — y esa IP es la de SERVEL, compartida por toda la institución.
La política distingue **dos regímenes**, y por eso el botón tiene dos modos:

| Modo | Espaciado | Tope | Para qué |
|---|---|---|---|
| **Asistido** | 1,1 s | 60 consultas nuevas | Uso interactivo, el operador mirando. ~1 min. |
| **Masivo** | 15 s (4/min) | sin tope | Lote largo. Miles de registros = horas. Pausable. |

No son una preferencia de velocidad: son los dos regímenes que la política
trata distinto. El modo masivo exige además **una sola máquina** y **un solo
hilo** — el módulo no tiene un solo `Promise.all`, es un bucle secuencial, y el
harness lo verifica lanzando una excepción si detecta dos consultas en vuelo.

> **Sé honesto con el volumen.** 2.000 clusters en modo masivo son ~8 horas de
> reloj. Si el volumen habitual de una entrega es de ese orden, Nominatim no es
> la herramienta: lo es un catastro propio (levantar SIGEC XIV) o un proveedor
> pago. El SIGE ya tiene el campo de API key de Google en ⚙ para ese caso.

## Lo que de verdad baja el costo

No es el modo. Son estas dos cosas, y se notan desde la primera jornada:

**Caché local.** Obligatorio por política —repetir la misma consulta te
clasifica como cliente defectuoso— y además es la mejora de rendimiento real:
un padrón repite muchísima dirección. Se cachean también los **fallos**: lo que
ya sabemos que Nominatim no tiene, no se vuelve a preguntar. Dura 180 días.

**Cascada progresiva.** Antes se mandaba `calle, comuna, Chile` de una sola
forma; si OSM no la tenía así, el registro se perdía. Ahora baja de lo específico
a lo general y **para en el primer acierto**:

| Nivel | Consulta | Precisión | Tipo que propone |
|---|---|---|---|
| 1 | calle + número | portal | EXACTO |
| 2 | solo calle | eje de calle | CALLE |
| 3 | localidad | lugar poblado | LOCALIDAD |

El tipo propuesto sale del nivel que **efectivamente acertó**, no del que
quisiéramos. Si resolvió por nombre de calle, propone CALLE, no EXACTO: no
inventamos precisión que no tenemos, y el operador ve en el método con qué se
resolvió (`Auto-OSM · calle`) antes de confirmar.

## Cómo saber si está sirviendo

La telemetría registra `candidatos` contra `consultasRed`. Si la brecha es
grande, el caché y la cascada están trabajando. Si son casi iguales, el padrón
trae direcciones todas distintas y conviene revisar la normalización antes de
gastar más consultas.
