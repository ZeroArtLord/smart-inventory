import {
  setAuthTokenProvider,
  clearAuthTokenProvider
} from './authProvider.js';

const FIREBASE_CONFIG = Object.freeze({
  apiKey: 'AIzaSyDSFpufEj4XWz7hoxUmHwxBzSaB7HXDjA4',
  authDomain: 'smart-inventory-c296b.firebaseapp.com',
  projectId: 'smart-inventory-c296b',
  storageBucket: 'smart-inventory-c296b.firebasestorage.app',
  messagingSenderId: '640420819792',
  appId: '1:640420819792:web:560800b3c8f6f38a5bf255'
});

let auth = null;
let currentUser = null;
let unsubscribe = null;

export function isFirebaseBrowserAvailable() {
  return Boolean(globalThis.firebase?.initializeApp && globalThis.firebase?.auth);
}

export async function initializeFirebaseClient({
  onUserChanged = null
} = {}) {
  if (!isFirebaseBrowserAvailable()) {
    throw new Error(
      'Firebase Auth no está disponible en el navegador'
    );
  }

  if (!globalThis.firebase.apps?.length) {
    globalThis.firebase.initializeApp(FIREBASE_CONFIG);
  }

  auth = globalThis.firebase.auth();

  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }

  return new Promise((resolve, reject) => {
    let first = true;

    unsubscribe = auth.onAuthStateChanged(
      user => {
        currentUser = user || null;

        if (currentUser) {
          setAuthTokenProvider(
            () => currentUser.getIdToken()
          );
        } else {
          clearAuthTokenProvider();
        }

        try {
          onUserChanged?.(currentUser);
        } catch (_) {}

        if (first) {
          first = false;
          resolve(currentUser);
        }
      },
      error => {
        clearAuthTokenProvider();
        currentUser = null;

        if (first) {
          first = false;
          reject(error);
        }
      }
    );
  });
}

export async function loginWithGoogle() {
  ensureAuth();

  const provider = new globalThis.firebase.auth.GoogleAuthProvider();
  provider.setCustomParameters({
    prompt: 'select_account'
  });

  const result = await auth.signInWithPopup(provider);
  currentUser = result.user || null;

  if (currentUser) {
    setAuthTokenProvider(
      () => currentUser.getIdToken()
    );
  }

  return currentUser;
}

export async function logoutFirebase() {
  ensureAuth();
  await auth.signOut();
  currentUser = null;
  clearAuthTokenProvider();
}

export function getCurrentFirebaseUser() {
  return currentUser;
}

export function firebaseUserSummary(user = currentUser) {
  if (!user) return null;

  return {
    uid: user.uid,
    email: user.email || null,
    displayName: user.displayName || null,
    photoURL: user.photoURL || null
  };
}

function ensureAuth() {
  if (!auth) {
    throw new Error('Firebase Auth todavía no está inicializado');
  }
}
