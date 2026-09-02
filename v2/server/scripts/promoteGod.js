import 'dotenv/config';
import { pool, withTransaction } from '../src/db.js';

const args = parseArgs(process.argv.slice(2));
const email = normalizeEmail(
  args.email || process.env.GOD_EMAIL
);
const workspaceKey = normalizeRequired(
  args['workspace-key'] ||
  process.env.WORKSPACE_KEY ||
  'establo2026',
  'workspace-key'
);

if (!email) {
  throw new Error(
    'Indica --email usuario@dominio.com o GOD_EMAIL.'
  );
}

try {
  const result = await withTransaction(
    async client => {
      const workspaceResult = await client.query(
        `SELECT id, name, workspace_key
         FROM workspaces
         WHERE workspace_key = $1
           AND active = true
         LIMIT 1
         FOR UPDATE`,
        [workspaceKey]
      );

      if (workspaceResult.rowCount === 0) {
        throw new Error(
          `Workspace activo no encontrado: ${workspaceKey}`
        );
      }

      const workspace = workspaceResult.rows[0];

      const userResult = await client.query(
        `SELECT id, email, display_name, external_auth_id
         FROM users
         WHERE lower(email) = lower($1)
           AND active = true
         ORDER BY created_at ASC
         LIMIT 1
         FOR UPDATE`,
        [email]
      );

      if (userResult.rowCount === 0) {
        throw new Error(
          'Usuario activo no encontrado; provisiona e inicia sesión primero.'
        );
      }

      const user = userResult.rows[0];

      const membershipResult = await client.query(
        `UPDATE workspace_members
         SET role_code = 'GOD',
             permissions = '["*"]'::jsonb,
             active = true
         WHERE workspace_id = $1
           AND user_id = $2
         RETURNING role_code, permissions, active`,
        [workspace.id, user.id]
      );

      if (membershipResult.rowCount === 0) {
        throw new Error(
          'El usuario no pertenece al workspace indicado.'
        );
      }

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
           'GOD_PROMOTED_CLI',
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
        user,
        membership: membershipResult.rows[0]
      };
    }
  );

  console.log('✓ Rol DIOS activado');
  console.log(
    JSON.stringify({
      workspaceKey: result.workspace.workspace_key,
      workspaceName: result.workspace.name,
      email: result.user.email,
      roleCode: result.membership.role_code,
      permissions: result.membership.permissions,
      active: result.membership.active,
      firebaseLinked: Boolean(
        result.user.external_auth_id
      )
    }, null, 2)
  );
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
