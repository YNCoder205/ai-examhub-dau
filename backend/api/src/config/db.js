const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME || 'ai_examhub_dau',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '123456',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
});

/**
 * Query helper — wraps pool.query for convenience.
 * @param {string} text  SQL query string
 * @param {any[]}  params  Parameterised values
 */
const query = (text, params) => pool.query(text, params);

module.exports = { pool, query };
