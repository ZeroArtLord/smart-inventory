# Monitor Supplier Orders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Crear proveedores, asignar los pedidos semanales y preparar mensajes por proveedor con validación obligatoria y aprendizaje de pedidos enviados.
**Architecture:** Modelo compartido puro, rutas Monitor protegidas y transacciones PostgreSQL, panel cliente separado con borrador local persistente. Snapshots de pedidos y preferencias independientes de stock.
**Tech Stack:** JavaScript ESM, Express 5, PostgreSQL 18, IndexedDB, HTML/CSS, Playwright.
**Spec:** docs/superpowers/specs/2026-10-26-monitor-suppliers-design.md

## Global Constraints

- Sin API de WhatsApp ni envíos automáticos; Enviado requiere confirmación manual.
- Cantidad positiva, empaque y proveedor válidos obligatorios antes de finalizar.
- Reutilizar allowlist de Monitor, aislar por workspace y ciclo, no alterar stock.
- Conservar historial, unidades textuales y observaciones; no convertir cantidades.

## Review Focus

- Cambios de ciclo o cantidades entre vista y finalización: rechazar versión desactualizada.
- Fallos de red: conservar selección local y bloquear finalización incompleta.
- Doble clic/reintentos: finalización y aprendizaje idempotentes.
- Proveedor inactivo o teléfono inválido: impedir preparación del pedido.
- Editar pedidos enviados: conservar snapshot previo y señalar actualización.

### Task 1: Modelo de proveedores, mensajes y validación
**Files:** v2/src/replenishment/monitorSupplierOrders.js, v2/test/monitorSupplierOrders.test.js.
**Interfaces:** normalizeSupplier(input), buildSupplierOrderGroups({items,suppliers,selections}), supplierOrderFingerprint(groups), buildSupplierMessage(order,{now}), supplierWhatsAppUrl(order,{now}).
- [x] Escribir pruebas que fallen para teléfono venezolano/internacional, campos obligatorios, agrupación exacta, notas, saludo en Caracas, ausencia de conversiones y URL codificada.
- [x] Ejecutar `node --test test/monitorSupplierOrders.test.js`; implementar funciones y repetir hasta verde.

### Task 2: Persistencia y API
**Files:** migration 023_monitor_supplier_orders.sql, routes/monitorSupplierOrders.js, app.js, scripts/monitorSupplierOrdersSmoke.js, CI workflow.
**Interfaces:** GET/PUT /monitor/suppliers; GET /monitor/reviews/:week/supplier-orders; PUT /monitor/reviews/:week/supplier-assignments/:key; POST /monitor/reviews/:week/supplier-orders (round, fingerprint); POST /monitor/supplier-orders/:id/sent.
- [x] Añadir smoke de DB real para CRUD/concurrencia, finalización incompleta, snapshots, reintento, aislamiento workspace/ciclo y aprendizaje idempotente.
- [x] Implementar rutas transaccionales sobre datos canónicos del servidor, comprobar fingerprint del cliente y bloquear ciclo viejo.
- [x] Ejecutar migración y smoke en PostgreSQL aislado; integrar CI y verificar cero movimientos.

### Task 3: Panel Monitor y entrega
**Files:** ui/monitorSupplierOrdersUi.js, replenishment/monitorSupplierClient.js, monitorReviewPilotUi.js, monitor-pilot.css, sw.js, browser smoke and HP rollout docs.
**Interfaces:** createMonitorSupplierPanel({host,getContext,repaint,notify}) with render/load/handleClick/handleChange/handleSubmit/reset, three tabs.
- [x] Prueba de navegador: crear proveedor, buscarlo/asignarlo, recargar conservando selección, bloquear faltantes, finalizar, abrir/copy sin enviar, marcar enviado y sugerir en siguiente ciclo.
- [x] Implementar panel separado y borrador local por workspace/usuario/semana/ciclo; cantidad y empaque editables en Seleccionados.
- [x] Ejecutar npm test y browser smoke; revisar toda la rama; publicar candidato y preparar despliegue HP con respaldo/restore previo a migración 023.
