# Supply Thermal 80mm Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one-copy 80mm ESC/POS printing for closed SUPPLY documents using the real supplied quantity.

**Architecture:** Reuse the existing thermal printer configuration, TCP/RAW transport, ESC/POS writer, category rendering, wrapping, signature and cut logic. Add a sibling supply job/server route protected by `supply.write`, plus a small client UI module that decorates closed Supply history rows and builds the payload from the closed document, document lines, products and categories.

**Tech Stack:** Node.js ESM, browser IndexedDB, Express, ESC/POS TCP RAW, node:test.

**Spec:** `docs/superpowers/specs/2026-09-11-supply-thermal-80mm.md`

## Global Constraints
- Closed `SUPPLY` only.
- Use `documentLine.quantity` as real supplied quantity.
- One copy and one automatic cut.
- Keep procurement printing behavior unchanged.
- Reuse current RC-8002 calibration/configuration.
- Protect server print endpoint with `supply.write`.
- No migrations, stock mutations, movement mutations, or document mutations.

---

### Task 1: ESC/POS supply job

**Files:**
- Modify: `v2/server/src/printing/thermalEscPos.js`
- Test: `v2/test/thermalEscPos.test.js`

**Interfaces:**
- Produces: `buildSupplyJob(configInput, supplyInput)` returning `{buffer,copies:1,itemCount,documentId,code}`.

- [ ] **Step 1: Write the failing test**
Add a test importing `buildSupplyJob` and assert `LISTA DE SURTIDO`, product/category/quantity text, exactly one cut sequence, and `copies === 1`.
- [ ] **Step 2: Run test to verify it fails**
Run `npm test -- --test-name-pattern="surtido térmico"` from `v2`; expect missing export/failure.
- [ ] **Step 3: Write minimal implementation**
Normalize a supply payload, render one ticket with the shared `beginTicket/header/legend/renderCategory/footer/finishTicket` helpers, and omit procurement copy labels.
- [ ] **Step 4: Run test to verify it passes**
Run the same focused test; expect PASS.
- [ ] **Step 5: Commit**
Commit `test/thermalEscPos.test.js` and `server/src/printing/thermalEscPos.js`.

### Task 2: Server transport, permission and audit

**Files:**
- Modify: `v2/server/src/printing/thermalPrinterService.js`
- Modify: `v2/server/src/routes/thermalPrinter.js`
- Test: `v2/test/thermalPrinterSettings.test.js`

**Interfaces:**
- Produces: `printSupplyReceipt(supply)`.
- Produces HTTP `POST /api/v1/thermal-printer/supply-ticket` requiring `PERMISSIONS.SUPPLY_WRITE`.

- [ ] **Step 1: Write the failing test**
Assert route source contains `/supply-ticket`, `PERMISSIONS.SUPPLY_WRITE`, `printSupplyReceipt`, and audit action `SUPPLY_TICKET_PRINTED`.
- [ ] **Step 2: Run test to verify it fails**
Run focused thermal settings test; expect FAIL.
- [ ] **Step 3: Write minimal implementation**
Wire `buildSupplyJob` through `thermalPrinterService.sendRaw`, return `copies:1`, then add the dedicated route and audit metadata.
- [ ] **Step 4: Run test to verify it passes**
Run focused tests; expect PASS.
- [ ] **Step 5: Commit**
Commit server service/route/test changes.

### Task 3: Browser payload builder and direct print client

**Files:**
- Modify: `v2/src/printing/thermalPrinterClient.js`
- Create: `v2/src/printing/supplyThermalPayload.js`
- Test: `v2/test/supplyThermalPayload.test.js`

**Interfaces:**
- Produces: `buildSupplyThermalPayload({document,lines,products,categories,ownerLabel})`.
- Produces: `printThermalSupplyDocument(supply)` calling `/api/v1/thermal-printer/supply-ticket`.

- [ ] **Step 1: Write the failing test**
Assert the builder rejects non-closed/non-SUPPLY documents, uses each line's `quantity`, resolves product category names, preserves notes, and does not inspect lot allocations/movements.
- [ ] **Step 2: Run test to verify it fails**
Run focused test; expect missing module/failure.
- [ ] **Step 3: Write minimal implementation**
Build item records `{name,quantityText,category,note}` from document lines; use product inventory unit metadata only for the unit label and never change the numeric quantity.
- [ ] **Step 4: Run test to verify it passes**
Run focused test; expect PASS.
- [ ] **Step 5: Commit**
Commit client builder/client API/test.

### Task 4: Closed Supply history UI

**Files:**
- Create: `v2/src/ui/supplyThermalPrintUi.js`
- Modify: `v2/index.html`
- Modify: `v2/sw.js`
- Test: `v2/test/supplyThermalPrintUi.test.js`
- Modify: shell-version assertions in existing PWA tests.

**Interfaces:**
- Consumes: `printThermalSupplyDocument` and `buildSupplyThermalPayload`.
- Adds one idempotent `🖨 80mm` button to each visible closed SUPPLY history row.

- [ ] **Step 1: Write the failing test**
Assert module is loaded after operational oversight, decorates `.closed-document-row[data-v82-document-id]` and legacy closed rows using document id, only for Supply view, and calls the payload builder/direct print client.
- [ ] **Step 2: Run test to verify it fails**
Run focused UI/PWA tests; expect FAIL.
- [ ] **Step 3: Write minimal implementation**
Observe `#app`, idempotently add the action button, load document/lines/products/categories from IndexedDB, resolve visible owner label from session/workspace members, disable while printing, call direct print, and toast the result.
- [ ] **Step 4: Run test to verify it passes**
Run focused UI/PWA tests; expect PASS. Bump PWA shell once and precache both new modules.
- [ ] **Step 5: Commit**
Commit UI/index/sw/tests.

### Task 5: Full verification and integration

**Files:** No product code unless verification reveals a defect.

- [ ] **Step 1: Run full client test suite**
Run `npm test` in `v2`; expect all PASS.
- [ ] **Step 2: Run client/server syntax checks**
Use repository CI equivalents; expect PASS.
- [ ] **Step 3: Run server integration workflow**
Expect migrations, sync/stock smoke, restart durability, integrity, preflight and backup/restore PASS.
- [ ] **Step 4: Review diff against spec**
Confirm one copy/one cut, quantity from lines, Supply permission, no procurement behavior change, no migration.
- [ ] **Step 5: Merge only after green CI**
Merge into `feature/vigia-warehouse-ops-v5` and keep rollback branch at pre-V8.4 production SHA.
