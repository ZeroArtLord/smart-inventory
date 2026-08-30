import express from 'express';
import helmet from 'helmet';
import { config } from './config.js';
import { pool } from './db.js';
import { authContext } from './middleware/authContext.js';
import { syncRouter } from './routes/sync.js';

const app = express();

app.use(helmet());
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

app.use('/api/v1/sync', authContext, syncRouter);

app.use((error, _req, res, _next) => {
  console.error(error);

  res.status(500).json({
    ok: false,
    code: 'INTERNAL_ERROR',
    message: config.nodeEnv === 'production'
      ? 'Error interno'
      : error.message
  });
});

const server = app.listen(config.port, () => {
  console.log(`Smart Inventory V2 API escuchando en puerto ${config.port}`);
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
