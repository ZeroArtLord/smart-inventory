# Smart Inventory V2 — Autenticación de producción

## Objetivo

Producción usa Firebase Authentication con tokens firmados. Los headers DEV nunca deben habilitarse en producción.

## Variables mínimas del servidor

```env
NODE_ENV=production
AUTH_MODE=firebase
DEV_ALLOW_HEADER_AUTH=false
FIREBASE_PROJECT_ID=smart-inventory-c296b
GOOGLE_APPLICATION_CREDENTIALS=C:\ruta\segura\service-account.json
DATABASE_URL=postgres://...
```

El archivo de service account no pertenece al repositorio.

## Primer administrador

La API de administración exige un administrador ya autenticado. Para evitar un endpoint público de bootstrap, el primer administrador se provisiona desde la consola del servidor:

```powershell
cd v2\server
npm run admin:provision -- --email usuario@dominio.com --workspace-key establo2026 --workspace-name "Almacén principal" --display-name "Administrador"
```

El comando:

1. crea o reutiliza el workspace;
2. crea o reutiliza el usuario por email normalizado;
3. asigna rol `ADMIN` y permisos `["*"]`;
4. deja auditoría `ADMIN_BOOTSTRAP_CLI`;
5. no necesita ni almacena la contraseña de Google;
6. puede ejecutarse nuevamente de forma idempotente.

## Primer login Firebase

Después del provisionamiento:

1. abrir Smart Inventory V2;
2. elegir **Continuar con Google**;
3. iniciar sesión con el mismo email verificado;
4. Firebase entrega un ID Token firmado;
5. el backend verifica el token con Firebase Admin;
6. si el usuario aún no tiene `external_auth_id`, el backend vincula ese UID únicamente al registro pre-provisionado con el mismo email verificado;
7. el backend devuelve solo los workspaces activos donde el usuario tenga membresía.

## Reglas de seguridad

- Producción se niega a iniciar si `AUTH_MODE` no es `firebase`.
- Producción se niega a iniciar sin `FIREBASE_PROJECT_ID`.
- Producción se niega a iniciar con `DEV_ALLOW_HEADER_AUTH=true`.
- El email de usuarios es único sin importar mayúsculas/minúsculas.
- Un UID Firebase no puede vincularse a dos usuarios.
- El usuario debe estar activo.
- La membresía del workspace debe estar activa.
- El backend vuelve a validar permisos en cada request.
- El cliente oculta vistas y acciones sin permiso, pero la seguridad definitiva siempre está en el servidor.

## Cambio de almacén

El cache IndexedDB operativo pertenece a un solo workspace.

Si se cambia de almacén:

- con operaciones locales pendientes/fallidas/en conflicto: se bloquea el cambio;
- sin pendientes: se limpia el cache operacional, se reinicia cursor a cero y se descarga el nuevo workspace;
- unidades y configuración global segura permanecen;
- el marcador de migración V1 está separado por workspace.

## Checklist antes de activar Firebase real

1. Ejecutar todas las migraciones.
2. Ejecutar `npm run preflight:production`.
3. Provisionar al primer administrador.
4. Confirmar dominio/origen autorizado en Firebase Auth.
5. Confirmar credencial de service account fuera del repositorio.
6. Arrancar servidor en modo producción.
7. Probar login con el administrador.
8. Crear un usuario de prueba desde **Usuarios y permisos**.
9. Probar permisos reducidos.
10. Probar logout/login y modo offline después de una sesión válida.

## Diagnóstico real de Firebase Admin

Con las credenciales reales configuradas en el servidor:

```powershell
cd .\v2\server
npm run auth:firebase-check
```

Este comando hace una consulta real a Firebase Authentication usando `applicationDefault()` y confirma que el proyecto y la service account pueden acceder al servicio. No usa ni imprime contraseñas ni tokens de usuarios.

Después de que este comando pase, la prueba final de la ETAPA 17 es iniciar sesión desde el navegador con Google y confirmar que `/api/v1/auth/bootstrap` y `/api/v1/session` reconocen el usuario y sus workspaces usando un ID Token real.

## Prueba E2E con un ID Token Firebase real

Cuando el servidor ya esté arrancado con `AUTH_MODE=firebase`, se puede probar la cadena completa sin usar una cuenta humana:

```powershell
$env:FIREBASE_WEB_API_KEY = "TU_API_KEY_WEB"
$env:AUTH_BASE_URL = "http://127.0.0.1:5190"
npm run auth:firebase-e2e
```

El script crea un usuario Firebase temporal y un usuario local temporal, genera un custom token con Firebase Admin, lo intercambia mediante Identity Toolkit por un **ID Token real emitido por Firebase**, y usa ese token contra Smart Inventory.

Comprueba automáticamente:

- verificación criptográfica del ID Token por Firebase Admin;
- vínculo del UID Firebase con el usuario pre-provisionado por email verificado;
- `/api/v1/auth/bootstrap`;
- `/api/v1/session`;
- bloqueo inmediato al desactivar la membresía del workspace;
- rechazo del token cuando el usuario Firebase se deshabilita;
- limpieza del usuario temporal en Firebase y PostgreSQL.

Esta es la prueba automática más cercana a producción. Después solo queda validar en navegador el flujo humano **Continuar con Google** y el dominio/origen HTTPS autorizado.
