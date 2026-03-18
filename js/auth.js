// auth.js - Autenticacion con Google
console.log('auth.js cargado correctamente');

const Auth = {
    user: null,

    init() {
        if (!firebase || !firebase.auth) return;
        firebase.auth().onAuthStateChanged((user) => {
            this.user = user;
            this.updateUI();
            if (user) {
                this.migrateDrafts();
            }
        });
        this.setupLoginButton();
    },

    async login() {
        if (!firebase.auth) {
            console.error('Firebase Auth no esta disponible');
            if (window.App) App.showToast('Error de configuracion de Auth', 'error');
            return;
        }

        const provider = new firebase.auth.GoogleAuthProvider();
        try {
            const result = await firebase.auth().signInWithPopup(provider);
            console.log('Login exitoso', result.user);
        } catch (error) {
            console.error('Error detallado:', error);

            let mensaje = 'Error al iniciar sesion';
            if (error.code === 'auth/popup-blocked') {
                mensaje = 'El navegador bloqueo la ventana emergente. Permite popups para este sitio.';
            } else if (error.code === 'auth/popup-closed-by-user') {
                mensaje = 'Cerraste la ventana sin completar el login.';
            } else if (error.code === 'auth/api-key-not-valid') {
                mensaje = 'API key invalida. Revisa la configuracion.';
            } else if (error.code === 'auth/unauthorized-domain') {
                mensaje = 'Dominio no autorizado en Firebase. Agrega zeroartlord.github.io';
            } else if (error.message) {
                mensaje = error.message;
            }

            if (window.App) {
                window.App.showToast(mensaje, 'error');
            } else {
                alert(mensaje);
            }
        }
    },

    setupLoginButton() {
        const assignEvents = () => {
            const welcomeBtn = document.getElementById('welcomeLoginBtn');
            if (welcomeBtn) {
                if (!welcomeBtn.dataset.bound) {
                    welcomeBtn.addEventListener('click', (e) => {
                        e.preventDefault();
                        this.login();
                    });
                    welcomeBtn.dataset.bound = '1';
                    console.log('Evento asignado al boton de bienvenida');
                }
            }

            const loginBtn = document.getElementById('loginBtn');
            if (loginBtn) {
                if (!loginBtn.dataset.bound) {
                    loginBtn.addEventListener('click', (e) => {
                        e.preventDefault();
                        this.login();
                    });
                    loginBtn.dataset.bound = '1';
                }
            }
        };

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', assignEvents);
        } else {
            assignEvents();
        }
    },

    async logout() {
        await firebase.auth().signOut();
    },

    updateUI() {
        const loginBtn = document.getElementById('loginBtn');
        const logoutBtn = document.getElementById('logoutBtn');
        const userDisplay = document.getElementById('userDisplay');
        const landingScreen = document.getElementById('landingScreen');
        const mainContainer = document.querySelector('.container');
        if (!loginBtn || !logoutBtn || !userDisplay) return;

        if (this.user) {
            if (landingScreen) landingScreen.style.display = 'none';
            if (mainContainer) mainContainer.style.display = 'block';
            loginBtn.style.display = 'none';
            logoutBtn.style.display = 'inline-flex';
            userDisplay.style.display = 'inline-flex';
            userDisplay.textContent = this.user.displayName || this.user.email || 'Usuario';
        } else {
            if (landingScreen) landingScreen.style.display = 'flex';
            if (mainContainer) mainContainer.style.display = 'none';
            loginBtn.style.display = 'inline-flex';
            logoutBtn.style.display = 'none';
            userDisplay.style.display = 'none';
            userDisplay.textContent = '';
        }
    },

    getCurrentId() {
        return this.user ? this.user.uid : (window.Sync && Sync.deviceId ? Sync.deviceId : 'anonymous');
    },

    async migrateDrafts() {
        if (!this.user || !window.Sync) return;
        const oldId = Sync.deviceId;
        const newId = this.user.uid;
        if (!oldId || oldId === newId) return;

        const oldDrafts = await Sync.listChecklistDrafts(oldId);
        if (!oldDrafts || oldDrafts.length === 0) return;

        if (confirm('Se encontraron borradores guardados en este dispositivo. Deseas migrarlos a tu cuenta?')) {
            for (const draft of oldDrafts) {
                await Sync.saveChecklistDraft(draft.products || {}, draft.id, {
                    create: true,
                    customId: newId
                });
            }
            if (window.App && App.showToast) {
                App.showToast('Borradores migrados correctamente', 'success');
            }
        }
    }
};

window.Auth = Auth;
