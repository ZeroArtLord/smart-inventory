import test from 'node:test';
import assert from 'node:assert/strict';

const {
  initializeFirebaseClient,
  loginWithGoogle,
  logoutFirebase
} = await import('../src/auth/firebaseClient.js');

const {
  getAuthToken,
  clearAuthTokenProvider
} = await import('../src/auth/authProvider.js');

test('Firebase browser usa persistencia LOCAL y proveedor de token refrescable', async () => {
  const tokenCalls = [];
  const user = {
    uid: 'uid-browser-test',
    email: 'browser@example.com',
    displayName: 'Browser Test',
    async getIdToken(forceRefresh) {
      tokenCalls.push(
        Boolean(forceRefresh)
      );
      return forceRefresh
        ? 'fresh-browser-token'
        : 'browser-token';
    }
  };

  const mock = installFirebaseMock({
    initialUser: user
  });

  const resolved =
    await initializeFirebaseClient();

  assert.equal(resolved, user);
  assert.equal(
    mock.persistence,
    'LOCAL'
  );
  assert.equal(
    mock.redirectResultCalls,
    1
  );

  assert.equal(
    await getAuthToken({
      required: true
    }),
    'browser-token'
  );

  assert.equal(
    await getAuthToken({
      required: true,
      forceRefresh: true
    }),
    'fresh-browser-token'
  );

  assert.deepEqual(
    tokenCalls,
    [false, true]
  );

  await logoutFirebase();
  clearAuthTokenProvider();
});

test('Google login cambia a redirect si el popup está bloqueado', async () => {
  const error = new Error(
    'Popup blocked'
  );
  error.code = 'auth/popup-blocked';

  const mock = installFirebaseMock({
    initialUser: null,
    popupError: error
  });

  await initializeFirebaseClient();

  const result = await loginWithGoogle();

  assert.equal(result, null);
  assert.equal(mock.popupCalls, 1);
  assert.equal(mock.redirectCalls, 1);

  clearAuthTokenProvider();
});

function installFirebaseMock({
  initialUser = null,
  popupError = null
} = {}) {
  const state = {
    currentUser: initialUser,
    persistence: null,
    redirectResultCalls: 0,
    popupCalls: 0,
    redirectCalls: 0,
    signOutCalls: 0,
    listener: null
  };

  const authInstance = {
    async setPersistence(value) {
      state.persistence = value;
    },

    async getRedirectResult() {
      state.redirectResultCalls += 1;
      return {
        user: state.currentUser
      };
    },

    onAuthStateChanged(next) {
      state.listener = next;
      queueMicrotask(() =>
        next(state.currentUser)
      );
      return () => {
        state.listener = null;
      };
    },

    async signInWithPopup() {
      state.popupCalls += 1;

      if (popupError) {
        throw popupError;
      }

      return {
        user: state.currentUser
      };
    },

    async signInWithRedirect() {
      state.redirectCalls += 1;
    },

    async signOut() {
      state.signOutCalls += 1;
      state.currentUser = null;
      state.listener?.(null);
    }
  };

  function authFactory() {
    return authInstance;
  }

  authFactory.Auth = {
    Persistence: {
      LOCAL: 'LOCAL'
    }
  };

  authFactory.GoogleAuthProvider =
    class GoogleAuthProvider {
      setCustomParameters(value) {
        this.parameters = value;
      }
    };

  globalThis.firebase = {
    apps: [],
    initializeApp() {
      this.apps.push({
        name: '[DEFAULT]'
      });
      return this.apps[0];
    },
    auth: authFactory
  };

  return state;
}
