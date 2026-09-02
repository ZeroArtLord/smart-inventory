import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import {
  cert,
  getApps,
  initializeApp
} from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { pool } from '../src/db.js';
import {
  permissionsForRole
} from '../src/security/roles.js';

const projectId = requiredEnv(
  'FIREBASE_PROJECT_ID'
);

const webApiKey = requiredEnv(
  'FIREBASE_WEB_API_KEY'
);

const credentialPath = requiredEnv(
  'GOOGLE_APPLICATION_CREDENTIALS'
);

const serviceAccount = JSON.parse(
  await readFile(credentialPath, 'utf8')
);

if (serviceAccount.project_id !== projectId) {
  throw new Error(
    `Service account Firebase pertenece a ${serviceAccount.project_id || 'proyecto desconocido'}, no a ${projectId}`
  );
}

const baseUrl = String(
  process.env.AUTH_BASE_URL ||
  'http://127.0.0.1:5190'
).replace(/\/$/, '');

const workspaceKey = String(
  process.env.WORKSPACE_KEY ||
  'establo2026'
).trim();

const stamp = Date.now()
  .toString(36);

const uid =
  `si-auth-smoke-${stamp}`;
const email =
  `${uid}@example.invalid`;

const firebaseApp = getApps()[0] ||
  initializeApp({
    credential: cert(serviceAccount),
    projectId
  });

const firebaseAuth =
  getAuth(firebaseApp);

let firebaseUserCreated = false;
let localUserId = null;
let workspaceId = null;

