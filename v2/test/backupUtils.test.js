import test from 'node:test';
import assert from 'node:assert/strict';

const {
  parsePostgresUrl,
  buildBackupFilename,
  resolveBackupDir,
  isExpiredBackup
} = await import('../server/scripts/backupUtils.js');

test('parsePostgresUrl separa credenciales sin exponerlas en argumentos', () => {
  assert.deepEqual(
    parsePostgresUrl(
      'postgres://smart_inventory:p%40ss@127.0.0.1:5432/smart_inventory'
    ),
    {
      host: '127.0.0.1',
      port: '5432',
      user: 'smart_inventory',
      password: 'p@ss',
      database: 'smart_inventory'
    }
  );
});

test('buildBackupFilename produce nombre estable y seguro', () => {
  assert.equal(
    buildBackupFilename(new Date('2026-09-01T21:10:11.123Z')),
    'smart_inventory_2026-09-01T21-10-11-123Z.dump'
  );
});

test('isExpiredBackup respeta retención', () => {
  const now = new Date('2026-09-20T00:00:00.000Z').getTime();
  const old = {
    mtimeMs: new Date('2026-09-01T00:00:00.000Z').getTime()
  };
  const recent = {
    mtimeMs: new Date('2026-09-15T00:00:00.000Z').getTime()
  };

  assert.equal(isExpiredBackup(old, { now, retentionDays: 14 }), true);
  assert.equal(isExpiredBackup(recent, { now, retentionDays: 14 }), false);
});

test('resolveBackupDir acepta ruta relativa', () => {
  const result = resolveBackupDir('./backup-test', '/srv/app');
  assert.match(result, /backup-test$/);
});
