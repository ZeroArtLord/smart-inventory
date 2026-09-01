import { STORES, get, put } from '../storage/database.js';

const KEYS = Object.freeze({
  CONFIG: 'sync.config',
  CURSOR: 'sync.cursor'
});

const DEFAULT_CONFIG = Object.freeze({
  apiBaseUrl: '',
  workspaceKey: 'establo2026',
  workspaceId: null,
  serverUserId: null,
  authMode: 'dev',
  enabled: true
});

export async function getSyncConfig() {
  const record = await get(STORES.SETTINGS, KEYS.CONFIG);
  const value = {
    ...DEFAULT_CONFIG,
    ...(record?.value || {})
  };

  if (!['dev', 'firebase'].includes(value.authMode)) {
    value.authMode = 'dev';
  }

  return value;
}

export async function saveSyncConfig(patch = {}) {
  const current = await getSyncConfig();
  const value = {
    ...current,
    ...patch
  };

  if (!['dev', 'firebase'].includes(value.authMode)) {
    throw new Error('Modo de autenticación inválido');
  }

  await put(STORES.SETTINGS, {
    key: KEYS.CONFIG,
    value,
    updatedAt: new Date().toISOString()
  });

  return value;
}

export async function getSyncCursor() {
  const record = await get(STORES.SETTINGS, KEYS.CURSOR);
  const value = Number(record?.value || 0);
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

export async function saveSyncCursor(cursor) {
  const value = Math.max(0, Number(cursor || 0));

  await put(STORES.SETTINGS, {
    key: KEYS.CURSOR,
    value,
    updatedAt: new Date().toISOString()
  });

  return value;
}

export function buildApiUrl(baseUrl, path) {
  const base = String(baseUrl || '').trim().replace(/\/$/, '');
  return base ? `${base}${path}` : path;
}
