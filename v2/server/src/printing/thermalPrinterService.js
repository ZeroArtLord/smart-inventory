import net from 'node:net';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import {
  DEFAULT_THERMAL_CONFIG,
  normalizeThermalConfig,
  buildCalibrationJob,
  buildProcurementJob,
  buildSupplyJob
} from './thermalEscPos.js';

const DEFAULT_CONFIG_PATH =
  process.platform === 'win32'
    ? 'C:\\SmartInventory\\Config\\thermal-printer.json'
    : path.resolve(
        process.cwd(),
        '.smart-inventory-runtime',
        'thermal-printer.json'
      );

export function thermalPrinterConfigPath() {
  const override = String(
    process.env.THERMAL_PRINTER_CONFIG_FILE || ''
  ).trim();

  return override
    ? path.resolve(override)
    : DEFAULT_CONFIG_PATH;
}

export async function readThermalPrinterConfig() {
  const file = thermalPrinterConfigPath();

  try {
    const raw = await fs.readFile(file, 'utf8');
    return normalizeThermalConfig({
      ...DEFAULT_THERMAL_CONFIG,
      ...JSON.parse(raw)
    });
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    return normalizeThermalConfig(DEFAULT_THERMAL_CONFIG);
  }
}

export async function writeThermalPrinterConfig(input = {}) {
  const current = await readThermalPrinterConfig();
  const next = normalizeThermalConfig({
    ...current,
    ...input
  });
  const file = thermalPrinterConfigPath();
  const directory = path.dirname(file);
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;

  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(
    temp,
    JSON.stringify(next, null, 2) + '\n',
    'utf8'
  );
  await fs.rename(temp, file);
  return next;
}

export async function printCalibrationReceipt() {
  const config = await readThermalPrinterConfig();
  const buffer = buildCalibrationJob(config);
  await sendRaw(config, buffer);

  return {
    ok: true,
    printer: printerSummary(config),
    bytes: buffer.length,
    copies: 1
  };
}

export async function printProcurementReceipt(list) {
  const config = await readThermalPrinterConfig();
  const job = buildProcurementJob(config, list);
  await sendRaw(config, job.buffer);

  return {
    ok: true,
    printer: printerSummary(config),
    bytes: job.buffer.length,
    copies: job.copies,
    itemCount: job.itemCount,
    kind: job.kind,
    listId: job.listId,
    code: job.code
  };
}

export async function printSupplyReceipt(supply) {
  const config = await readThermalPrinterConfig();
  const job = buildSupplyJob(config, supply);
  await sendRaw(config, job.buffer);

  return {
    ok: true,
    printer: printerSummary(config),
    bytes: job.buffer.length,
    copies: job.copies,
    itemCount: job.itemCount,
    documentId: job.documentId,
    code: job.code
  };
}

export async function testPrinterConnection() {
  const config = await readThermalPrinterConfig();
  await connectOnly(config);
  return {
    ok: true,
    printer: printerSummary(config)
  };
}

function printerSummary(config) {
  return {
    name: config.printerName,
    host: config.host,
    port: config.port,
    widthMm: 80,
    charsPerLine: config.charsPerLine,
    cut: config.cut
  };
}

async function sendRaw(config, buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw serviceError(
      'THERMAL_PRINT_EMPTY',
      'No se generó contenido para imprimir',
      400
    );
  }

  await new Promise((resolve, reject) => {
    const socket = net.createConnection({
      host: config.host,
      port: config.port
    });
    let settled = false;

    const finish = error => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.removeAllListeners();
      if (!socket.destroyed) socket.destroy();
      if (error) reject(wrapNetworkError(error, config));
      else resolve();
    };

    const timer = setTimeout(() => {
      finish(new Error('Tiempo de conexión agotado'));
    }, 5000);

    socket.once('error', finish);
    socket.once('connect', () => {
      socket.end(buffer, error => {
        if (error) finish(error);
        else finish();
      });
    });
  });
}

async function connectOnly(config) {
  await new Promise((resolve, reject) => {
    const socket = net.createConnection({
      host: config.host,
      port: config.port
    });
    let settled = false;

    const done = error => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.removeAllListeners();
      if (!socket.destroyed) socket.destroy();
      if (error) reject(wrapNetworkError(error, config));
      else resolve();
    };

    const timer = setTimeout(
      () => done(new Error('Tiempo de conexión agotado')),
      4000
    );

    socket.once('error', done);
    socket.once('connect', () => done());
  });
}

function wrapNetworkError(error, config) {
  return serviceError(
    'THERMAL_PRINTER_UNREACHABLE',
    `No se pudo conectar con la comandera ${config.host}:${config.port}`,
    503,
    {
      cause: error?.code || error?.message || 'NETWORK_ERROR'
    }
  );
}

function serviceError(
  code,
  message,
  statusCode = 500,
  details = null
) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  if (details) error.details = details;
  return error;
}
