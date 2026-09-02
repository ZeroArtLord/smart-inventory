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

### Fase 11 — Migración V1
- Lectura de localStorage V1.
- Fallback seguro a IndexedDB V1.
- Snapshot portable JSON.
- Preview con errores/advertencias.
- Detección de productos duplicados por nombre normalizado.
- Archivo legado preservado.
- Stock V1 convertido en ADJUSTMENT trazable.
- IDs deterministas de movimientos de migración.
- Estado y archivo de migración aislados por workspace.
- Bloqueo de segunda migración accidental.

## Pendiente inmediato

1. Validar visualmente en el servidor el nuevo shell desktop y la vista móvil responsive.
2. Completar IIS + HTTPS + hostname estable para acceso LAN seguro.
3. Ejecutar la primera prueba real teléfono ↔ servidor ↔ PC.
4. Ejecutar el piloto de migración V1 con una copia real.
5. Integración SAINT Enterprise como última etapa.
