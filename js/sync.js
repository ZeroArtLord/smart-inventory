// sync.js - Sincronización offline-first (IndexedDB + Firebase)

const Sync = {
    deviceKey: 'smart_inventory_device_id',
    projectKey: 'Establo2026',
    isOnline: () => navigator.onLine,
    
    init() {
        this.deviceId = this.getDeviceId();
        this.setupOnlineListener();
        this.pullFromFirebase();
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
            this.flushQueue();
            this.pullFromFirebase();
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
    
    async enqueueProductUpdate(product) {
        const payload = {
            id: `q_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
            type: 'product',
            data: product,
            updatedAt: product.updatedAt,
            deviceId: this.deviceId
        };
        
        if (this.isOnline() && window.firebaseDb) {
            await this.pushProductToFirebase(product);
        } else {
            await IDBStore.put('syncQueue', payload);
        }
    },
    
    async flushQueue() {
        if (!this.isOnline() || !window.firebaseDb) return;
        const items = await IDBStore.getAll('syncQueue');
        for (const item of items) {
            if (item.type === 'product') {
                await this.pushProductToFirebase(item.data);
            }
            await IDBStore.delete('syncQueue', item.id);
        }
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
    
    async pullFromFirebase() {
        if (!this.isOnline() || !window.firebaseDb) return;
        const snapshot = await window.firebaseDb.collection('products').get();
        const remoteProducts = [];
        snapshot.forEach(docSnap => {
            remoteProducts.push(docSnap.data());
        });
        
        if (remoteProducts.length === 0) return;
        
        const localProducts = DB.getProducts();
        const localMap = new Map(localProducts.map(p => [p.id, p]));
        let changed = false;
        
        remoteProducts.forEach(remote => {
            const local = localMap.get(remote.id);
            if (!local) {
                localMap.set(remote.id, remote);
                changed = true;
                return;
            }
            
            const remoteTime = new Date(remote.updatedAt || 0).getTime();
            const localTime = new Date(local.updatedAt || 0).getTime();
            
            if (remoteTime > localTime) {
                localMap.set(remote.id, remote);
                changed = true;
            }
        });
        
        if (changed) {
            const merged = Array.from(localMap.values());
            localStorage.setItem(DB.PRODUCTS_KEY, JSON.stringify(merged));
            merged.forEach(p => IDBStore.put('products', p));
        }
    }
};
