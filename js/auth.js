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

        const welcomeLoginBtn = document.getElementById('welcomeLoginBtn');
        if (welcomeLoginBtn) {
            welcomeLoginBtn.addEventListener('click', () => this.login());
        }
    },

    async login() {
        const provider = new firebase.auth.GoogleAuthProvider();
        try {
            await firebase.auth().signInWithPopup(provider);
        } catch (error) {
            console.error('Error en login:', error);
            throw error;
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
