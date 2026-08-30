# Estado de implementación V2

## Completado / base funcional

### Fase 0 — Protección
- Rama `feature/smart-inventory-v2`.
- V1 permanece intacta.

### Fase 1 — Fundaciones
- IDs locales resistentes a trabajo offline.
- Motor matemático seguro.
- IndexedDB versionada.
- Cola durable de sincronización.
- Transacciones que abortan ante errores asíncronos.

### Fase 2 — Catálogo
- Productos.
- Categorías.
- Unidades.
- Proveedores.
- Ubicaciones.
- Búsqueda por nombre, alias, SKU y código de barras.
- Cambios de catálogo guardados localmente y encolados para sincronización.

### Fase 3 — Inventario transaccional
- ENTRY.
- SUPPLY.
- ADJUSTMENT.
- REVERSAL.
- Stock calculado desde movimientos.
- Stock por ubicación.
- Reversos trazables.
- effectiveAt separado de createdAt.

### Fase 4 — Documentos operativos (núcleo)
- Conteo en borrador.
- Entrada en borrador.
- Surtido en borrador.
- Guardado de líneas individual.
- Reanudación de borradores.
- Cierre atómico.
- Conteo genera ajustes.
- Entrada genera movimientos y lotes opcionales.
- Surtido genera descargos internos y valida existencia.

### Fase 5 — Inteligencia V1 (núcleo)
- Consumo basado en surtidos reales.
- Ventanas 7/14/30/60/90 días.
- Días de cobertura.
- Déficit contra mínimo.
- Máximo como límite.
- Mercancía en tránsito contemplada por el motor.
- Nivel de confianza según historial.

## Pendiente inmediato

1. UI PWA V2.
2. Flujo móvil número + Enter.
3. Importador Excel V2.
4. Backend Node.js + PostgreSQL.
5. Sincronizador cliente-servidor.
6. Autenticación, roles y permisos.
7. Gestión real de pedidos/en tránsito.
8. FEFO y consumo de lotes.
9. Reportes.
10. Cámara/códigos de barra.
11. Pruebas offline multi-dispositivo.
12. Migrador V1 → V2.
13. Integración SAINT como fase final.
