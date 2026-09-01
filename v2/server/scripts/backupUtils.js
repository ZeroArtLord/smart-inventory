import path from 'node:path';

export function parsePostgresUrl(databaseUrl) {
  const url = new URL(databaseUrl);

  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    throw new Error('DATABASE_URL debe usar postgres:// o postgresql://');
  }

  const database = decodeURIComponent(
    String(url.pathname || '').replace(/^\//, '')
  );

  if (!database) {
    throw new Error('DATABASE_URL no contiene nombre de base de datos');
  }

  return {
    host: url.hostname || '127.0.0.1',
    port: url.port || '5432',
    user: decodeURIComponent(url.username || ''),
    password: decodeURIComponent(url.password || ''),
    database
  };
}

export function buildBackupFilename(now = new Date()) {
  const stamp = now
    .toISOString()
    .replace(/[:.]/g, '-');
  return `smart_inventory_${stamp}.dump`;
}

export function resolveBackupDir(value, cwd = process.cwd()) {
  const raw = String(value || '').trim();
  return raw ? path.resolve(raw) : path.resolve(cwd, 'backups');
}

export function isExpiredBackup(stat, {
  now = Date.now(),
  retentionDays = 14
} = {}) {
  const ageMs = now - Number(stat?.mtimeMs || 0);
  return ageMs > Math.max(1, Number(retentionDays) || 14) * 86400000;
}
