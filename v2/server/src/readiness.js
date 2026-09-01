import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationsDir = path.resolve(__dirname, '../migrations');

export async function getReadiness() {
  const expected = (await readdir(migrationsDir))
    .filter(name => /^\d+_.*\.sql$/i.test(name))
    .sort();

  let applied = [];

  try {
    const result = await pool.query(
      'SELECT filename FROM schema_migrations ORDER BY filename'
    );
    applied = result.rows.map(row => row.filename);
  } catch (error) {
    if (error?.code === '42P01') {
      return {
        ok: false,
        database: 'reachable',
        migrations: 'not-initialized',
        expected,
        applied: [],
        pending: expected
      };
    }
    throw error;
  }

  const appliedSet = new Set(applied);
  const pending = expected.filter(name => !appliedSet.has(name));

  return {
    ok: pending.length === 0,
    database: 'ok',
    migrations: pending.length === 0 ? 'ok' : 'pending',
    expected,
    applied,
    pending
  };
}
