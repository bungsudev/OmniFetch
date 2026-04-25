/**
 * Database Connection Pool
 */

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  console.error('[DB] Unexpected error on idle client:', err);
});

pool.on('connect', () => {
  console.log('[DB] Connected to PostgreSQL');
});

/**
 * Execute a query
 */
async function query(text, params) {
  const start = Date.now();
  try {
    const result = await pool.query(text, params);
    const duration = Date.now() - start;
    if (duration > 1000) {
      console.warn(`[DB] Slow query (${duration}ms):`, text.slice(0, 100));
    }
    return result;
  } catch (err) {
    console.error('[DB] Query error:', err.message);
    throw err;
  }
}

/**
 * Get a client from pool (for transactions)
 */
async function getClient() {
  return pool.connect();
}

module.exports = { pool, query, getClient };
