// sync.js - Sincronización controlada (nunca sube automáticamente)

const Sync = {
    deviceKey: 'smart_inventory_device_id',
    projectKey: 'Establo2026',
    isOnline: () => navigator.onLine,
    
    init() {
        this.deviceId = this.getDeviceId();
        this.setupOnlineListener();
        this.pullFromFirebase(); // Solo baja, nunca sube
        this.updateIndicator();
    },
    
    getDeviceId() {
        let id = localStorage.getItem(this.deviceKey);
        if (!id) {
            id = `dev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
            localStorage.setItem(this.deviceKey, id);
        }
        return id;
    },
    
    setupOnlineListener() {
        window.addEventListener('online', () => {
            this.pullFromFirebase(); // Al reconectar, solo baja
            this.updateIndicator();
        });
        window.addEventListener('offline', () => {
            this.updateIndicator();
        });
    },
    
    updateIndicator() {
        const el = document.getElementById('syncIndicator');
        if (!el) return;
        const label = el.querySelector('.label');
        const online = this.isOnline() && !!window.firebaseDb;
        el.classList.toggle('online', online);
        el.classList.toggle('offline', !online);
        if (label) label.textContent = online ? 'Firebase: Online' : 'Firebase: Offline';
    },
    
    // ⚠️ Esta función ya no sube automáticamente, solo encola
    async enqueueProductUpdate(product) {
        const payload = {
            id: `q_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
            type: 'product',
            data: product,
            updatedAt: product.updatedAt,
            deviceId: this.deviceId
        };
        // Solo guarda en cola, nunca sube directo
        await IDBStore.put('syncQueue', payload);
    },
    
    // Vaciar cola (subir pendientes) - se llamará manualmente
    async flushQueue() {
        if (!this.isOnline() || !window.firebaseDb) {
            alert('Sin conexión a internet');
            return 0;
        }
        const items = await IDBStore.getAll('syncQueue');
        let subidos = 0;
        for (const item of items) {
            if (item.type === 'product') {
                await this.pushProductToFirebase(item.data);
                subidos++;
            }
            await IDBStore.delete('syncQueue', item.id);
        }
        return subidos;
    },
    
    async pushProductToFirebase(product) {
        const data = {
            ...product,
            projectKey: this.projectKey,
            updatedAt: product.updatedAt,
            deviceId: this.deviceId
        };
        await window.firebaseDb.collection('products').doc(product.id).set(data, { merge: true });
    },
    
    // SOLO BAJAR de Firebase (nunca subir automático)
    async pullFromFirebase() {
        if (!this.isOnline() || !window.firebaseDb) return;
        
        try {
            const snapshot = await window.firebaseDb.collection('products').get();
            const remoteProducts = [];
            snapshot.forEach(docSnap => {
                remoteProducts.push(docSnap.data());
            });
            
            if (remoteProducts.length === 0) {
                console.log('Firebase vacío');
                return;
            }
            
            // IMPORTANTE: Sobrescribir localStorage con los datos de Firebase
            localStorage.setItem(DB.PRODUCTS_KEY, JSON.stringify(remoteProducts));
            
            // Actualizar caché en IndexedDB
            remoteProducts.forEach(p => IDBStore.put('products', p));
            
            console.log(`✅ ${remoteProducts.length} productos bajados de Firebase`);
            
            // Recargar la interfaz para mostrar los nuevos datos
            if (window.App) {
                window.App.actualizarDashboard();
                window.App.cargarChecklist();
                window.App.cargarListaProductos();
            }
            
        } catch (error) {
            console.error('Error al bajar de Firebase:', error);
        }
    }
};