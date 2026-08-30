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
- Importador Excel/CSV con detección flexible de columnas.
- Vista previa antes de aplicar.
- Actualización por SKU, código de barras o nombre.
- La columna Existencia nunca altera stock directamente; queda reservada a Conteos/Entradas trazables.

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

### Fase 6 — PWA operativa (primera versión)
- Shell instalable.
- Catálogo manual.
- Conteo número + Enter.
- Teclado matemático auxiliar.
- Entrada tipo carrito.
- Surtido tipo carrito.
- Borradores recuperables.
- Service Worker para shell offline.

### Fase 7 — Backend propio (fundación)
- Node.js API.
- PostgreSQL.
- Separación por workspace.
- Movimientos inmutables en servidor.
- Cola de eventos idempotente.
- Push/pull de sincronización.
- Autenticación de desarrollo aislada y no apta para producción.

### Fase 8 — Sincronización cliente-servidor
- La cola local hace push automático.
- El cliente hace pull incremental por cursor.
- Los cambios remotos se aplican sin volver a encolarse.
- Eventos repetidos son idempotentes.
- Operaciones SYNCING interrumpidas se recuperan.
- Reintento automático cada 15 segundos mientras la app está visible.
- Sincronización al recuperar Internet.
- Sincronización al volver a la app.
- La UI no se refresca automáticamente mientras el usuario está escribiendo.
- Identidad lógica de desarrollo compartida entre dispositivos.
- Membresía de workspace verificada en servidor.

## Pendiente inmediato

1. Probar el importador Excel V2 con archivos reales y validar sincronización masiva.
2. Instalar PostgreSQL y levantar la API en el servidor de pruebas definitivo.
3. Ejecutar la primera prueba real teléfono ↔ servidor ↔ PC.
4. Autenticación real, roles y permisos.
5. Gestión real de pedidos/en tránsito.
6. FEFO y consumo de lotes.
7. Reportes.
8. Cámara/códigos de barra.
9. Pruebas destructivas multi-dispositivo.
10. Migrador V1 → V2.
11. Integración SAINT como fase final.
