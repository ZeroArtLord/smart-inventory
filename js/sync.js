// sync.js - Sincronización controlada (Firebase como única fuente de verdad)

const Sync = {
    deviceKey: 'smart_inventory_device_id',
    projectKey: 'Establo2026',
    isOnline: () => navigator.onLine,
    
    init() {
        this.deviceId = this.getDeviceId();
        this.setupOnlineListener();
        // Al iniciar, si hay internet, forzar descarga completa
        if (this.isOnline() && window.firebaseDb) {
            this.pullFromFirebase();
        }
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
            this.pullFromFirebase(); // Al reconectar, descargar todo
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
    
    // Cola de cambios pendientes (nunca sube automáticamente)
    async queueProductUpdate(product) {
        await IDBStore.put('syncQueue', {
            id: `q_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
            type: 'product',
            data: product,
            updatedAt: product.updatedAt,
            deviceId: this.deviceId
        });
    },

    // Cola de eliminaciones pendientes
    async queueProductDelete(productId) {
        await IDBStore.put('syncQueue', {
            id: `q_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
            type: 'delete',
            data: { id: productId },
            updatedAt: new Date().toISOString(),
            deviceId: this.deviceId
        });
    },
    
    // Subir manualmente (solo cuando el usuario hace clic)
    async pushToFirebase() {
        if (!this.isOnline() || !window.firebaseDb) {
            alert('Sin conexión a internet');
            return { subidos: 0, errores: 1 };
        }

        const items = await IDBStore.getAll('syncQueue');
        const localProducts = DB.getProducts();
        const localHistory = DB.getHistory();
        const localDaily = DB.getDailyRecords();
        let subidos = 0;
        let errores = 0;

        try {
            // 1) Sincronizar productos: subir todos y borrar los que no existan localmente
            const remoteSnapshot = await window.firebaseDb.collection('products').get();
            const remoteIds = new Set();
            remoteSnapshot.forEach(docSnap => remoteIds.add(docSnap.id));

            const localIds = new Set(localProducts.map(p => p.id));

            for (const product of localProducts) {
                const data = {
                    ...product,
                    projectKey: this.projectKey,
                    updatedAt: product.updatedAt,
                    deviceId: this.deviceId
                };
                await window.firebaseDb.collection('products').doc(product.id).set(data, { merge: false });
                subidos++;
            }

            for (const remoteId of remoteIds) {
                if (!localIds.has(remoteId)) {
                    await window.firebaseDb.collection('products').doc(remoteId).delete();
                    subidos++;
                }
            }

            // 2) Sincronizar historial y registro diario como snapshots completos
            const meta = window.firebaseDb.collection('meta');
            await meta.doc('history').set({
                projectKey: this.projectKey,
                updatedAt: new Date().toISOString(),
                deviceId: this.deviceId,
                data: localHistory
            }, { merge: false });
            subidos++;

            await meta.doc('daily').set({
                projectKey: this.projectKey,
                updatedAt: new Date().toISOString(),
                deviceId: this.deviceId,
                data: localDaily
            }, { merge: false });
            subidos++;

            // 3) Limpiar cola local (ya subimos un snapshot completo)
            for (const item of items) {
                await IDBStore.delete('syncQueue', item.id);
            }
        } catch (error) {
            console.error('Error subiendo datos:', error);
            errores++;
        }

        // Después de subir, descargar para asegurar consistencia
        await this.pullFromFirebase();

        return { subidos, errores };
    },
    
    // DESCARGAR TODO de Firebase y SOBRESCRIBIR localStorage
    async pullFromFirebase() {
        if (!this.isOnline() || !window.firebaseDb) return 0;
        
        try {
            console.log('📥 Descargando todos los productos desde Firebase...');
            const snapshot = await window.firebaseDb.collection('products').get();
            const remoteProducts = [];
            snapshot.forEach(docSnap => {
                remoteProducts.push(docSnap.data());
            });
            
            if (remoteProducts.length === 0) {
                console.log('ℹ️ Firebase vacío');
                localStorage.setItem(DB.PRODUCTS_KEY, JSON.stringify([]));
            } else {
                // SOBRESCRIBIR completamente localStorage (productos)
                localStorage.setItem(DB.PRODUCTS_KEY, JSON.stringify(remoteProducts));
            }
            
            console.log(`✅ Encontrados ${remoteProducts.length} productos en Firebase`);
            
            // Actualizar caché en IndexedDB
            remoteProducts.forEach(p => IDBStore.put('products', p));
            
            // Descargar historial y registro diario (si existen)
            const meta = window.firebaseDb.collection('meta');
            const historyDoc = await meta.doc('history').get();
            const dailyDoc = await meta.doc('daily').get();
            if (historyDoc.exists && historyDoc.data()?.data) {
                localStorage.setItem(DB.HISTORY_KEY, JSON.stringify(historyDoc.data().data));
            } else {
                localStorage.setItem(DB.HISTORY_KEY, JSON.stringify([]));
            }
            if (dailyDoc.exists && dailyDoc.data()?.data) {
                localStorage.setItem(DB.DAILY_KEY, JSON.stringify(dailyDoc.data().data));
            } else {
                localStorage.setItem(DB.DAILY_KEY, JSON.stringify([]));
            }

            console.log('💾 Productos, historial y registro diario guardados en localStorage');
            
            // Notificar a la app para que recargue la interfaz
            if (window.App) {
                if (window.App.limpiarBorradorChecklist) {
                    window.App.limpiarBorradorChecklist();
                }
                window.App.actualizarDashboard();
                window.App.cargarChecklist();
                window.App.cargarListaProductos();
                window.App.cargarSelectores();
                if (window.App.cargarHistorial) {
                    window.App.cargarHistorial();
                }
            }
            
            return remoteProducts.length;
            
        } catch (error) {
            console.error('❌ Error al descargar de Firebase:', error);
            return 0;
        }
    }
};
