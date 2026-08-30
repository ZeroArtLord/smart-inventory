# Smart Inventory V2

Nueva generación de Smart Inventory enfocada en operación de almacén, trazabilidad, trabajo móvil y sincronización local-first.

## Principios

1. El stock es resultado de movimientos, no un número editable libremente.
2. Ninguna operación crítica se pierde aunque se cierre el navegador o falle Internet.
3. Cada acción importante queda auditada.
4. Los permisos limitan lectura y escritura por rol.
5. La inteligencia recomienda; el usuario decide.
6. SAINT Enterprise será una integración final y siempre generará documentos revisables/en espera.

## Estructura inicial

- `src/core`: lógica de dominio reutilizable.
- `src/storage`: persistencia local IndexedDB.
- `src/sync`: cola y estado de sincronización.
- `docs`: arquitectura y decisiones técnicas.

La aplicación V1 permanece intacta fuera de esta carpeta durante la migración.
