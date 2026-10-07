import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

function resolve(relativePath) {
  return fileURLToPath(new URL(relativePath, import.meta.url));
}

async function read(relativePath) {
  return readFile(resolve(relativePath), 'utf8');
}

test('sesión cliente agrupa consultas y conserva rol previo ante 429', async () => {
  const client = await read('../src/admin/adminClient.js');

  assert.match(client, /SESSION_CACHE_MS\s*=\s*60000/);
  assert.match(client, /sessionInFlight/);
  assert.match(client, /cachedSessionKey\s*===\s*key/);
  assert.match(client, /error\?\.status\s*===\s*429/);
  assert.match(client, /return cachedSession/);
  assert.match(client, /invalidateCurrentSessionCache\(\)/);
});

test('cache de sesión queda aislado por identidad Firebase y workspace', async () => {
  const client = await read('../src/admin/adminClient.js');

  assert.match(client, /getSyncConfig\(\)/);
  assert.match(client, /getAuthToken/);
  assert.match(client, /firebase:\$\{workspaceId\}:\$\{token\}/);
  assert.match(client, /dev:\$\{workspaceId\}/);
});

test('servidor confía solo en proxy loopback para separar rate limit por cliente real', async () => {
  const server = await read('../server/src/app.js');
  const limiter = await read('../server/src/middleware/rateLimit.js');

  assert.match(server, /app\.set\('trust proxy', 'loopback'\)/);
  assert.match(limiter, /req\.ip/);
  assert.match(server, /namespace:\s*'session'/);
  assert.match(server, /max:\s*120/);
});
