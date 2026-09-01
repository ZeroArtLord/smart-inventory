import 'dotenv/config';
import {
  access
} from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import {
  resolveBackupDir,
  findNewestBackup
} from './backupUtils.js';

const backupDir = resolveBackupDir(process.env.BACKUP_DIR);
const executable = process.env.PG_RESTORE_PATH || 'pg_restore';
const explicit = process.argv[2]
  ? path.resolve(process.argv[2])
  : null;

const filePath = explicit || await findNewestBackup(backupDir);
await access(filePath);

await run(executable, ['--list', filePath]);

console.log(`Backup verificable por pg_restore: ${filePath}`);

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
