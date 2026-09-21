// server/db.js — Pool de Postgres (Neon). La credencial vive SOLO aquí, en el
// servidor, leída de process.env.DATABASE_URL. Nunca se envía al navegador.
// ═══════════════════════════════════════════════════════════════════════════════
// `pg` se importa de forma perezosa para que los tests de contrato (que inyectan
// un runner falso) no necesiten la dependencia ni una base real.

let _pool = null;

async function getPool() {
  if (_pool) return _pool;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('Falta DATABASE_URL (cadena de conexión de Neon, solo servidor).');
  const { default: pg } = await import('pg');
  _pool = new pg.Pool({
    connectionString: url,
    // Neon exige TLS. El pooler ya viene en la URL (…-pooler.…neon.tech).
    ssl: { rejectUnauthorized: false },
    max: parseInt(process.env.PG_POOL_MAX, 10) || 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000
  });
  return _pool;
}

// runner que consumen los handlers: ejecuta SQL parametrizado y devuelve filas.
export async function runQuery(text, values) {
  const pool = await getPool();
  const res = await pool.query(text, values);
  return res.rows;
}
