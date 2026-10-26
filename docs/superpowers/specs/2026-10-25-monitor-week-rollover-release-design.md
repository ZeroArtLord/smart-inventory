# Monitor: revisión anterior y entrega al HP

## Intención

Permitir cerrar la revisión completa de la semana 2026-10-19 aun después del cambio al lunes 2026-10-26, y preparar la actualización del PR #25 para el HP sin perder listas ni colas.

## Diseño

- Monitor mostrará una selección explícita de la semana actual y las ocho anteriores. Cambiar de semana cargará el ciclo activo de esa semana y sus datos propios; no borrará IndexedDB ni enviará decisiones de una semana a otra. La selección por defecto continúa siendo la semana actual.
- La revisión cerrada solo se archiva mediante confirmación del servidor; Preguntar y Pendiente bloquean el cierre. El historial sigue disponible por semana.
- La actualización en el HP se ancla a un SHA y exige prechequeo, Git limpio, respaldos nuevos de código y PostgreSQL, copia restaurada de prueba, cola de Monitor sincronizada, parada de SmartInventoryV2, migración 022, arranque y verificación. PostgreSQL y otros servicios permanecen activos. Ante fallo, se restaura solo código y se deja la migración aditiva; nunca se restaura automáticamente la base productiva.
- No se toca stock, movimientos, .env ni listas V2 tradicionales. Solo la cuenta DIOS mantiene acceso al piloto según la configuración existente.

## Enfoques

- Cerrar antes de medianoche del domingo: no resuelve fallos o retrasos de instalación.
- Fijar la semana 2026-10-19: rompe las semanas posteriores.
- **Elegido:** selector de semanas recientes con claves locales y ciclos del servidor separados. Es el cambio más pequeño que permite recuperar la revisión real sin reescribirla.

## Validación

Prueba de cruce de lunes, aislamiento de claves y cambios pendientes, suite cliente, CI del PR, prechequeo HP solo lectura y verificación posterior en el HP con revisión real y ticket de consulta de una copia.
