import 'dotenv/config';

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Falta variable de entorno ${name}`);
  return value;
}

const nodeEnv = process.env.NODE_ENV || 'development';
const authMode = process.env.AUTH_MODE || 'dev';
const host =
  String(process.env.HOST || '127.0.0.1').trim() || '127.0.0.1';
const devAllowHeaderAuth =
  String(process.env.DEV_ALLOW_HEADER_AUTH || 'false') === 'true';
const firebaseProjectId =
  String(process.env.FIREBASE_PROJECT_ID || '').trim() || null;
const monitorPilotEnabled =
  String(process.env.MONITOR_PILOT_ENABLED || 'false').toLowerCase() === 'true';
const monitorPilotUserIds = String(process.env.MONITOR_PILOT_USER_IDS || '')
  .split(',').map(x => x.trim()).filter(Boolean);
if (monitorPilotEnabled && nodeEnv === 'production' && monitorPilotUserIds.length === 0) {
  throw new Error('MONITOR_PILOT_USER_IDS es obligatorio al habilitar el piloto en producción');
}

if (!['dev', 'firebase'].includes(authMode)) {
  throw new Error(`AUTH_MODE inválido: ${authMode}`);
}

if (nodeEnv === 'production' && authMode !== 'firebase') {
  throw new Error(
    'Producción requiere AUTH_MODE=firebase; autenticación DEV está bloqueada.'
  );
}

if (nodeEnv === 'production' && !firebaseProjectId) {
  throw new Error(
    'Producción requiere FIREBASE_PROJECT_ID explícito.'
  );
}

if (nodeEnv === 'production' && devAllowHeaderAuth) {
  throw new Error(
    'DEV_ALLOW_HEADER_AUTH debe estar desactivado en producción.'
  );
}

export const config = Object.freeze({
  host,
  port: Number(process.env.PORT || 5190),
  databaseUrl: requireEnv('DATABASE_URL'),
  nodeEnv,
  authMode,
  firebaseProjectId,
  devAllowHeaderAuth,
  monitorPilotEnabled,
  monitorPilotUserIds
});
