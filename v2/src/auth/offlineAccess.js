import {
  STORES,
  get,
  put
} from '../storage/database.js';

export const OFFLINE_ACCESS_MAX_AGE_MS =
  7 * 24 * 60 * 60 * 1000;

const ACCESS_KEY =
  'auth.firebase.offlineAccess.v2';

const LEGACY_ACCESS_KEY =
  'auth.firebase.cachedAccess';

const LOGOUT_LOCK_KEY =
  'auth.firebase.offlineLogoutLock';

export async function saveOfflineAccessSnapshot(
  access,
  {
    now = Date.now()
  } = {}
) {
  const verifiedAt =
    toIso(now);

  const value = {
    version: 2,
    user: access?.user || null,
    workspaces:
      Array.isArray(access?.workspaces)
        ? access.workspaces
        : [],
    verifiedAt,
    expiresAt: toIso(
      asMillis(now) +
      OFFLINE_ACCESS_MAX_AGE_MS
    )
  };

  if (
    !value.user ||
    value.workspaces.length === 0
  ) {
    throw offlineError(
      'OFFLINE_AUTH_CACHE_INVALID',
      'No se puede guardar acceso offline sin usuario y workspace.'
    );
  }

  await put(STORES.SETTINGS, {
    key: ACCESS_KEY,
    value,
    updatedAt: verifiedAt
  });

  return value;
}

export async function readOfflineAccessSnapshot({
  uid = null,
  workspaceId = null,
  now = Date.now()
} = {}) {
  const record =
    await get(
      STORES.SETTINGS,
      ACCESS_KEY
    ) ||
    await get(
      STORES.SETTINGS,
      LEGACY_ACCESS_KEY
    );

  const cached = record?.value || null;

  if (
    !cached?.user ||
    !Array.isArray(cached.workspaces) ||
    cached.workspaces.length === 0
  ) {
    throw offlineError(
      'OFFLINE_AUTH_CACHE_MISSING',
      'No hay una autorización offline guardada para este dispositivo.'
    );
  }

  const cachedUid =
    cached.user.externalAuthId ||
    cached.user.uid ||
    cached.user.id ||
    null;

  if (
    uid &&
    cachedUid &&
    String(uid) !== String(cachedUid)
  ) {
    throw offlineError(
      'OFFLINE_AUTH_USER_MISMATCH',
      'La autorización offline pertenece a otra cuenta.'
    );
  }

  const verifiedAt =
    cached.verifiedAt ||
    cached.cachedAt ||
    record?.updatedAt ||
    null;

  const verifiedMs =
    Date.parse(verifiedAt || '');

  if (
    !Number.isFinite(verifiedMs) ||
    asMillis(now) - verifiedMs >
      OFFLINE_ACCESS_MAX_AGE_MS
  ) {
    throw offlineError(
      'OFFLINE_AUTH_EXPIRED',
      'La autorización offline venció. Conéctate para revalidar tu acceso.'
    );
  }

  const targetWorkspaceId =
    String(workspaceId || '').trim();

  const selectedWorkspace =
    cached.workspaces.find(
      workspace =>
        workspace.id === targetWorkspaceId
    ) ||
    (
      cached.workspaces.length === 1
        ? cached.workspaces[0]
        : null
    );

  if (!selectedWorkspace) {
    throw offlineError(
      'OFFLINE_AUTH_WORKSPACE_REQUIRED',
      'Selecciona este almacén una vez con conexión antes de usarlo offline.'
    );
  }

  return {
    user: cached.user,
    workspaces: cached.workspaces,
    selectedWorkspace,
    offline: true,
    cachedAt: verifiedAt,
    verifiedAt,
    expiresAt:
      cached.expiresAt ||
      toIso(
        verifiedMs +
        OFFLINE_ACCESS_MAX_AGE_MS
      ),
    expired: false
  };
}

export async function clearOfflineAccessSnapshot() {
  await put(STORES.SETTINGS, {
    key: ACCESS_KEY,
    value: null,
    updatedAt: new Date().toISOString()
  });

  await put(STORES.SETTINGS, {
    key: LEGACY_ACCESS_KEY,
    value: null,
    updatedAt: new Date().toISOString()
  });
}

export async function setOfflineLogoutLock({
  uid = null,
  at = new Date().toISOString()
} = {}) {
  const value = {
    uid:
      String(uid || '').trim() ||
      null,
    at
  };

  await put(STORES.SETTINGS, {
    key: LOGOUT_LOCK_KEY,
    value,
    updatedAt: at
  });

  return value;
}

export async function getOfflineLogoutLock() {
  const record = await get(
    STORES.SETTINGS,
    LOGOUT_LOCK_KEY
  );

  return record?.value || null;
}

export async function clearOfflineLogoutLock() {
  await put(STORES.SETTINGS, {
    key: LOGOUT_LOCK_KEY,
    value: null,
    updatedAt: new Date().toISOString()
  });
}

export function offlineError(
  code,
  message
) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function asMillis(value) {
  if (value instanceof Date) {
    return value.getTime();
  }

  const number = Number(value);

  if (Number.isFinite(number)) {
    return number;
  }

  const parsed =
    Date.parse(String(value || ''));

  return Number.isFinite(parsed)
    ? parsed
    : Date.now();
}

function toIso(value) {
  return new Date(
    asMillis(value)
  ).toISOString();
}
