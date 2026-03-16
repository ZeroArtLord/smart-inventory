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
    
    // Subir manualmente (con control de lotes y verificación)
    async pushToFirebase() {
        if (!this.isOnline() || !window.firebaseDb) {
            alert('Sin conexión a internet');
            return { subidos: 0, errores: 0, total: 0 };
        }

        const localProducts = DB.getProducts();
        const total = localProducts.length;
        if (total === 0) {
            alert('No hay productos para subir');
            return { subidos: 0, errores: 0, total: 0 };
        }

        console.log(`📤 Iniciando subida de ${total} productos a Firebase...`);

        let subidos = 0;
        let errores = 0;
        const batchSize = 500;

        try {
            for (let i = 0; i < total; i += batchSize) {
                const batch = window.firebaseDb.batch();
                const chunk = localProducts.slice(i, i + batchSize);
                chunk.forEach(product => {
                    const docRef = window.firebaseDb.collection('products').doc(product.id);
                    const data = {
                        ...product,
                        projectKey: this.projectKey,
                        updatedAt: product.updatedAt || new Date().toISOString(),
                        deviceId: this.deviceId
                    };
                    batch.set(docRef, data, { merge: false });
                });
                await batch.commit();
                subidos += chunk.length;
                console.log(`✅ Lote ${Math.floor(i / batchSize) + 1} subido (${chunk.length} productos)`);
            }

            try {
                const history = DB.getHistory();
                const daily = DB.getDailyRecords();
                if (history.length > 0) {
                    await window.firebaseDb.collection('meta').doc('history').set({
                        projectKey: this.projectKey,
                        updatedAt: new Date().toISOString(),
                        deviceId: this.deviceId,
                        data: history
                    }, { merge: false });
                }
                if (daily.length > 0) {
                    await window.firebaseDb.collection('meta').doc('daily').set({
                        projectKey: this.projectKey,
                        updatedAt: new Date().toISOString(),
                        deviceId: this.deviceId,
                        data: daily
                    }, { merge: false });
                }
            } catch (metaError) {
                console.warn('Error al subir metadatos (no crítico):', metaError);
            }

            const snapshot = await window.firebaseDb.collection('products').get();
            const remoteCount = snapshot.size;
            if (remoteCount === total) {
                console.log(`🎉 ¡Subida exitosa! ${remoteCount} productos en Firebase.`);
                try {
                    const items = await IDBStore.getAll('syncQueue');
                    for (const item of items) {
                        await IDBStore.delete('syncQueue', item.id);
                    }
                } catch (e) {}
                localStorage.removeItem('checklist_draft');
            } else {
                console.error(`❌ Discrepancia: Firebase tiene ${remoteCount} productos, pero se intentaron subir ${total}.`);
                errores = total - remoteCount;
            }
        } catch (error) {
            console.error('❌ Error grave en pushToFirebase:', error);
            errores = total - subidos;
        }

        const resultado = { subidos, errores, total };
        if (resultado.errores > 0) {
            alert(`⚠️ Subida incompleta: ${subidos} de ${total} productos subidos. Revisa la consola.`);
        } else if (subidos === total) {
            alert(`✅ ${subidos} productos subidos correctamente.`);
        }

        return resultado;
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
