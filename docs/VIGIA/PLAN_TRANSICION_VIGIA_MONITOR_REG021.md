# VIGÍA → VIGÍA Monitor · Plan de transición seguro (REG-021)

**Fecha:** 2026-10-11  
**Clave permanente:** VIGIA-FARO-1011  
**Estado:** PROPUESTA TÉCNICA. No ejecutada ni autorizada para producción.

## Decisión recomendada

**NO detener ni eliminar el VIGÍA vigente en esta fase.** Desarrollar VIGÍA Monitor en una rama separada; probar en un entorno distinto; reemplazar gradualmente la interfaz/servicio tras respaldos, validación de datos y autorización puntual del responsable. No mantener dos sistemas de stock paralelos.

## Estado actual conocido (no verificación directa del HP hoy)

- Servidor HP con Windows Server, servicio Windows \`SmartInventoryV2\`.
- Carpeta operativa \`C:\SmartInventory\App\v2\server\`, API escuchando en \`127.0.0.1:5190\` detrás del acceso interno HTTPS/PWA.
- Último despliegue operativo confirmado históricamente: \`9b66e80...\`; commits posteriores y hotfixes no se consideran automáticamente desplegados.
- Al menos 103 conflictos offline reportados en teléfono, resolución completa **no confirmada**.
- Usuario quiere conservar un monitor de surtidos, compras/pedidos y reportes, no controlar existencias por duplicado.

## Fase A: desarrollo fuera de producción (actual)

- Branch de desarrollo \`feature/vigia-monitor-review-v1\`, PR #23 borrador; aislado del servicio productivo.
- Nuevos módulos se guardan y prueban en GitHub CI; no cambiar configuración del servidor de negocio.
- Proteger módulos de historial/auditoría/usuarios, productos y datos anteriores; no modificar ni vaciar IndexedDB ni colas offline.

## Fase B: entorno piloto independiente

- Crear un ambiente de prueba con **base de datos separada**, datos ficticios o copia de respaldo desidentificada, credenciales propias y puerto/URL diferentes. Ejemplo conceptual: servidor de laboratorio \`127.0.0.1:5290\`, **solo si está libre** (NO reservado ni configurado actualmente).
- Un segundo servicio de piloto solo si se valida recursos/aislamiento; nunca apuntar ambos sistemas a una misma base productiva con escritura indiscriminada.
- Repetir casos reales con PC y teléfono: 100% productos por categorías, pendientes, Compra/Pedir con cantidad nula, extras, tickets, reportes y surtidos informativos sin control de stock.
- Simular apagones/red intermitente/dispositivos concurrentes; verificar idempotencia, trazabilidad y recuperación.

## Fase C: controles previos al reemplazo

- Inventariar versión real en HP, módulos activos y estado exacto del esquema SQL.
- Resolver o exportar **íntegramente** los conflictos/offline pendientes; no descartarlos ni limpiar cachés.
- Crear backup consistente PostgreSQL y archivos del servidor; verificar backup y restauración real en base temporal.
- Asegurar acceso a claves/credenciales administradas de forma segura, sin copiarlas al repositorio.
- Validar integridad, compatibilidad de tablas antiguas, reportes históricos y exportaciones.
- Evaluar requerimientos del POS/SAINT existentes y preservar vínculos solo lectura hasta integrar API autorizada.
- Checkpoint de aprobación del usuario sobre interfaz, datos, funcionalidad, impresión y fecha de ventana de cambio.

## Fase D: cambio controlado (solo con aprobación adicional)

- Anunciar ventana de mantenimiento. Evitar escrituras de usuarios en la versión antigua durante el cambio.
- Tomar respaldo final; verificar y registrar SHA/versión y estado del servidor.
- Publicar nueva versión en ruta versionada (no sobreescribir destructivamente la carpeta anterior), aplicar migraciones aditivas validadas y ejecutar smoke tests.
- Cambiar la entrada de los usuarios a la versión nueva **una sola vez**; preservar URL amigable si se valida.
- Comprobar login, catálogo, carrito surtidos sin restricción de stock, recorrido semanal por categorías, pendientes, extras, reportes e impresión, además de sincronización PC↔teléfono.
- Monitorizar errores, latencia, datos pendientes y aceptación operativa. Declarar producción confirmada solo con evidencia.

## Fase E: retorno seguro si falla

- Detener nuevas escrituras antes de regresar a la versión anterior; copiar/respaldar los eventos generados por la nueva para no perderlos.
- Restaurar enlace de acceso/servicio anterior bajo control; **no revertir la base a un backup antiguo sin reconciliar datos escritos después**.
- Probar acceso, registros anteriores e integridad. Investigar causas y retomar el piloto.
- Mantener código y archivo de respaldo de la versión anterior para restauración rápida. Solo archivar características antiguas tras seguimiento y aprobación, nunca borrar por intuición.

## Reglas que no se negocian

1. No apagar el servicio real ahora.
2. No eliminar tablas/catálogos/historial/movimientos antiguos.
3. No limpiar la app del teléfono ni IndexedDB para resolver conflictos.
4. No conectar un piloto de escritura a la base productiva.
5. No declarar un módulo terminado por pasar CI si falta integración real de UI, impresión, offline o sincronización.
6. No fusionar PR #23 ni desplegar una migración desde GitHub sin la autorización de puesta en producción.

## Pendientes para aprobar despliegue

- Implementación y pruebas integradas de interfaz nueva, datos compartidos online/offline, impresión y Surtidos Monitor.
- Revisión de Reportes con historia anterior y datos nuevos.
- Prueba de aceptación del usuario en PC y teléfono, incluyendo corrección del diseño móvil.
- Validación final de respaldos, conflictos 103 y plan rollback en el servidor HP.
