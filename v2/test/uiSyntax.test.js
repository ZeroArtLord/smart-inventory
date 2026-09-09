import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const files = [
  '../src/ui/app.js',
  '../src/ui/countWorkflowUi.js',
  '../src/ui/countReconciliationUi.js',
  '../src/ui/countReconciliationBulkUi.js',
  '../src/ui/liveSupplyUi.js',
  '../src/ui/quickStockCorrectionUi.js',
  '../src/ui/quickStockCorrectionRefreshUi.js',
  '../src/ui/procurementWorkspaceV6Ui.js',
  '../src/ui/procurementWorkspaceV6Render.js',
  '../src/ui/procurementWorkspaceV6Print.js',
  '../src/ui/thermalPrinterSettingsUi.js',
  '../src/ui/thermalDirectPrintUi.js',
  '../src/printing/thermalPrinterClient.js',
  '../src/replenishment/procurementListService.js',
  '../src/ui/saintSupplyReportUi.js',
  '../src/ui/vigiaIntelligenceUi.js',
  '../src/inventory/quickStockCorrectionService.js',
  '../sw.js'
];

for (const relativePath of files) {
  test(`sintaxis válida: ${relativePath}`, () => {
    const filePath = fileURLToPath(
      new URL(relativePath, import.meta.url)
    );

    const result = spawnSync(
      process.execPath,
      ['--check', filePath],
      {
        encoding: 'utf8'
      }
    );

    assert.equal(
      result.status,
      0,
      [
        `node --check falló para ${relativePath}`,
        result.stdout,
        result.stderr
      ].filter(Boolean).join('\n')
    );
  });
}
