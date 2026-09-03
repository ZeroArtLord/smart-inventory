# Smart Inventory V2 — Roadmap operativo 26 etapas

Este documento traduce el Plan Maestro a 26 checkpoints ejecutables. Cada etapa se marca como LISTO, EN CURSO o PENDIENTE.

1. **Protección de V1 y rama V2** — LISTO
2. **Fundación del repositorio y CI** — LISTO
3. **Backend Node + PostgreSQL + health/migraciones** — LISTO
4. **IndexedDB V2 + outbox/idempotencia/local-first** — LISTO
5. **Catálogo maestro + importador Excel/CSV** — LISTO
6. **Motor matemático seguro en campos numéricos** — LISTO
7. **Conteos físicos + cierre + ajustes** — LISTO
8. **Libro de movimientos inmutable + stock derivado** — LISTO
9. **Entradas + costos/lotes/vencimiento** — LISTO
10. **Surtidos + validación de stock + cierre** — LISTO
11. **Lotes + FEFO + ubicación de lotes** — LISTO
12. **Compras/pedidos + mercancía en tránsito** — LISTO
13. **Inteligencia V1–V3: min/max, consumo, cobertura + tránsito** — LISTO
14. **Inteligencia avanzada: tendencia, rotación y recomendación futura** — LISTO
15. **Dashboard + motor de reportes operativos** — LISTO
16. **Usuarios, roles y permisos granulares** — LISTO
17. **Autenticación real por token firmado** — LISTO (Firebase Admin real, E2E con ID Token firmado, login humano Google y cuenta provisionada vinculada)
18. **Conflictos/versionado multi-dispositivo** — LISTO
19. **Prueba real PC ↔ servidor ↔ teléfono** — PENDIENTE
20. **PWA móvil final + UX una mano/offline** — LISTO (shell visual desktop/tablet/móvil, drawer, bottom-nav, conteo táctil, catálogo móvil y módulos responsive)
21. **Código de barras: cámara + lector USB/Bluetooth** — LISTO
22. **PDF/Excel/CSV + impresión de documentos/reportes** — LISTO
23. **Auditoría, reapertura autorizada y compensaciones** — LISTO
24. **Hardening: seguridad, caída, concurrencia, carga y backups** — LISTO
25. **Carga inicial desde SAINT + piloto + despliegue/producción** — EN CURSO
26. **SAINT Enterprise Bridge** — PENDIENTE

## Regla de comunicación

En cada actualización del proyecto indicar el checkpoint con formato:

**ETAPA X/26 — LISTO / EN CURSO / PENDIENTE**

Cuando una etapa se complete, actualizar este archivo.

## Decisión de baseline productivo

- Smart Inventory V1 queda retirado como fuente de migración: nunca entró en uso productivo y no se importará información desde V1.
- El arranque productivo será desde base operativa cero, usando el catálogo/exportación de SAINT como fuente inicial controlada.
- La existencia inicial de SAINT se aplicará únicamente mediante un proceso explícito y trazable de carga inicial; importaciones posteriores de catálogo no podrán sobrescribir stock.
- El bloque de catálogo enriquecido + empaques + plantilla SAINT + apertura única ya está implementado en la rama V2 y cubierto por CI; falta desplegar las migraciones 010/011 en el servidor real y ejecutar el piloto con datos controlados.
