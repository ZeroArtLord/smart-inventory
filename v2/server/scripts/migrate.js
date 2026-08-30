import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Client } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationsDir = path.resolve(__dirname, '../migrations');

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('Falta DATABASE_URL');
}

const client = new Client({ connectionString });
await client.connect();

try {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  const files = (await fs.readdir(migrationsDir))
    .filter(name => /^\d+.*\.sql$/i.test(name))
    .sort();

  for (const filename of files) {
    const exists = await client.query(
      'SELECT 1 FROM schema_migrations WHERE filename = $1',
      [filename]
    );

    if (exists.rowCount > 0) {
      console.log(`✓ ${filename} ya aplicada`);
      continue;
    }

    const rawSql = await fs.readFile(
      path.join(migrationsDir, filename),
      'utf8'
    );
    const sql = stripOuterTransaction(rawSql);

    console.log(`→ aplicando ${filename}`);

    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query(
        'INSERT INTO schema_migrations (filename) VALUES ($1)',
        [filename]
      );
      await client.query('COMMIT');
      console.log(`✓ ${filename}`);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  }

  console.log('Migraciones completadas.');
} finally {
  await client.end();
}

function stripOuterTransaction(sql) {
  return String(sql)
    .replace(/^\s*BEGIN\s*;?/i, '')
    .replace(/COMMIT\s*;?\s*$/i, '')
    .trim();
}
