import 'dotenv/config';
import {
  applicationDefault,
  getApps,
  initializeApp
} from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

const projectId = String(
  process.env.FIREBASE_PROJECT_ID || ''
).trim();

const credentialPath = String(
  process.env.GOOGLE_APPLICATION_CREDENTIALS || ''
).trim();

if (!projectId) {
  throw new Error(
    'Falta FIREBASE_PROJECT_ID'
  );
}

if (!credentialPath) {
  throw new Error(
    'Falta GOOGLE_APPLICATION_CREDENTIALS'
  );
}

const app = getApps()[0] ||
  initializeApp({
    credential: applicationDefault(),
    projectId
  });

try {
  const auth = getAuth(app);

  const result = await auth.listUsers(1);

  console.log(
    '✓ Firebase Admin respondió correctamente'
  );

  console.log(
    JSON.stringify({
      projectId,
      credentialSource:
        'GOOGLE_APPLICATION_CREDENTIALS',
      authApiReachable: true,
      sampleUserCount:
        Array.isArray(result.users)
          ? result.users.length
          : 0
    }, null, 2)
  );
} catch (error) {
  const wrapped = new Error(
    [
      'Firebase Admin no pudo consultar Authentication.',
      `projectId=${projectId}`,
      `detalle=${error?.message || error}`
    ].join(' ')
  );

  wrapped.code =
    'FIREBASE_ADMIN_CHECK_FAILED';
  throw wrapped;
}