try {
  const workspaceResult =
    await pool.query(
      `SELECT id, name
       FROM workspaces
       WHERE workspace_key = $1
         AND active = true
       LIMIT 1`,
      [workspaceKey]
    );

  if (workspaceResult.rowCount === 0) {
    throw new Error(
      `Workspace activo no encontrado: ${workspaceKey}`
    );
  }

  workspaceId =
    workspaceResult.rows[0].id;

  const userResult = await pool.query(
    `INSERT INTO users (
       email,
       display_name,
       active
     )
     VALUES (
       $1,
       'Firebase E2E Smoke',
       true
     )
     RETURNING id`,
    [email]
  );

  localUserId =
    userResult.rows[0].id;

  await pool.query(
    `INSERT INTO workspace_members (
       workspace_id,
       user_id,
       role_code,
       permissions,
       active
     )
     VALUES (
       $1,
       $2,
       'VIEWER',
       $3::jsonb,
       true
     )`,
    [
      workspaceId,
      localUserId,
      JSON.stringify(
        permissionsForRole('VIEWER')
      )
    ]
  );

  await firebaseAuth.createUser({
    uid,
    email,
    emailVerified: true,
    displayName:
      'Smart Inventory Auth Smoke',
    disabled: false
  });

  firebaseUserCreated = true;

  const customToken =
    await firebaseAuth.createCustomToken(
      uid
    );

  const tokenResponse = await fetch(
    [
      'https://identitytoolkit.googleapis.com',
      '/v1/accounts:signInWithCustomToken',
      `?key=${encodeURIComponent(webApiKey)}`
    ].join(''),
    {
      method: 'POST',
      headers: {
        'content-type':
          'application/json'
      },
      body: JSON.stringify({
        token: customToken,
        returnSecureToken: true
      })
    }
  );

  const tokenBody =
    await readJson(tokenResponse);

  if (
    !tokenResponse.ok ||
    !tokenBody?.idToken
  ) {
    throw new Error(
      `Firebase no intercambió el custom token: ${JSON.stringify(tokenBody)}`
    );
  }

  const idToken = tokenBody.idToken;

  const bootstrap = await apiFetch(
    '/api/v1/auth/bootstrap',
    {
      method: 'POST',
      headers: {
        authorization:
          `Bearer ${idToken}`,
        'content-type':
          'application/json'
      },
      body: '{}'
    }
  );

  if (
    bootstrap.user?.externalAuthId !==
      uid
  ) {
    throw new Error(
      'El backend no vinculó el UID Firebase real al usuario provisionado.'
    );
  }

  const allowedWorkspace =
    bootstrap.workspaces?.find(
      workspace =>
        workspace.id === workspaceId
    );

  if (!allowedWorkspace) {
    throw new Error(
      'El bootstrap Firebase real no devolvió el workspace provisionado.'
    );
  }

  const linkedState =
    await pool.query(
      `SELECT external_auth_id
       FROM users
       WHERE id = $1`,
      [localUserId]
    );

  if (
    linkedState.rows[0]
      ?.external_auth_id !== uid
  ) {
    throw new Error(
      'PostgreSQL no conservó el vínculo Firebase UID.'
    );
  }

  const session = await apiFetch(
    '/api/v1/session',
    {
      headers: {
        authorization:
          `Bearer ${idToken}`,
        'x-workspace-id':
          workspaceId
      }
    }
  );

  if (
    session.session?.userId !==
      localUserId ||
    session.session?.authMode !==
      'firebase'
  ) {
    throw new Error(
      'La sesión autenticada real no coincide con el usuario esperado.'
    );
  }

  await pool.query(
    `UPDATE workspace_members
     SET active = false
     WHERE workspace_id = $1
       AND user_id = $2`,
    [
      workspaceId,
      localUserId
    ]
  );

  const membershipDenied =
    await rawApiFetch(
      '/api/v1/session',
      {
        headers: {
          authorization:
            `Bearer ${idToken}`,
          'x-workspace-id':
            workspaceId
        }
      }
    );

  if (
    membershipDenied.response.status !==
      403 ||
    membershipDenied.body?.code !==
      'WORKSPACE_ACCESS_DENIED'
  ) {
    throw new Error(
      'La membresía desactivada no fue bloqueada inmediatamente.'
    );
  }

  await pool.query(
    `UPDATE workspace_members
     SET active = true
     WHERE workspace_id = $1
       AND user_id = $2`,
    [
      workspaceId,
      localUserId
    ]
  );

  await firebaseAuth.updateUser(
    uid,
    {
      disabled: true
    }
  );

  const disabledDenied =
    await rawApiFetch(
      '/api/v1/session',
      {
        headers: {
          authorization:
            `Bearer ${idToken}`,
          'x-workspace-id':
            workspaceId
        }
      }
    );

  if (
    disabledDenied.response.status !==
      401 ||
    disabledDenied.body?.code !==
      'AUTH_TOKEN_INVALID'
  ) {
    throw new Error(
      'Firebase user disabled no invalidó inmediatamente la sesión del backend.'
    );
  }

  console.log(
    '✓ Firebase E2E real: custom token → ID token firmado → bootstrap → session → membership revoke → user disable'
  );

  console.log(
    JSON.stringify({
      projectId,
      workspaceId,
      workspaceKey,
      firebaseUidLinked: true,
      signedIdTokenVerified: true,
      membershipRevocationVerified:
        true,
      disabledUserRejected: true
    }, null, 2)
  );
} finally {
  if (firebaseUserCreated) {
    await firebaseAuth.deleteUser(uid)
      .catch(() => {});
  }

  if (localUserId) {
    await pool.query(
      `DELETE FROM workspace_members
       WHERE user_id = $1`,
      [localUserId]
    ).catch(() => {});

    await pool.query(
      `DELETE FROM users
       WHERE id = $1`,
      [localUserId]
    ).catch(() => {});
  }

  await pool.end();
}

async function apiFetch(
  path,
  options = {}
) {
  const {
    response,
    body
  } = await rawApiFetch(
    path,
    options
  );

  if (
    !response.ok ||
    body?.ok === false
  ) {
    throw new Error(
      `${path} falló (${response.status}): ${JSON.stringify(body)}`
    );
  }

  return body;
}

async function rawApiFetch(
  path,
  options = {}
) {
  const response = await fetch(
    `${baseUrl}${path}`,
    options
  );

  const body =
    await readJson(response);

  return {
    response,
    body
  };
}

async function readJson(response) {
  try {
    return await response.json();
  } catch (_) {
    return null;
  }
}

function requiredEnv(name) {
  const value = String(
    process.env[name] || ''
  ).trim();

  if (!value) {
    throw new Error(
      `Falta variable de entorno ${name}`
    );
  }

  return value;
}
