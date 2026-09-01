import { pool, withTransaction } from '../db.js';
import { verifyFirebaseIdToken } from './firebaseAuth.js';

export async function resolveFirebaseIdentity(idToken) {
  if (!idToken) {
    throw authError('Bearer token requerido');
  }

  let decoded;
  try {
    decoded = await verifyFirebaseIdToken(idToken);
  } catch (cause) {
    const error = authError('Token Firebase inválido');
    error.cause = cause;
    throw error;
  }

  const user = await resolveProvisionedUser(decoded);

  return {
    userId: user.id,
    externalAuthId: user.external_auth_id,
    email: user.email || decoded.email || null,
    displayName: user.display_name || decoded.name || null,
    decoded
  };
}

export async function resolveProvisionedUser(decoded) {
  const byUid = await pool.query(
    `SELECT id, external_auth_id, email, display_name
     FROM users
     WHERE external_auth_id = $1
       AND active = true`,
    [decoded.uid]
  );

  if (byUid.rowCount > 0) {
    return byUid.rows[0];
  }

  const normalizedEmail = String(decoded.email || '')
    .trim()
    .toLowerCase();

  if (!normalizedEmail) {
    throw authError('Usuario autenticado no provisionado');
  }

  if (decoded.email_verified !== true) {
    throw authError(
      'El email debe estar verificado antes de vincular la cuenta'
    );
  }

  try {
    return await withTransaction(async client => {
      const byEmail = await client.query(
        `SELECT id, external_auth_id, email, display_name
         FROM users
         WHERE lower(email) = lower($1)
           AND active = true
         ORDER BY created_at ASC
         LIMIT 1
         FOR UPDATE`,
        [normalizedEmail]
      );

      if (byEmail.rowCount === 0) {
        throw authError('Usuario autenticado no provisionado');
      }

      const user = byEmail.rows[0];

      if (
        user.external_auth_id &&
        user.external_auth_id !== decoded.uid
      ) {
        throw authError(
          'La cuenta ya está vinculada a otra identidad'
        );
      }

      const linked = await client.query(
        `UPDATE users
         SET external_auth_id = $2,
             email = COALESCE(email, $3),
             display_name = COALESCE(display_name, $4)
         WHERE id = $1
         RETURNING id, external_auth_id, email, display_name`,
        [
          user.id,
          decoded.uid,
          normalizedEmail,
          decoded.name || null
        ]
      );

      return linked.rows[0];
    });
  } catch (error) {
    if (error?.code === '23505') {
      throw authError(
        'La identidad Firebase ya pertenece a otro usuario'
      );
    }
    throw error;
  }
}

function authError(message) {
  const error = new Error(message);
  error.code = 'AUTH_TOKEN_INVALID';
  return error;
}
