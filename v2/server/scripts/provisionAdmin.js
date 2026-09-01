import 'dotenv/config';
import { pool, withTransaction } from '../src/db.js';

const args = parseArgs(process.argv.slice(2));

const email = normalizeEmail(
  args.email || process.env.ADMIN_EMAIL
);
const displayName = normalizeOptional(
  args['display-name'] ||
  process.env.ADMIN_DISPLAY_NAME
);
const workspaceKey = normalizeRequired(
  args['workspace-key'] ||
  process.env.WORKSPACE_KEY ||
  'establo2026',
  'workspace-key'
);
const workspaceName = normalizeRequired(
  args['workspace-name'] ||
  process.env.WORKSPACE_NAME ||
  'Almacén principal',
  'workspace-name'
);

if (!email) {
  throw new Error(
    'Indica --email usuario@dominio.com o ADMIN_EMAIL.'
  );
}

try {
  const result = await withTransaction(
    async client => {
      const workspaceResult =
        await client.query(
          `INSERT INTO workspaces (
             name,
             active,
             workspace_key
           )
           VALUES ($1,true,$2)
           ON CONFLICT (workspace_key)
           DO UPDATE SET
             name = EXCLUDED.name,
             active = true
           RETURNING id, name, workspace_key`,
          [
            workspaceName,
            workspaceKey
          ]
        );

      const workspace =
        workspaceResult.rows[0];

      let userResult = await client.query(
        `SELECT
           id,
           external_auth_id,
           email,
           display_name
         FROM users
         WHERE lower(email) = lower($1)
         ORDER BY created_at ASC
         LIMIT 1
         FOR UPDATE`,
        [email]
      );

      if (userResult.rowCount === 0) {
        userResult = await client.query(
          `INSERT INTO users (
             email,
             display_name,
             active
           )
           VALUES ($1,$2,true)
           RETURNING
             id,
             external_auth_id,
             email,
             display_name`,
          [
            email,
            displayName
          ]
        );
      } else {
        userResult = await client.query(
          `UPDATE users
           SET
             display_name = COALESCE($2, display_name),
             active = true
           WHERE id = $1
           RETURNING
             id,
             external_auth_id,
             email,
             display_name`,
          [
            userResult.rows[0].id,
            displayName
          ]
        );
      }

      const user = userResult.rows[0];

      await client.query(
        `INSERT INTO workspace_members (
           workspace_id,
           user_id,
           role_code,
           permissions,
           active
         )
         VALUES ($1,$2,'ADMIN','["*"]'::jsonb,true)
         ON CONFLICT (workspace_id,user_id)
         DO UPDATE SET
           role_code = 'ADMIN',
           permissions = '["*"]'::jsonb,
           active = true`,
        [
          workspace.id,
          user.id
        ]
      );

      await client.query(
        `INSERT INTO audit_events (
           workspace_id,
           user_id,
           action,
           entity_type,
           entity_id,
           metadata
         )
         VALUES (
           $1,
           $2,
           'ADMIN_BOOTSTRAP_CLI',
           'workspaceMember',
           $2,
           $3::jsonb
         )`,
        [
          workspace.id,
          String(user.id),
          JSON.stringify({
            email,
            workspaceKey,
            source: 'server-cli'
          })
        ]
      );

      return {
        workspace,
        user
      };
    }
  );

  console.log(
    '✓ Administrador provisionado para Firebase'
  );
  console.log(
    JSON.stringify({
      workspaceId: result.workspace.id,
      workspaceKey:
        result.workspace.workspace_key,
      workspaceName:
        result.workspace.name,
      userId: result.user.id,
      email: result.user.email,
      firebaseLinked:
        Boolean(result.user.external_auth_id)
    }, null, 2)
  );

  if (!result.user.external_auth_id) {
    console.log(
      'Siguiente paso: iniciar sesión con Google usando este email verificado. El primer login vinculará el UID Firebase.'
    );
  }
} finally {
  await pool.end();
}

function parseArgs(values) {
  const result = {};

  for (let index = 0; index < values.length; index += 1) {
    const raw = values[index];

    if (!raw.startsWith('--')) continue;

    const key = raw.slice(2);
    const next = values[index + 1];

    if (
      next !== undefined &&
      !next.startsWith('--')
    ) {
      result[key] = next;
      index += 1;
    } else {
      result[key] = true;
    }
  }

  return result;
}

function normalizeEmail(value) {
  const email = String(value || '')
    .trim()
    .toLowerCase();

  if (!email) return null;

  if (
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  ) {
    throw new Error('Email inválido');
  }

  return email;
}

function normalizeRequired(value, label) {
  const text = String(value || '').trim();

  if (!text) {
    throw new Error(`${label} requerido`);
  }

  return text;
}

function normalizeOptional(value) {
  const text = String(value || '').trim();
  return text || null;
}
