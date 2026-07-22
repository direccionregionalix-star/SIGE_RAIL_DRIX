// server/sigec.js — Construcción de la consulta SIGEC (capa HTTP delante de Neon)
// ═══════════════════════════════════════════════════════════════════════════════
// Este módulo NO abre conexiones ni lee secretos: solo arma el SQL parametrizado
// y valida los identificadores del esquema. Es puro y testeable (ver test/).
//
// El navegador NUNCA ve la cadena de Postgres. El cliente estático (js/sigec-client.js)
// llama por HTTPS a este backend, que corre la query con la credencial que vive
// SOLO como variable de entorno del servidor.
//
// Esquema real (Neon Los Ríos, verificado por introspección):
//   catastro_atributos(id_parcela, cut_estandar, direccion, destino,
//                      avaluo_total, superficie_terreno, villa, apodo)
//   catastro_geom(id_parcela, geometry)   ← PostGIS
//   unidas por id_parcela. PostGIS presente; pg_trgm NO (por eso ILIKE por defecto).
//
// Contrato de salida (idéntico al SIGEC de Araucanía, para no tocar el cliente):
//   rol, direccion, comuna_nom, destino, sector, lat, lon, area_m2,
//   match_method, geom_geojson, score

// Mapa de esquema. Overridable por variables de entorno (ver .env.example).
// Los defaults corresponden al esquema REAL de la base Neon de Los Ríos.
export function schemaFromEnv(env = process.env) {
  return {
    tableAttr:  env.SIGEC_TABLE_ATTR || 'catastro_atributos',
    tableGeom:  env.SIGEC_TABLE_GEOM || 'catastro_geom',
    joinKey:    env.SIGEC_JOIN_KEY   || 'id_parcela',
    colRol:     env.SIGEC_COL_ROL    || 'id_parcela',
    colDir:     env.SIGEC_COL_DIR    || 'direccion',
    colCut:     env.SIGEC_COL_CUT    || 'cut_estandar',
    colDestino: env.SIGEC_COL_DESTINO|| 'destino',
    colSector:  env.SIGEC_COL_SECTOR || 'villa',
    colSector2: env.SIGEC_COL_SECTOR2 ?? 'apodo',   // '' para desactivar el COALESCE
    colArea:    env.SIGEC_COL_AREA   || 'superficie_terreno',
    colGeom:    env.SIGEC_COL_GEOM   || 'geometry',
    // SRID de origen de la geometría. 0 = autodetectar (0→asumir 4326, 4326→tal cual,
    // otro→ST_Transform). Si la geometría viene en UTM sin SRID, fijar aquí (ej. 32718/32719).
    srid:       parseInt(env.SIGEC_SRID, 10) || 0,
    fuzzy:      (env.SIGEC_FUZZY || 'ilike').toLowerCase() // 'trgm' (pg_trgm) | 'ilike'
  };
}

// Traducción CUT SII (4 díg.) → CUT INE/estándar (5 díg.) para Los Ríos.
// La base catastro guarda el código INE de 5 dígitos (ej. '14102' = Corral),
// pero el padrón/cliente manda el SII de 4 dígitos (ej. '1402'). Ojo con el
// salto de provincia: Valdivia 141xx (1401-1408) y Ranco 142xx (1409-1412).
export const CUT_SII_TO_INE = {
  '1401': '14101', // VALDIVIA
  '1402': '14102', // CORRAL
  '1403': '14103', // LANCO
  '1404': '14104', // LOS LAGOS
  '1405': '14105', // MAFIL
  '1406': '14106', // MARIQUINA
  '1407': '14107', // PAILLACO
  '1408': '14108', // PANGUIPULLI
  '1409': '14201', // LA UNION   (provincia del Ranco)
  '1410': '14202', // FUTRONO
  '1411': '14203', // LAGO RANCO
  '1412': '14204'  // RIO BUENO
};

// Traduce el CUT entrante al formato de la base. Idempotente: si ya viene en
// 5 dígitos (o no está en el mapa), lo devuelve tal cual.
export function mapComuna(cut) {
  const c = String(cut ?? '').trim();
  return CUT_SII_TO_INE[c] || c;
}

// Valida un identificador SQL simple (o esquema.tabla) para evitar inyección al
// interpolar nombres de columna/tabla (los VALORES siempre van parametrizados).
export function assertIdent(name) {
  const parts = String(name).split('.');
  for (const p of parts) {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(p)) {
      throw new Error(`Identificador SQL inválido: ${name}`);
    }
  }
  return name;
}

function id(s) { return assertIdent(s); }

// Expresión SQL que devuelve la geometría reproyectada a WGS84 (EPSG:4326).
function geom4326Expr(s) {
  const g = `g.${id(s.colGeom)}`;
  if (s.srid && s.srid > 0) {
    return `ST_Transform(ST_SetSRID(${g}, ${s.srid | 0}), 4326)`;
  }
  return `CASE
            WHEN ST_SRID(${g}) = 0    THEN ST_SetSRID(${g}, 4326)
            WHEN ST_SRID(${g}) = 4326 THEN ${g}
            ELSE ST_Transform(${g}, 4326)
          END`;
}

/**
 * Arma la consulta de búsqueda de predios por comuna (CUT) + fragmento de dirección.
 * @param {object} schema  resultado de schemaFromEnv()
 * @param {{comuna:string, query:string, limite?:number}} p
 * @returns {{text:string, values:any[]}}
 */
export function buildBuscarQuery(schema, p) {
  const s = schema;
  const comuna = mapComuna(p.comuna);   // SII 4 díg. → INE 5 díg. (formato de la base)
  const query  = String(p.query  ?? '').trim();
  const limite = Math.min(Math.max(parseInt(p.limite, 10) || 20, 1), 100);

  const dir = `a.${id(s.colDir)}`;
  const sector = s.colSector2
    ? `COALESCE(a.${id(s.colSector)}, a.${id(s.colSector2)})`
    : `a.${id(s.colSector)}`;

  // Filtro y score. 'trgm' requiere: CREATE EXTENSION IF NOT EXISTS pg_trgm;
  const usaTrgm = s.fuzzy === 'trgm';
  const scoreExpr   = usaTrgm ? `similarity(lower(${dir}), lower($2))` : `0.5::float`;
  const whereFuzzy  = usaTrgm ? `lower(${dir}) % lower($2)` : `${dir} ILIKE '%' || $2 || '%'`;
  const matchMethod = usaTrgm ? `'trgm'` : `'ilike'`;

  const g4326 = geom4326Expr(s);

  const text =
    `SELECT
       a.${id(s.colRol)}      AS rol,
       ${dir}                 AS direccion,
       a.${id(s.colCut)}      AS comuna_nom,
       a.${id(s.colDestino)}  AS destino,
       ${sector}              AS sector,
       ST_Y(ST_Centroid(${g4326})) AS lat,
       ST_X(ST_Centroid(${g4326})) AS lon,
       a.${id(s.colArea)}     AS area_m2,
       ${matchMethod}         AS match_method,
       ST_AsGeoJSON(${g4326}) AS geom_geojson,
       ${scoreExpr}           AS score
     FROM ${id(s.tableAttr)} a
     JOIN ${id(s.tableGeom)} g ON g.${id(s.joinKey)} = a.${id(s.joinKey)}
     WHERE a.${id(s.colCut)}::text = $1
       AND g.${id(s.colGeom)} IS NOT NULL
       AND ${whereFuzzy}
     ORDER BY score DESC
     LIMIT $3`;

  return { text, values: [comuna, query, limite] };
}
