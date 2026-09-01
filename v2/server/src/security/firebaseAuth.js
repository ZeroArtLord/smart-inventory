import {
  applicationDefault,
  getApps,
  initializeApp
} from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { config } from '../config.js';

let app = null;

export async function verifyFirebaseIdToken(idToken) {
  if (!idToken) {
    throw new Error('Token Firebase requerido');
  }

  const firebaseApp = getFirebaseApp();
  return getAuth(firebaseApp).verifyIdToken(idToken, true);
}

function getFirebaseApp() {
  if (app) return app;

  const existing = getApps()[0];
  if (existing) {
    app = existing;
    return app;
  }

  const options = {
    credential: applicationDefault()
  };

  if (config.firebaseProjectId) {
    options.projectId = config.firebaseProjectId;
  }

  app = initializeApp(options);
  return app;
}
