import {
  setAuthTokenProvider,
  clearAuthTokenProvider
} from './authProvider.js';

export const FIREBASE_CONFIG = Object.freeze({
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

export function getFirebaseClientProjectId() {
  return FIREBASE_CONFIG.projectId;
}

export function isFirebaseBrowserAvailable() {
  return Boolean(globalThis.firebase?.initializeApp && globalThis.firebase?.auth);
}

export async function initializeFirebaseClient({
  onUserChanged = null
} = {}) {
  await ensureFirebaseBrowser();

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
            ({ forceRefresh = false } = {}) =>
              currentUser.getIdToken(forceRefresh)
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

  try {
    const result = await auth.signInWithPopup(provider);
    currentUser = result.user || null;

    if (currentUser) {
      setAuthTokenProvider(
        ({ forceRefresh = false } = {}) =>
          currentUser.getIdToken(forceRefresh)
      );
    }

    return currentUser;
  } catch (error) {
    if (shouldUseRedirect(error)) {
      await auth.signInWithRedirect(provider);
      return null;
    }

    throw error;
  }
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

async function ensureFirebaseBrowser() {
  if (isFirebaseBrowserAvailable()) return;

  await loadScript(
    'https://www.gstatic.com/firebasejs/10.12.5/firebase-app-compat.js'
  );
  await loadScript(
    'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth-compat.js'
  );

  if (!isFirebaseBrowserAvailable()) {
    throw new Error(
      'Firebase Auth no pudo inicializarse en este navegador'
    );
  }
}

function loadScript(src) {
  const existing = document.querySelector(
    `script[src="${src}"]`
  );

  if (existing?.dataset.loaded === 'true') {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const script = existing || document.createElement('script');

    const handleLoad = () => {
      script.dataset.loaded = 'true';
      cleanup();
      resolve();
    };

    const handleError = () => {
      cleanup();
      reject(new Error(
        'No se pudo cargar Firebase Auth'
      ));
    };

    const cleanup = () => {
      script.removeEventListener('load', handleLoad);
      script.removeEventListener('error', handleError);
    };

    script.addEventListener('load', handleLoad, { once: true });
    script.addEventListener('error', handleError, { once: true });

    if (!existing) {
      script.src = src;
      script.async = true;
      document.head.appendChild(script);
    }
  });
}

function ensureAuth() {
  if (!auth) {
    throw new Error('Firebase Auth todavía no está inicializado');
  }
}


function shouldUseRedirect(error) {
  return [
    'auth/popup-blocked',
    'auth/operation-not-supported-in-this-environment'
  ].includes(error?.code);
}
