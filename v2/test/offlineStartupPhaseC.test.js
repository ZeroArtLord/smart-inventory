import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

async function read(path) {
  return fs.readFile(new URL(path, import.meta.url), 'utf8');
}

test('Fase C arranca offline sin depender de Firebase runtime', async () => {
  const [app, bootstrap] = await Promise.all([
    read('../src/ui/app.js'),
    read('../src/auth/authBootstrap.js')
  ]);

  assert.match(app, /initializeOfflineApplicationAuth/);
  assert.match(app, /renderOfflineAuthGate/);
  assert.match(app, /state\.authAccessOffline = true/);
  assert.match(bootstrap, /getCachedFirebaseAccess/);
});

test('Fase C revalida acceso antes de sincronizar al recuperar conexión', async () => {
  const app = await read('../src/ui/app.js');

  assert.match(app, /revalidateOfflineAccessBeforeSync/);
  assert.match(app, /requireWorkspaceId/);
  assert.match(app, /authAccessOffline/);
  assert.match(app, /NO_ACTIVE_WORKSPACE|WORKSPACE_ACCESS_DENIED/);
});

test('Fase C nunca ofrece login Google nuevo sin conexión', async () => {
  const app = await read('../src/ui/app.js');

  assert.match(app, /Sin conexión/);
  assert.match(app, /Conéctate una vez/);
  assert.match(app, /data-offline-auth-gate/);
});

test('Fase C bloquea vistas de administración que requieren servidor vivo', async () => {
  const app = await read('../src/ui/app.js');

  assert.match(app, /isOfflineServerRequiredView/);
  assert.match(app, /users/);
  assert.match(app, /audit/);
});

test('Fase C muestra estado offline autorizado en la interfaz', async () => {
  const app = await read('../src/ui/app.js');

  assert.match(app, /Modo offline autorizado/);
  assert.match(app, /cachedOffline/);
});


test('Fase C no cambia de workspace usando permisos cacheados offline', async () => {
  const app = await read('../src/ui/app.js');

  assert.match(
    app,
    /Cambiar de almacén requiere conexión/
  );
  assert.match(
    app,
    /state\.authAccessOffline/
  );
});
