import 'dotenv/config';
import {
  mkdir,
  readdir,
  stat,
  unlink
} from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import {
  parsePostgresUrl,
  buildBackupFilename,
  resolveBackupDir,
  isExpiredBackup
} from './backupUtils.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('Falta DATABASE_URL');
}

const db = parsePostgresUrl(databaseUrl);
const backupDir = resolveBackupDir(process.env.BACKUP_DIR);
const retentionDays = Number(process.env.BACKUP_RETENTION_DAYS || 14);
const executable = process.env.PG_DUMP_PATH || 'pg_dump';

await mkdir(backupDir, { recursive: true });

const filename = buildBackupFilename();
const outputPath = path.join(backupDir, filename);

await run(executable, [
  '--format=custom',
  '--no-owner',
  '--no-privileges',
  '--file',
  outputPath,
  '--host',
  db.host,
  '--port',
  db.port,
  '--username',
  db.user,
  db.database
], {
  ...process.env,
  PGPASSWORD: db.password
});

await pruneOldBackups(backupDir, retentionDays);

console.log(`Backup creado: ${outputPath}`);

async function pruneOldBackups(dir, days) {
  const names = await readdir(dir);

  for (const name of names) {
    if (!/^smart_inventory_.*\.dump$/i.test(name)) continue;

    const filePath = path.join(dir, name);
    const info = await stat(filePath);

    if (isExpiredBackup(info, { retentionDays: days })) {
      await unlink(filePath);
      console.log(`Backup antiguo eliminado: ${name}`);
    }
  }
}

function run(command, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env,
      stdio: ['ignore', 'inherit', 'inherit'],
      windowsHide: true
    });

    child.on('error', error => {
      reject(new Error(
        `No se pudo ejecutar ${command}: ${error.message}`
      ));
    });

    child.on('exit', code => {
      if (code === 0) resolve();
      else reject(new Error(`${command} terminó con código ${code}`));
    });
  });
}
