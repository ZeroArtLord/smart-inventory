import 'dotenv/config';

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Falta variable de entorno ${name}`);
  return value;
}

export const config = Object.freeze({
  port: Number(process.env.PORT || 5190),
  databaseUrl: requireEnv('DATABASE_URL'),
  nodeEnv: process.env.NODE_ENV || 'development',
  devAllowHeaderAuth: String(process.env.DEV_ALLOW_HEADER_AUTH || 'false') === 'true'
});
