BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS uq_users_email_normalized
  ON users (lower(email))
  WHERE email IS NOT NULL;

COMMIT;
