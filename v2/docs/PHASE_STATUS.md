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
- La columna Existencia nunca altera stock directamente en el importador de catálogo; queda reservada a movimientos trazables.
- Modelo de empaques/presentaciones implementado: unidad base + múltiples presentaciones con factor de conversión y compatibilidad con purchaseUnit/purchaseConversion.
- La unidad base puede corregirse mientras el producto no tenga movimientos; después del primer movimiento queda bloqueada tanto en UI como en cliente y servidor para no reinterpretar historia existente.
- Editor visual de producto con unidad base, presentación principal/secundaria y mínimos/máximos expresables en unidad base o empaques.
- El parser de carga SAINT reconoce USAR, presentación principal/secundaria y convierte mínimos/máximos expresados en empaques hacia unidad base.
- El preflight bloquea SKU, códigos de barras, nombres duplicados y cruces ambiguos contra el catálogo existente antes de modificar datos.
- La vista previa muestra altas, actualizaciones y categorías nuevas previstas.
- Ausencia de columna Existencia SAINT y celdas vacías ya no se convierten silenciosamente en cero.
- Smart Inventory puede generar la plantilla Excel de carga inicial SAINT desde la propia interfaz y calcula SHA-256 del archivo fuente para auditoría cuando Web Crypto está disponible.

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
- Flujos Entrada/Surtido cubiertos por pruebas automáticas de cierre, stock e idempotencia.
- Entradas con varios lotes del mismo producto.
- Surtidos consumen lotes por FEFO y actualizan cantidades restantes.

### Fase 5 — Inteligencia V1 (núcleo)
- Consumo basado en surtidos reales.
- Ventanas 7/14/30/60/90 días.
- Días de cobertura.
- Déficit contra mínimo.
- Máximo como límite.
- Mercancía en tránsito contemplada por el motor.
- Nivel de confianza según historial.

### Fase 6 — PWA operativa
- Shell instalable.
- Catálogo manual.
- Conteo número + Enter.
- Teclado matemático auxiliar.
- Entrada tipo carrito.
- Surtido tipo carrito.
- Borradores recuperables.
- Service Worker para shell offline.
- Las rutas /api nunca se cachean.
- Firebase Auth runtime se conserva para arranque offline después de una autenticación previa.
- Autorización Firebase/workspace verificada se cachea por dispositivo para modo offline.
- La UI queda bloqueada si no hay sesión/workspace válido.
- El cache operativo local queda ligado a un único workspace y el cambio de almacén limpia datos locales solo si no existen operaciones pendientes.
- Navegación móvil optimizada para uso con una mano y entradas numéricas grandes.
- Dashboard operativo conectado a datos locales reales: stock con atención, lotes por vencer, movimientos recientes y sugerencias de reposición.
- Rediseño visual 2026 integrado sobre la app real: sidebar desktop, topbar, búsqueda global, shell responsive, drawer móvil y navegación inferior táctil.
- Catálogo con tabla desktop y tarjetas móviles usando stock derivado real.
- Conteo rediseñado para una mano con cantidad protagonista, resumen y últimos contados.
- Entrada/Surtido, Comprar/Pedir, Reportes, Usuarios, Alertas y Configuración adaptados a desktop/tablet/teléfono sin duplicar la lógica operativa.
- Cuenta maestra GOD se representa visualmente como DIOS 👑 sin saltarse invariantes ni auditoría.

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
- Validación de eventos de sincronización en backend antes de persistir.
- El usuario de movimientos lo impone el contexto autenticado del servidor; no se confía en el payload del cliente.
- Modelo de permisos de escritura por catálogo/conteo/entrada/surtido/ajuste.
- Los eventos de sincronización son rechazados si el miembro no tiene el permiso requerido.
- Vistas y acciones locales se ocultan/bloquean según permisos; catálogo puede quedar en modo consulta y la exportación de reportes exige reports.export.
- Cache local aislado por workspace con bloqueo de cambio cuando existen PENDING/FAILED/SYNCING/CONFLICT.

### Fase 9 — Reportes / Dashboard (fundación)
- Motor de reporte de inventario desde movimientos.
- Riesgo de stock y cantidades sugeridas.
- Lotes vencidos/próximos a vencer.
- Resumen de movimientos por periodo y por producto.
- Sin mezclar cantidades de unidades distintas en un total engañoso.

### Fase 10 — Hardening y despliegue seguro
- Rate limiting de APIs sensibles.
- Timeouts de conexión y consultas PostgreSQL.
- Validación relacional de movimientos, documentos, productos, lotes y reversos.
- Protección contra stock negativo en servidor con lock transaccional por producto/ubicación.
- Prueba concurrente automática: dos surtidos simultáneos no pueden sobre-descargar stock.
- Prueba de idempotencia de eventos repetidos.
- Prueba de carga de lote de sincronización.
- Reinicio de API con verificación de persistencia.
- Preflight de producción.
- Backup PostgreSQL custom-format.
- Verificación por pg_restore.
- Restore real automático a una base temporal y comparación de conteos críticos.

### Fase 11 — Baseline productivo
- Smart Inventory V1 queda retirado como fuente de datos porque nunca se utilizó en producción.
- El catálogo inicial vendrá desde SAINT y se depurará antes de activar productos en Smart Inventory.
- Empaques/presentaciones: modelo, persistencia PostgreSQL, importador y editor visual implementados.
- Flujo de existencia inicial SAINT implementado en código como operación única por workspace: exige catálogo sincronizado, almacén sin movimientos previos y permisos catalog.write + adjustment.write.
- La apertura crea un documento ADJUSTMENT cerrado y movimientos trazables SAINT_INITIAL_LOAD; nunca edita stock directamente.
- La UI exige doble confirmación (confirmación visual + texto exacto APLICAR SAINT) y muestra una muestra de existencias antes de ejecutar la apertura.
- El servidor registra la apertura en workspace_initial_loads para impedir una segunda aplicación accidental.
- El evento de apertura se reconstruye en IndexedDB al sincronizar, de modo que PC/teléfono reciben el mismo documento y movimientos.
- Las importaciones posteriores de catálogo no pueden sobrescribir existencia.

## Pendiente inmediato

1. Esperar CI verde del bloque de carga inicial SAINT y revisar cualquier regresión.
2. En una sola ventana de mantenimiento, actualizar el servidor y aplicar migraciones 010_product_presentations.sql + 011_saint_initial_load.sql.
3. Probar primero con un Excel SAINT controlado de pocos productos: catálogo → empaques → apertura única → stock derivado.
4. Validar que una segunda apertura sea rechazada y que una importación posterior de catálogo no cambie stock.
5. Ejecutar la primera prueba real teléfono ↔ servidor ↔ PC y después el piloto con catálogo SAINT depurado.
6. Integración SAINT Enterprise como última etapa.
