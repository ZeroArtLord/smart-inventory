import 'dotenv/config';

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Falta variable de entorno ${name}`);
  return value;
}

const nodeEnv = process.env.NODE_ENV || 'development';
const authMode = process.env.AUTH_MODE || 'dev';
const devAllowHeaderAuth =
  String(process.env.DEV_ALLOW_HEADER_AUTH || 'false') === 'true';

if (!['dev', 'firebase'].includes(authMode)) {
  throw new Error(`AUTH_MODE inválido: ${authMode}`);
}

if (nodeEnv === 'production' && authMode !== 'firebase') {
  throw new Error(
    'Producción requiere AUTH_MODE=firebase; autenticación DEV está bloqueada.'
  );
}

export const config = Object.freeze({
  port: Number(process.env.PORT || 5190),
  databaseUrl: requireEnv('DATABASE_URL'),
  nodeEnv,
  authMode,
  firebaseProjectId: process.env.FIREBASE_PROJECT_ID || null,
  devAllowHeaderAuth
});
