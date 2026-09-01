import express from 'express';
import helmet from 'helmet';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { pool } from './db.js';
import { getReadiness } from './readiness.js';
import { authContext } from './middleware/authContext.js';
import { syncRouter } from './routes/sync.js';
import { devRouter } from './routes/dev.js';
import { adminRouter } from './routes/admin.js';
import { auditRouter } from './routes/audit.js';
import { sessionRouter } from './routes/session.js';

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicRoot = path.resolve(__dirname, '../..');
const xlsxBrowserBundle = path.resolve(
  __dirname,
  '../node_modules/xlsx/dist/xlsx.full.min.js'
);

app.use(helmet({
  crossOriginResourcePolicy: { policy: 'same-origin' },
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: [
        "'self'",
        'https://www.gstatic.com',
        'https://apis.google.com'
      ],
      connectSrc: [
        "'self'",
        'https://*.googleapis.com',
        'https://*.firebaseapp.com'
      ],
      frameSrc: [
        "'self'",
        'https://accounts.google.com',
        'https://*.firebaseapp.com'
      ],
      imgSrc: ["'self'", 'data:', 'https:'],
      styleSrc: ["'self'", "'unsafe-inline'"],
      fontSrc: ["'self'", 'data:'],
      workerSrc: ["'self'", 'blob:']
    }
  }
}));
app.use(express.json({ limit: '2mb' }));

app.get('/health', async (_req, res, next) => {
  try {
    const result = await pool.query('SELECT now() AS now');
    res.json({
      ok: true,
      service: 'smart-inventory-v2',
      database: 'ok',
      now: result.rows[0].now
    });
  } catch (error) {
    next(error);
  }
});

app.get('/ready', async (_req, res, next) => {
  try {
    const readiness = await getReadiness();
    res.status(readiness.ok ? 200 : 503).json({
      service: 'smart-inventory-v2',
      ...readiness
    });
  } catch (error) {
    next(error);
  }
});

app.use('/api/v1/dev', devRouter);
app.use('/api/v1/sync', authContext, syncRouter);
app.use('/api/v1/admin', authContext, adminRouter);
app.use('/api/v1/audit', authContext, auditRouter);
app.use('/api/v1/session', authContext, sessionRouter);

app.get('/vendor/xlsx.full.min.js', (_req, res) => {
  res.sendFile(xlsxBrowserBundle);
});

app.use((req, res, next) => {
  const blockedPrefixes = ['/server', '/test', '/docs'];
  const blockedFiles = ['/package.json', '/.gitignore'];

  if (
    blockedFiles.includes(req.path) ||
    blockedPrefixes.some(prefix =>
      req.path === prefix || req.path.startsWith(prefix + '/')
    )
  ) {
    res.status(404).end();
    return;
  }

  next();
});

app.use(express.static(publicRoot, {
  index: 'index.html',
  etag: true,
  maxAge: config.nodeEnv === 'production' ? '5m' : 0
}));

app.use((error, _req, res, _next) => {
  console.error(error);

  const status = Number(error?.statusCode || 500);
  const safeStatus = status >= 400 && status < 600
    ? status
    : 500;

  res.status(safeStatus).json({
    ok: false,
    code: error?.code || 'INTERNAL_ERROR',
    message:
      safeStatus >= 500 && config.nodeEnv === 'production'
        ? 'Error interno'
        : error?.message || 'Error interno',
    ...(error?.details ? { details: error.details } : {})
  });
});

const server = app.listen(config.port, () => {
  console.log(`Smart Inventory V2 disponible en http://localhost:${config.port}`);
});

async function shutdown(signal) {
  console.log(`${signal}: cerrando servidor...`);
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
