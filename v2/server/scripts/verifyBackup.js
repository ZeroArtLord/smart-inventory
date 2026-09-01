import 'dotenv/config';
import {
  access,
  readdir,
  stat
} from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { resolveBackupDir } from './backupUtils.js';

const backupDir = resolveBackupDir(process.env.BACKUP_DIR);
const executable = process.env.PG_RESTORE_PATH || 'pg_restore';
const explicit = process.argv[2]
  ? path.resolve(process.argv[2])
  : null;

const filePath = explicit || await newestBackup(backupDir);
await access(filePath);

await run(executable, ['--list', filePath]);

console.log(`Backup verificable por pg_restore: ${filePath}`);

async function newestBackup(dir) {
  const names = (await readdir(dir))
    .filter(name => /^smart_inventory_.*\.dump$/i.test(name));

  if (!names.length) {
    throw new Error('No hay backups .dump para verificar');
  }

  const entries = await Promise.all(
    names.map(async name => ({
      name,
      info: await stat(path.join(dir, name))
    }))
  );

  entries.sort((a, b) => b.info.mtimeMs - a.info.mtimeMs);
  return path.join(dir, entries[0].name);
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'ignore', 'inherit'],
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
