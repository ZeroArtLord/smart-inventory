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

        const rawProducts = DB.getProducts();
        const totalRaw = rawProducts.length;
        const { products: localProducts, duplicates, invalidIds } = this.normalizeProductsForUpload(rawProducts);
        const total = localProducts.length;
        if (total === 0) {
            alert('No hay productos para subir');
            return { subidos: 0, errores: 0, total: 0 };
        }

        console.log(`📤 Iniciando subida de ${total} productos a Firebase... (local: ${totalRaw})`);
        if (duplicates.length > 0) {
            console.warn('⚠️ IDs duplicados detectados (se sube la última versión):', duplicates);
        }
        if (invalidIds.length > 0) {
            console.warn('⚠️ Productos sin ID válido fueron omitidos:', invalidIds);
        }

        let subidos = 0;
        let errores = 0;
        let remoteCount = null;
        const batchSize = 500;

        try {
            for (let i = 0; i < total; i += batchSize) {
                const batch = window.firebaseDb.batch();
                const chunk = localProducts.slice(i, i + batchSize);
                chunk.forEach(product => {
                    const docRef = window.firebaseDb.collection('products').doc(product.id);
                    const data = this.sanitizeForFirestore({
                        ...product,
                        projectKey: this.projectKey,
                        updatedAt: product.updatedAt || new Date().toISOString(),
                        deviceId: this.deviceId
                    });
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
            remoteCount = snapshot.size;
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
                errores = Math.max(0, total - remoteCount);
            }
        } catch (error) {
            console.error('❌ Error grave en pushToFirebase:', error);
            errores = Math.max(1, total - subidos);
        }

        const resultado = { subidos, errores, total, remoteCount, totalRaw };
        if (resultado.errores > 0) {
            const remotoTxt = (remoteCount !== null) ? ` Firebase: ${remoteCount}.` : '';
            alert(`⚠️ Subida incompleta: ${subidos} de ${total} productos subidos.${remotoTxt} Revisa la consola.`);
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
    ,

    sanitizeForFirestore(obj) {
        if (obj === null || obj === undefined) return null;
        if (Array.isArray(obj)) {
            return obj.map(item => this.sanitizeForFirestore(item)).filter(v => v !== undefined);
        }
        if (typeof obj === 'object') {
            const out = {};
            Object.keys(obj).forEach(key => {
                const val = this.sanitizeForFirestore(obj[key]);
                if (val !== undefined) out[key] = val;
            });
            return out;
        }
        return obj;
    },

    normalizeProductsForUpload(rawProducts) {
        const map = new Map();
        const duplicates = [];
        const invalidIds = [];
        rawProducts.forEach((p, idx) => {
            const id = (p && p.id !== undefined && p.id !== null) ? String(p.id).trim() : '';
            if (!id) {
                invalidIds.push({ index: idx, name: p?.name || '', id: p?.id });
                return;
            }
            if (map.has(id)) {
                duplicates.push(id);
            }
            map.set(id, p);
        });
        return { products: Array.from(map.values()), duplicates, invalidIds };
    },

    async saveChecklistDraft(draftData, draftId = null, options = {}) {
        if (!this.isOnline() || !window.firebaseDb) return;
        const id = draftId || Date.now().toString();
        const nowIso = new Date().toISOString();

        if (!options.force && draftId && options.localLastUpdated) {
            const existing = await this.loadChecklistDraft(draftId);
            if (existing?.lastUpdated) {
                const remoteTime = new Date(existing.lastUpdated).getTime();
                const localTime = new Date(options.localLastUpdated).getTime();
                if (remoteTime > localTime) {
                    return { conflict: true, remoteLastUpdated: existing.lastUpdated };
                }
            }
        }

        const draft = {
            id,
            deviceId: this.deviceId,
            projectKey: this.projectKey,
            createdAt: options.create ? nowIso : undefined,
            lastUpdated: nowIso,
            products: draftData,
            productCount: Object.keys(draftData || {}).length
        };
        const cleaned = this.sanitizeForFirestore(draft);
        await window.firebaseDb
            .collection('checklist_drafts')
            .doc(this.deviceId)
            .collection('drafts')
            .doc(id)
            .set(cleaned, { merge: true });
        return { id, lastUpdated: nowIso };
    },

    async loadChecklistDraft(draftId) {
        if (!this.isOnline() || !window.firebaseDb) return null;
        if (!draftId) return null;
        const doc = await window.firebaseDb
            .collection('checklist_drafts')
            .doc(this.deviceId)
            .collection('drafts')
            .doc(draftId)
            .get();
        if (doc.exists) return doc.data();
        return null;
    },

    async deleteChecklistDraft(draftId) {
        if (!this.isOnline() || !window.firebaseDb) return;
        if (!draftId) return;
        await window.firebaseDb
            .collection('checklist_drafts')
            .doc(this.deviceId)
            .collection('drafts')
            .doc(draftId)
            .delete();
    },

    async listChecklistDrafts() {
        if (!this.isOnline() || !window.firebaseDb) return [];
        try {
            const snapshot = await window.firebaseDb
                .collection('checklist_drafts')
                .doc(this.deviceId)
                .collection('drafts')
                .orderBy('lastUpdated', 'desc')
                .get();
            const drafts = [];
            snapshot.forEach(doc => drafts.push(doc.data()));
            return drafts;
        } catch (e) {
            const snapshot = await window.firebaseDb
                .collection('checklist_drafts')
                .doc(this.deviceId)
                .collection('drafts')
                .get();
            const drafts = [];
            snapshot.forEach(doc => drafts.push(doc.data()));
            return drafts;
        }
    },

    async deleteAllChecklistDrafts() {
        if (!this.isOnline() || !window.firebaseDb) return;
        const snapshot = await window.firebaseDb
            .collection('checklist_drafts')
            .doc(this.deviceId)
            .collection('drafts')
            .get();
        const batch = window.firebaseDb.batch();
        snapshot.forEach(doc => batch.delete(doc.ref));
        await batch.commit();
    }
};
