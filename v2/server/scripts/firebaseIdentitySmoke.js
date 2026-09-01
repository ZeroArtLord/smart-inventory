import 'dotenv/config';
import { pool } from '../src/db.js';
import {
  resolveProvisionedUser
} from '../src/security/firebaseIdentity.js';

const stamp = Date.now().toString(36);
const linkedEmail =
  `firebase-link-${stamp}@example.com`;
const linkedUid =
  `firebase-uid-${stamp}`;

const unverifiedEmail =
  `firebase-unverified-${stamp}@example.com`;

const prelinkedEmail =
  `firebase-prelinked-${stamp}@example.com`;
const prelinkedUid =
  `firebase-prelinked-uid-${stamp}`;

const inactiveEmail =
  `firebase-inactive-${stamp}@example.com`;

const cleanupEmails = [
  linkedEmail,
  unverifiedEmail,
  prelinkedEmail,
  inactiveEmail
];

try {
  await pool.query(
    `INSERT INTO users (
       email,
       display_name,
       active
     )
     VALUES ($1,'Firebase Link Test',true)`,
    [linkedEmail]
  );

  const linked = await resolveProvisionedUser({
    uid: linkedUid,
    email: linkedEmail,
    email_verified: true,
    name: 'Firebase CI User'
  });

  if (linked.external_auth_id !== linkedUid) {
    throw new Error(
      'El primer login no vinculó el UID Firebase.'
    );
  }

  const repeated =
    await resolveProvisionedUser({
      uid: linkedUid,
      email: linkedEmail,
      email_verified: true,
      name: 'Firebase CI User'
    });

  if (repeated.id !== linked.id) {
    throw new Error(
      'El mismo UID Firebase resolvió otro usuario.'
    );
  }

  await pool.query(
    `INSERT INTO users (
       email,
       display_name,
       active
     )
     VALUES ($1,'Unverified Test',true)`,
    [unverifiedEmail]
  );

  await expectAuthFailure(
    () => resolveProvisionedUser({
      uid: `unverified-uid-${stamp}`,
      email: unverifiedEmail,
      email_verified: false,
      name: 'Unverified'
    }),
    'email no verificado'
  );

  const unverifiedState = await pool.query(
    `SELECT external_auth_id
     FROM users
     WHERE lower(email) = lower($1)`,
    [unverifiedEmail]
  );

  if (
    unverifiedState.rows[0]
      ?.external_auth_id !== null
  ) {
    throw new Error(
      'Se vinculó un UID a un email no verificado.'
    );
  }

  await pool.query(
    `INSERT INTO users (
       external_auth_id,
       email,
       display_name,
       active
     )
     VALUES ($1,$2,'Prelinked Test',true)`,
    [
      prelinkedUid,
      prelinkedEmail
    ]
  );

  await expectAuthFailure(
    () => resolveProvisionedUser({
      uid: `other-uid-${stamp}`,
      email: prelinkedEmail,
      email_verified: true,
      name: 'Other Identity'
    }),
    'identidad distinta'
  );

  const prelinkedState = await pool.query(
    `SELECT external_auth_id
     FROM users
     WHERE lower(email) = lower($1)`,
    [prelinkedEmail]
  );

  if (
    prelinkedState.rows[0]
      ?.external_auth_id !== prelinkedUid
  ) {
    throw new Error(
      'La identidad Firebase existente fue reemplazada.'
    );
  }

  await pool.query(
    `INSERT INTO users (
       email,
       display_name,
       active
     )
     VALUES ($1,'Inactive Test',false)`,
    [inactiveEmail]
  );

  await expectAuthFailure(
    () => resolveProvisionedUser({
      uid: `inactive-uid-${stamp}`,
      email: inactiveEmail,
      email_verified: true,
      name: 'Inactive User'
    }),
    'usuario inactivo'
  );

  console.log(
    '✓ firebase identity smoke: email verificado, vínculo UID, repetición, identidad ajena e inactivos correctos'
  );
} finally {
  await pool.query(
    `DELETE FROM users
     WHERE lower(email) = ANY($1::text[])`,
    [
      cleanupEmails.map(
        email => email.toLowerCase()
      )
    ]
  ).catch(() => {});

  await pool.end();
}

async function expectAuthFailure(
  operation,
  label
) {
  try {
    await operation();
  } catch (error) {
    if (
      error?.code ===
      'AUTH_TOKEN_INVALID'
    ) {
      return;
    }

    throw error;
  }

  throw new Error(
    `Se esperaba rechazo de autenticación para ${label}.`
  );
}
