import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const files = [
  '../src/ui/app.js',
  '../sw.js'
];

for (const relativePath of files) {
  test(`sintaxis válida: ${relativePath}`, () => {
    const filePath = fileURLToPath(
      new URL(relativePath, import.meta.url)
    );

    const result = spawnSync(
      process.execPath,
      ['--check', filePath],
      {
        encoding: 'utf8'
      }
    );

    assert.equal(
      result.status,
      0,
      [
        `node --check falló para ${relativePath}`,
        result.stdout,
        result.stderr
      ].filter(Boolean).join('\n')
    );
  });
}
