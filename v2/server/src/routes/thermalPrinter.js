import { Router } from 'express';
import { pool } from '../db.js';
import { PERMISSIONS } from '../security/permissions.js';
import { requirePermission } from '../middleware/requirePermission.js';
import { writeAuditEvent } from '../audit/auditService.js';
import {
  readThermalPrinterConfig,
  writeThermalPrinterConfig,
  printCalibrationReceipt,
  printProcurementReceipt,
  testPrinterConnection
} from '../printing/thermalPrinterService.js';

export const thermalPrinterRouter = Router();

thermalPrinterRouter.get(
  '/config',
  requirePermission(PERMISSIONS.PURCHASE_WRITE),
  async (_req, res, next) => {
    try {
      const config = await readThermalPrinterConfig();
      res.json({ ok: true, config });
    } catch (error) {
      next(error);
    }
  }
);

thermalPrinterRouter.put('/config', async (req, res, next) => {
  try {
    assertGod(req.auth);
    const config = await writeThermalPrinterConfig(req.body || {});

    await safeAudit(req.auth, {
      action: 'THERMAL_PRINTER_CONFIG_UPDATED',
      entityType: 'thermalPrinter',
      entityId: `${config.host}:${config.port}`,
      metadata: {
        printerName: config.printerName,
        host: config.host,
        port: config.port,
        charsPerLine: config.charsPerLine,
        leftMarginDots: config.leftMarginDots,
        printWidthDots: config.printWidthDots,
        feedLines: config.feedLines,
        cut: config.cut
      }
    });

    res.json({ ok: true, config });
  } catch (error) {
    next(error);
  }
});

thermalPrinterRouter.post('/connection-test', async (req, res, next) => {
  try {
    assertGod(req.auth);
    const result = await testPrinterConnection();
    res.json(result);
  } catch (error) {
    next(error);
  }
});

thermalPrinterRouter.post('/test', async (req, res, next) => {
  try {
    assertGod(req.auth);
    const result = await printCalibrationReceipt();

    await safeAudit(req.auth, {
      action: 'THERMAL_PRINTER_TEST_PRINTED',
      entityType: 'thermalPrinter',
      entityId: `${result.printer.host}:${result.printer.port}`,
      metadata: {
        printerName: result.printer.name,
        bytes: result.bytes,
        copies: result.copies
      }
    });

    res.json(result);
  } catch (error) {
    next(error);
  }
});

thermalPrinterRouter.post(
  '/ticket',
  requirePermission(PERMISSIONS.PURCHASE_WRITE),
  async (req, res, next) => {
    try {
      const result = await printProcurementReceipt(
        req.body?.list || req.body || {}
      );

      await safeAudit(req.auth, {
        action: 'PROCUREMENT_TICKET_PRINTED',
        entityType: 'procurementList',
        entityId: result.listId || null,
        metadata: {
          code: result.code,
          kind: result.kind,
          itemCount: result.itemCount,
          copies: result.copies,
          printerName: result.printer.name,
          printerHost: result.printer.host,
          printerPort: result.printer.port
        }
      });

      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

async function safeAudit(auth, event) {
  try {
    await writeAuditEvent(pool, auth, event);
  } catch (error) {
    console.warn(
      'No se pudo auditar impresión térmica:',
      error?.message || error
    );
  }
}

function assertGod(auth) {
  if (
    String(auth?.roleCode || '')
      .trim()
      .toUpperCase() === 'GOD'
  ) {
    return;
  }

  const error = new Error(
    'Solo el rol DIOS puede configurar o calibrar la comandera'
  );
  error.code = 'GOD_ROLE_REQUIRED';
  error.statusCode = 403;
  throw error;
}
