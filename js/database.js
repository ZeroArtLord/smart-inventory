// database.js - Manejo de localStorage y operaciones CRUD
// Smart Inventory - ByteMind Solutions

const DB = {
    // Claves para localStorage
    PRODUCTS_KEY: 'smart_inventory_products',
    HISTORY_KEY: 'smart_inventory_history',
    DAILY_KEY: 'smart_inventory_daily',
    AUDIT_KEY: 'smart_inventory_audit_logs',
    BACKUP_PREFIX: 'smart_inventory_backup_',
    PRODUCTS_HASH_KEY: 'smart_inventory_products_hash',
    TARGET_DAYS_KEY: 'smart_inventory_target_days',
    
    // Inicializar datos si no existen
    init: function() {
        if (!localStorage.getItem(this.PRODUCTS_KEY)) {
            localStorage.setItem(this.PRODUCTS_KEY, JSON.stringify([]));
        }
        if (!localStorage.getItem(this.HISTORY_KEY)) {
            localStorage.setItem(this.HISTORY_KEY, JSON.stringify([]));
        }
        if (!localStorage.getItem(this.DAILY_KEY)) {
            localStorage.setItem(this.DAILY_KEY, JSON.stringify([]));
        }
        if (!localStorage.getItem(this.AUDIT_KEY)) {
            localStorage.setItem(this.AUDIT_KEY, JSON.stringify([]));
        }
        
        // Datos de ejemplo para pruebas
        if (this.getProducts().length === 0) {
            this.addSampleData();
        }
        
        // Normalizar productos existentes
        this.migrateProducts();
        this.validateDataIntegrity();
        this.checkLocalStorageTampering();
        this.autoBackup();
        
        // Cargar respaldo local de IndexedDB si existe
        this.loadFromIndexedDB();
    },
    
    // Agregar datos de ejemplo
    addSampleData: function() {
        const sampleProducts = [
            {
                id: '1',
                name: 'Aceite 24und',
                currentStock: 18,
                minStock: 5,
                maxStock: 30,
                unit: 'UND',
                category: 'LÍQUIDOS',
                supplier: '',
                actionsPending: { buy: 0, order: 0 },
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            },
            {
                id: '2',
                name: 'Harina PAN',
                currentStock: 7,
                minStock: 10,
                maxStock: 24,
                unit: 'KG',
                category: 'GRANOS',
                supplier: '',
                actionsPending: { buy: 0, order: 0 },
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            },
            {
                id: '3',
                name: 'Azúcar 1kg',
                currentStock: 32,
                minStock: 8,
                maxStock: 40,
                unit: 'KG',
                category: 'GRANOS',
                supplier: '',
                actionsPending: { buy: 0, order: 0 },
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            }
        ];
        
        this.saveProducts(sampleProducts);
        
        // Historial de ejemplo
        const sampleHistory = [
            {
                id: 'h1',
                productId: '1',
                productName: 'Aceite 24und',
                initialStock: 10,
                purchase: 24,
                finalStock: 18,
                consumption: 16,
                weekDate: '2024-W10',
                createdAt: new Date().toISOString()
            },
            {
                id: 'h2',
                productId: '1',
                productName: 'Aceite 24und',
                initialStock: 18,
                purchase: 12,
                finalStock: 15,
                consumption: 15,
                weekDate: '2024-W11',
                createdAt: new Date().toISOString()
            }
        ];
        
        this.saveHistory(sampleHistory);
    },
    
    // ========== PRODUCTOS ==========
    
    // Obtener todos los productos
    getProducts: function() {
        const products = localStorage.getItem(this.PRODUCTS_KEY);
        return products ? JSON.parse(products) : [];
    },
    
    // Obtener producto por ID
    getProductById: function(id) {
        const products = this.getProducts();
        return products.find(product => product.id === id);
    },
    
    // Buscar producto por nombre (insensible a mayúsculas)
    findProductByName: function(name) {
        const products = this.getProducts();
        return products.find(product => 
            product.name.toLowerCase() === name.toLowerCase()
        );
    },
    
    // Agregar nuevo producto
    addProduct: function(productData) {
        const products = this.getProducts();
        
        // Verificar si ya existe
        const existingProduct = this.findProductByName(productData.name);
        if (existingProduct) {
            return { success: false, message: 'El producto ya existe' };
        }
        
        // Crear nuevo producto con ID único
        const newProduct = {
            id: Date.now().toString(),
            name: this.sanitizeText(productData.name),
            currentStock: this.normalizeNumber(productData.currentStock),
            minStock: this.normalizeNumber(productData.minStock),
            maxStock: this.normalizeNumber(productData.maxStock),
            unit: this.normalizeUnit(productData.unit),
            category: productData.category ? this.sanitizeText(productData.category) : this.getCategoryForName(productData.name),
            supplier: this.sanitizeText(productData.supplier || ''),
            actionsPending: { buy: 0, order: 0 },
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
        
        products.push(newProduct);
        this.saveProducts(products);
        IDBStore.put('products', newProduct);
        Sync.enqueueProductUpdate(newProduct);
        this.auditLog('add_product', { id: newProduct.id, name: newProduct.name });
        
        return { success: true, product: newProduct };
    },
    
    // Actualizar producto
    updateProduct: function(id, updateData) {
        if (!this.validateProductId(id)) {
            return { success: false, message: 'ID de producto invÃ¡lido' };
        }
        const products = this.getProducts();
        const index = products.findIndex(product => product.id === id);
        
        if (index === -1) {
            return { success: false, message: 'Producto no encontrado' };
        }
        
        // Verificar si el nuevo nombre ya existe en otro producto
        if (updateData.name && updateData.name !== products[index].name) {
            const existingProduct = this.findProductByName(updateData.name);
            if (existingProduct && existingProduct.id !== id) {
                return { success: false, message: 'Ya existe otro producto con ese nombre' };
            }
        }
        
        // Actualizar producto
        products[index] = {
            ...products[index],
            ...updateData,
            name: this.sanitizeText(updateData.name || products[index].name),
            unit: this.normalizeUnit(updateData.unit || products[index].unit),
            maxStock: this.normalizeNumber(
                updateData.maxStock !== undefined ? updateData.maxStock : products[index].maxStock
            ),
            category: updateData.category ? this.sanitizeText(updateData.category) : this.getCategoryForName(updateData.name || products[index].name),
            supplier: updateData.supplier !== undefined ? this.sanitizeText(updateData.supplier) : products[index].supplier,
            actionsPending: updateData.actionsPending || products[index].actionsPending || { buy: 0, order: 0 },
            updatedAt: new Date().toISOString()
        };
        
        this.saveProducts(products);
        IDBStore.put('products', products[index]);
        Sync.enqueueProductUpdate(products[index]);
        this.auditLog('update_product', { id, name: products[index].name });
        return { success: true, product: products[index] };
    },
    
    // Eliminar producto
    deleteProduct: function(id) {
        if (!this.validateProductId(id)) {
            return { success: false, message: 'ID de producto invÃ¡lido' };
        }
        const products = this.getProducts();
        const filteredProducts = products.filter(product => product.id !== id);
        
        if (filteredProducts.length === products.length) {
            return { success: false, message: 'Producto no encontrado' };
        }
        
        this.saveProducts(filteredProducts);
        IDBStore.delete('products', id);
        
        // También eliminar historial del producto
        this.deleteProductHistory(id);
        this.auditLog('delete_product', { id });
        
        return { success: true };
    },
    
    // ========== HISTORIAL ==========
    
    // Obtener todo el historial
    getHistory: function() {
        const history = localStorage.getItem(this.HISTORY_KEY);
        return history ? JSON.parse(history) : [];
    },

    // ========== REGISTRO DIARIO ==========
    getDailyRecords: function() {
        const records = localStorage.getItem(this.DAILY_KEY);
        return records ? JSON.parse(records) : [];
    },
    
    getDailyRecordByDate: function(dateStr) {
        const records = this.getDailyRecords();
        return records.find(r => r.date === dateStr);
    },
    
    upsertDailyRecord: function(dateStr, productEntry) {
        const records = this.getDailyRecords();
        let record = records.find(r => r.date === dateStr);
        
        if (!record) {
            record = {
                id: this.generateId(),
                date: dateStr,
                products: [],
                summary: { buys: 0, orders: 0, totalActions: 0 }
            };
            records.push(record);
        }
        
        const idx = record.products.findIndex(p => p.id === productEntry.id);
        if (idx >= 0) {
            record.products[idx] = productEntry;
        } else {
            record.products.push(productEntry);
        }
        
        record.summary = this.calculateDailySummary(record.products);
        this.saveDaily(records);
        return record;
    },
    
    calculateDailySummary: function(products) {
        const buys = products.filter(p => (p.buyToday || 0) > 0).length;
        const orders = products.filter(p => (p.orderToday || 0) > 0).length;
        return {
            buys,
            orders,
            totalActions: buys + orders
        };
    },
    
    // Obtener historial por producto
    getHistoryByProduct: function(productId) {
        const history = this.getHistory();
        return history
            .filter(record => record.productId === productId)
            .sort((a, b) => this.compareWeekDesc(a, b));
    },
    
    // Agregar registro al historial
    addHistoryRecord: function(recordData) {
        const history = this.getHistory();
        
        const newRecord = {
            id: Date.now().toString(),
            productId: recordData.productId,
            productName: recordData.productName,
            initialStock: parseInt(recordData.initialStock),
            purchase: parseInt(recordData.purchase) || 0,
            finalStock: parseInt(recordData.finalStock),
            consumption: parseInt(recordData.consumption),
            weekDate: recordData.weekDate,
            actionType: recordData.actionType || 'manual',
            createdAt: new Date().toISOString()
        };
        
        history.push(newRecord);
        this.saveHistory(history);
        
        // Actualizar stock actual solo si es la semana actual
        if (this.isCurrentWeek(recordData.weekDate)) {
            this.updateProduct(recordData.productId, {
                currentStock: recordData.finalStock
            });
        }
        this.clearCalculationCache();
        this.auditLog('add_history', { id: newRecord.id, productId: newRecord.productId });
        
        return { success: true, record: newRecord };
    },
    
    // Eliminar registro del historial
    deleteHistoryRecord: function(recordId) {
        const history = this.getHistory();
        const recordToDelete = history.find(record => record.id === recordId);
        const filteredHistory = history.filter(record => record.id !== recordId);
        
        if (filteredHistory.length === history.length) {
            return { success: false, message: 'Registro no encontrado' };
        }
        
        this.saveHistory(filteredHistory);
        
        // Recalcular stock actual del producto relacionado
        if (recordToDelete) {
            const remaining = filteredHistory.filter(record => record.productId === recordToDelete.productId);
            const latest = this.getLatestHistoryRecord(remaining);
            
            this.updateProduct(recordToDelete.productId, {
                currentStock: latest ? latest.finalStock : 0
            });
        }
        this.clearCalculationCache();
        this.auditLog('delete_history', { id: recordId });
        return { success: true };
    },
    
    // Eliminar todo el historial de un producto
    deleteProductHistory: function(productId) {
        const history = this.getHistory();
        const filteredHistory = history.filter(record => record.productId !== productId);
        
        this.saveHistory(filteredHistory);
        this.clearCalculationCache();
    },
    
    // ========== UTILIDADES ==========
    
    // Generar ID único
    generateId: function() {
        return Date.now().toString() + Math.random().toString(36).substr(2, 9);
    },
    
    // Obtener consumo promedio de las últimas 4 semanas
    getAverageConsumption: function(productId, weeks = 4) {
        const cacheKey = `avg:${productId}:${weeks}`;
        const cached = this.calcCache.get(cacheKey);
        if (cached !== null) return cached;
        
        const history = this.getHistoryByProduct(productId);
        
        if (history.length === 0) return 0;
        
        // Tomar las últimas 4 semanas
        const lastWeeks = history.slice(0, weeks);
        const totalConsumption = lastWeeks.reduce((sum, record) => sum + (record.consumption || 0), 0);
        
        if (lastWeeks.length === 0) return 0;
        const avg = Math.round(totalConsumption / lastWeeks.length);
        this.calcCache.set(cacheKey, avg);
        return avg;
    },
    
    // Comparar semanas en orden descendente (más reciente primero)
    compareWeekDesc: function(a, b) {
        const aKey = this.parseWeekKey(a.weekDate);
        const bKey = this.parseWeekKey(b.weekDate);
        
        if (aKey !== null && bKey !== null) {
            return bKey - aKey;
        }
        
        if (aKey !== null) return -1;
        if (bKey !== null) return 1;
        
        return new Date(b.createdAt) - new Date(a.createdAt);
    },
    
    // Convertir semana ISO YYYY-Www a clave numérica
    parseWeekKey: function(weekStr) {
        if (!weekStr) return null;
        const match = /^(\d{4})-W(\d{2})$/.exec(String(weekStr).trim());
        if (!match) return null;
        const year = parseInt(match[1], 10);
        const week = parseInt(match[2], 10);
        if (Number.isNaN(year) || Number.isNaN(week)) return null;
        return (year * 100) + week;
    },
    
    // Obtener semana actual ISO YYYY-Www
    getCurrentWeekISO: function() {
        const now = new Date();
        const target = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
        const dayNr = (target.getUTCDay() + 6) % 7;
        target.setUTCDate(target.getUTCDate() - dayNr + 3);
        const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
        const week = 1 + Math.round((target - firstThursday) / (7 * 24 * 60 * 60 * 1000));
        const year = target.getUTCFullYear();
        return `${year}-W${week.toString().padStart(2, '0')}`;
    },
    
    // Verificar si una semana es la actual
    isCurrentWeek: function(weekStr) {
        if (!weekStr) return false;
        return String(weekStr).trim() === this.getCurrentWeekISO();
    },
    
    // Obtener el registro más reciente por weekDate
    getLatestHistoryRecord: function(records) {
        if (!records || records.length === 0) return null;
        const sorted = [...records].sort((a, b) => this.compareWeekDesc(a, b));
        return sorted[0] || null;
    },
    
    // Obtener recomendación de compra
    getPurchaseRecommendation: function(product) {
        const avgConsumption = this.getAverageConsumption(product.id);
        const minStock = this.normalizeNumber(product.minStock);
        const maxStock = this.normalizeNumber(product.maxStock);
        const currentStock = this.normalizeNumber(product.currentStock);
        const unit = this.normalizeUnit(product.unit);
        
        // Regla clara: si está por encima del mínimo, no comprar
        if (currentStock > minStock) return 'NO COMPRAR';
        
        let needed = (avgConsumption + minStock) - currentStock;
        if (needed <= 0) return 'NO COMPRAR';
        
        if (maxStock > 0) {
            const availableSpace = maxStock - currentStock;
            if (availableSpace <= 0) return 'NO COMPRAR';
            needed = Math.min(needed, availableSpace);
        }
        
        const qty = this.formatNumber(needed);
        return `COMPRAR ${qty} ${unit}`;
    },
    
    // Recomendación automática (cantidad sugerida)
    calculateAutoRecommendation: function(product) {
        const avgConsumption = this.getAverageConsumption(product.id);
        const currentStock = this.normalizeNumber(product.currentStock);
        const minStock = this.normalizeNumber(product.minStock);
        const maxStock = this.normalizeNumber(product.maxStock);
        const targetDays = this.getTargetDays();
        const desiredStock = Math.max(minStock, avgConsumption * (targetDays / 7));
        
        if (currentStock < desiredStock) {
            let rec = Math.ceil(desiredStock - currentStock);
            const seasonal = this.detectSeasonality(product.id);
            if (seasonal.isSeasonal) {
                rec = Math.ceil(rec * 1.2);
            }
            if (maxStock > 0) rec = Math.min(rec, Math.max(0, maxStock - currentStock));
            return rec;
        }
        
        return 0;
    },
    
    // Obtener estado del producto
    getProductStatus: function(product) {
        const currentStock = this.normalizeNumber(product.currentStock);
        const minStock = this.normalizeNumber(product.minStock);
        const lowThreshold = minStock * 1.2;
        
        if (currentStock <= minStock) {
            return { status: 'critical', icon: '🔴', label: 'Crítico' };
        }
        
        if (currentStock <= lowThreshold) {
            return { status: 'low', icon: '🟡', label: 'Bajo' };
        }
        
        return { status: 'good', icon: '🟢', label: 'Bueno' };
    },
    
    // Obtener estadísticas generales
    getStatistics: function() {
        const products = this.getProducts();
        let good = 0, low = 0, critical = 0;
        
        products.forEach(product => {
            const status = this.getProductStatus(product);
            if (status.status === 'good') good++;
            else if (status.status === 'low') low++;
            else if (status.status === 'critical') critical++;
        });
        
        return {
            total: products.length,
            good,
            low,
            critical
        };
    }
    ,
    
    // Normalizar número (acepta string o número)
    normalizeNumber: function(value) {
        if (value === null || value === undefined || value === '') return 0;
        const num = typeof value === 'number' ? value : parseFloat(String(value).replace(',', '.'));
        return Number.isNaN(num) ? 0 : num;
    },
    
    sanitizeText: function(value) {
        const text = String(value || '');
        return text.replace(/[<>]/g, '').trim();
    },
    
    validateProductId: function(id) {
        return /^[a-zA-Z0-9_-]+$/.test(String(id || ''));
    },
    
    // Días objetivo de stock
    getTargetDays: function() {
        const raw = localStorage.getItem(this.TARGET_DAYS_KEY);
        const val = this.normalizeNumber(raw || 10);
        return val > 0 ? val : 10;
    },
    
    setTargetDays: function(days) {
        const val = this.normalizeNumber(days);
        localStorage.setItem(this.TARGET_DAYS_KEY, val > 0 ? String(val) : '10');
    },
    
    // Normalizar unidad
    normalizeUnit: function(unit) {
        const u = String(unit || '').trim().toUpperCase();
        return u ? u : 'UND';
    },
    
    // Formatear número para mostrar
    formatNumber: function(value) {
        const num = this.normalizeNumber(value);
        if (Number.isInteger(num)) return String(num);
        return String(Math.round(num * 100) / 100);
    },
    
    // Formatear cantidad con unidad
    formatQuantity: function(value, unit) {
        return `${this.formatNumber(value)} ${this.normalizeUnit(unit)}`;
    },
    
    // Guardar acciones pendientes de un producto
    setPendingActions: function(productId, buyQty, orderQty) {
        const product = this.getProductById(productId);
        if (!product) return false;
        const buy = this.normalizeNumber(buyQty);
        const order = this.normalizeNumber(orderQty);
        
        product.actionsPending = {
            buy: buy < 0 ? 0 : buy,
            order: order < 0 ? 0 : order
        };
        
        this.updateProduct(productId, { actionsPending: product.actionsPending });
        this.auditLog('set_pending_actions', { id: productId, buy: product.actionsPending.buy, order: product.actionsPending.order });
        return true;
    },
    
    // Ejecutar compras (sumar al stock y limpiar pendientes)
    executePurchases: function() {
        const products = this.getProducts();
        let updated = 0;
        const updatedProducts = [];
        
        products.forEach(p => {
            const buy = this.normalizeNumber(p.actionsPending?.buy || 0);
            if (buy > 0) {
                const initialStock = this.normalizeNumber(p.currentStock);
                const finalStock = initialStock + buy;
                
                this.addAutoHistoryRecord({
                    productId: p.id,
                    productName: p.name,
                    initialStock: initialStock,
                    purchase: buy,
                    finalStock: finalStock,
                    consumption: 0,
                    weekDate: this.getCurrentWeekISO(),
                    actionType: 'compra'
                });
                
                p.currentStock = finalStock;
                p.actionsPending.buy = 0;
                p.updatedAt = new Date().toISOString();
                updated++;
                updatedProducts.push(p);
            }
        });
        
        this.saveProducts(products);
        updatedProducts.forEach(p => {
            IDBStore.put('products', p);
            Sync.enqueueProductUpdate(p);
        });
        this.auditLog('execute_purchases', { updated });
        return updated;
    },
    
    // Ejecutar pedidos (sumar al stock y limpiar pendientes)
    executeOrders: function() {
        const products = this.getProducts();
        let updated = 0;
        const updatedProducts = [];
        
        products.forEach(p => {
            const order = this.normalizeNumber(p.actionsPending?.order || 0);
            if (order > 0) {
                const initialStock = this.normalizeNumber(p.currentStock);
                const finalStock = initialStock + order;
                
                this.addAutoHistoryRecord({
                    productId: p.id,
                    productName: p.name,
                    initialStock: initialStock,
                    purchase: order,
                    finalStock: finalStock,
                    consumption: 0,
                    weekDate: this.getCurrentWeekISO(),
                    actionType: 'pedido'
                });
                
                p.currentStock = finalStock;
                p.actionsPending.order = 0;
                p.updatedAt = new Date().toISOString();
                updated++;
                updatedProducts.push(p);
            }
        });
        
        this.saveProducts(products);
        updatedProducts.forEach(p => {
            IDBStore.put('products', p);
            Sync.enqueueProductUpdate(p);
        });
        this.auditLog('execute_orders', { updated });
        return updated;
    },
    
    // Agregar registro de historial automático (compra/pedido)
    addAutoHistoryRecord: function(recordData) {
        const history = this.getHistory();
        
        const newRecord = {
            id: Date.now().toString(),
            productId: recordData.productId,
            productName: recordData.productName,
            initialStock: parseInt(recordData.initialStock),
            purchase: parseInt(recordData.purchase) || 0,
            finalStock: parseInt(recordData.finalStock),
            consumption: parseInt(recordData.consumption) || 0,
            weekDate: recordData.weekDate,
            actionType: recordData.actionType || 'auto',
            createdAt: new Date().toISOString()
        };
        
        history.push(newRecord);
        this.saveHistory(history);
        this.clearCalculationCache();
        this.auditLog('add_auto_history', { id: newRecord.id, productId: newRecord.productId });
        return { success: true, record: newRecord };
    },
    
    // Categor?as autom?ticas por palabras clave
    getCategoryForName: function(name) {
        const text = String(name || '').toLowerCase();
        const categories = [
            { name: 'VIVERES', keywords: ['harina', 'arroz', 'azucar', 'az?car', 'pasta', 'caraotas', 'aceite', 'sal', 'cafe', 'caf?', 'granos'] },
            { name: 'CARNES', keywords: ['carne', 'pollo', 'res', 'cerdo', 'chuleta', 'jamon', 'jam?n'] },
            { name: 'CERVEZAS', keywords: ['cerveza', 'pilsen', 'lager'] },
            { name: 'REFRESCOS', keywords: ['refresco', 'gaseosa', 'cola', 'soda'] },
            { name: 'HORTALIZAS', keywords: ['tomate', 'lechuga', 'cebolla', 'papa', 'zanahoria', 'ajo'] },
            { name: 'POSTRES', keywords: ['postre', 'torta', 'helado', 'galleta'] },
            { name: 'DESECHABLES', keywords: ['vaso', 'plato', 'servilleta', 'cubierto', 'bolsa', 'envase'] },
            { name: 'LIMPIEZA', keywords: ['jabon', 'jab?n', 'detergente', 'desinfectante', 'limpiador', 'cloro', 'cera', 'cepillo', 'esponja'] },
            { name: 'LICORES', keywords: ['ron', 'vodka', 'whisky', 'tequila', 'licor'] },
            { name: 'CHARCUTERIA', keywords: ['mortadela', 'salchicha', 'jamon', 'jam?n', 'queso', 'tocino'] }
        ];
        
        for (const category of categories) {
            if (category.keywords.some(keyword => text.includes(keyword))) {
                return category.name;
            }
        }
        
        return 'VIVERES';
    },
    
    // Migrar productos antiguos a nuevo esquema
    migrateProducts: function() {
        const products = this.getProducts();
        let changed = false;
        
        const updated = products.map(product => {
            const unit = this.normalizeUnit(product.unit);
            const maxStock = this.normalizeNumber(product.maxStock);
            const category = product.category || this.getCategoryForName(product.name);
            const actionsPending = product.actionsPending || { buy: 0, order: 0 };
            const supplier = product.supplier || '';
            
            if (unit !== product.unit || maxStock !== product.maxStock || category !== product.category || !product.actionsPending || product.supplier === undefined) {
                changed = true;
            }
            
            return {
                ...product,
                unit,
                maxStock,
                category,
                actionsPending,
                supplier
            };
        });
        
        if (changed) {
            this.saveProducts(updated);
        }
    },
    

    // Cache de c?lculos
    calcCache: {
        cache: {},
        get: function(key, ttl = 60000) {
            const item = this.cache[key];
            if (item && (Date.now() - item.timestamp) < ttl) return item.value;
            return null;
        },
        set: function(key, value) {
            this.cache[key] = { value, timestamp: Date.now() };
        },
        clear: function() {
            this.cache = {};
        }
    },

    clearCalculationCache: function() {
        this.calcCache.clear();
    },

    // Tendencia de consumo
    getConsumptionTrend: function(productId, windowSize = 4) {
        const history = this.getHistoryByProduct(productId);
        if (history.length < 2) return { direction: 'flat', delta: 0 };
        
        const recent = history.slice(0, windowSize);
        const previous = history.slice(windowSize, windowSize * 2);
        const avgRecent = recent.length > 0 ? recent.reduce((s, r) => s + (r.consumption || 0), 0) / recent.length : 0;
        const avgPrevious = previous.length > 0 ? previous.reduce((s, r) => s + (r.consumption || 0), 0) / previous.length : avgRecent;
        const delta = avgRecent - avgPrevious;
        
        if (delta > 0.5) return { direction: 'up', delta: delta };
        if (delta < -0.5) return { direction: 'down', delta: delta };
        return { direction: 'flat', delta: delta };
    },

    // Estacionalidad simple
    detectSeasonality: function(productId) {
        const history = this.getHistoryByProduct(productId);
        if (history.length < 4) return { isSeasonal: false, confidence: 0 };
        
        const values = history.slice(0, 8).map(r => r.consumption || 0);
        if (values.length < 4) return { isSeasonal: false, confidence: 0 };
        
        const avg = values.reduce((a, b) => a + b, 0) / values.length;
        const variance = values.reduce((a, b) => a + Math.pow(b - avg, 2), 0) / values.length;
        const std = Math.sqrt(variance);
        const confidence = avg > 0 ? std / avg : 0;
        return { isSeasonal: confidence > 0.3, confidence: confidence };
    },
    
    // Alias en español
    detectarEstacionalidad: function(productId) {
        const res = this.detectSeasonality(productId);
        return {
            tieneEstacionalidad: res.isSeasonal,
            confianza: res.confidence,
            promedio: this.getAverageConsumption(productId),
            desviacion: res.confidence * this.getAverageConsumption(productId)
        };
    },
    
    // Recomendación con ajuste estacional
    getSeasonalRecommendation: function(product) {
        const base = this.calculateAutoRecommendation(product);
        const estacionalidad = this.detectarEstacionalidad(product.id);
        if (estacionalidad.tieneEstacionalidad) {
            const factor = 1 + (estacionalidad.confianza * 0.3);
            return Math.ceil(base * factor);
        }
        return base;
    },

    // Predicci?n de ruptura de stock
    predictStockout: function(product) {
        const avgConsumption = this.getAverageConsumption(product.id);
        if (avgConsumption <= 0) return null;
        const currentStock = this.normalizeNumber(product.currentStock);
        const daily = avgConsumption / 7;
        const daysUntilZero = daily > 0 ? Math.floor(currentStock / daily) : 0;
        const date = new Date(Date.now() + (daysUntilZero * 86400000));
        return {
            days: daysUntilZero,
            date: date.toISOString().split('T')[0],
            critical: daysUntilZero <= 3
        };
    },
    
    // Alias en español
    predecirRoturaStock: function(product) {
        const info = this.predictStockout(product);
        if (!info) {
            return { diasRestantes: Infinity, critico: false, alerta: '✅ Estable' };
        }
        const fecha = new Date(info.date).toLocaleDateString();
        return {
            diasRestantes: info.days,
            fecha: fecha,
            critico: info.critical,
            alerta: info.days < 7 ? '⚠️ Comprar pronto' : '✅ Estable'
        };
    },

    // Auditor?a
    auditLog: function(action, details) {
        const logs = JSON.parse(localStorage.getItem(this.AUDIT_KEY) || '[]');
        logs.push({
            id: this.generateId(),
            timestamp: new Date().toISOString(),
            action,
            details: details || {}
        });
        const trimmed = logs.length > 1000 ? logs.slice(-1000) : logs;
        localStorage.setItem(this.AUDIT_KEY, JSON.stringify(trimmed));
    },

    getAuditLogs: function() {
        const logs = localStorage.getItem(this.AUDIT_KEY);
        return logs ? JSON.parse(logs) : [];
    },

    // Backup autom?tico diario
    autoBackup: function() {
        const lastBackup = localStorage.getItem('smart_inventory_last_backup');
        const now = Date.now();
        if (!lastBackup || (now - parseInt(lastBackup, 10)) > 86400000) {
            const dateKey = new Date().toISOString().slice(0, 10);
            const payload = {
                products: this.getProducts(),
                history: this.getHistory(),
                daily: this.getDailyRecords(),
                createdAt: new Date().toISOString()
            };
            localStorage.setItem(this.BACKUP_PREFIX + dateKey, JSON.stringify(payload));
            localStorage.setItem('smart_inventory_last_backup', String(now));
            this.auditLog('auto_backup', { date: dateKey });
        }
    },

    getLatestBackup: function() {
        const keys = Object.keys(localStorage).filter(k => k.startsWith(this.BACKUP_PREFIX)).sort();
        if (keys.length === 0) return null;
        const latestKey = keys[keys.length - 1];
        try {
            return JSON.parse(localStorage.getItem(latestKey));
        } catch (e) {
            return null;
        }
    },

    restoreFromBackup: function(backup) {
        if (!backup) return false;
        if (backup.products) this.saveProducts(backup.products);
        if (backup.history) this.saveHistory(backup.history);
        if (backup.daily) this.saveDaily(backup.daily);
        this.auditLog('restore_backup', { date: backup.createdAt || '' });
        return true;
    },

    validateDataIntegrity: function() {
        const products = this.getProducts();
        let changed = false;
        const repaired = products.map(p => {
            if (!p.id || !p.name) {
                changed = true;
                return null;
            }
            const fixed = {
                ...p,
                name: this.sanitizeText(p.name),
                currentStock: this.normalizeNumber(p.currentStock),
                minStock: this.normalizeNumber(p.minStock),
                maxStock: this.normalizeNumber(p.maxStock),
                unit: this.normalizeUnit(p.unit),
                category: p.category || this.getCategoryForName(p.name),
                actionsPending: p.actionsPending || { buy: 0, order: 0 },
                supplier: this.sanitizeText(p.supplier || '')
            };
            return fixed;
        }).filter(Boolean);
        
        if (changed) {
            this.saveProducts(repaired);
        }
        return { changed, count: repaired.length };
    },

    // Hash simple para detectar manipulaci?n
    calculateHash: function(text) {
        let hash = 5381;
        for (let i = 0; i < text.length; i++) {
            hash = ((hash << 5) + hash) + text.charCodeAt(i);
            hash = hash & 0xffffffff;
        }
        return String(hash);
    },

    updateProductsHash: function(products) {
        const hash = this.calculateHash(JSON.stringify(products || []));
        localStorage.setItem(this.PRODUCTS_HASH_KEY, hash);
    },

    checkLocalStorageTampering: function() {
        const products = this.getProducts();
        const storedHash = localStorage.getItem(this.PRODUCTS_HASH_KEY);
        const currentHash = this.calculateHash(JSON.stringify(products));
        if (storedHash && storedHash !== currentHash) {
            this.auditLog('tamper_detected', { storedHash, currentHash });
            const backup = this.getLatestBackup();
            if (backup) {
                this.restoreFromBackup(backup);
            }
        }
        this.updateProductsHash(products);
    },

    saveProducts: function(products) {
        localStorage.setItem(this.PRODUCTS_KEY, JSON.stringify(products));
        this.updateProductsHash(products);
        this.clearCalculationCache();
    },

    saveHistory: function(history) {
        localStorage.setItem(this.HISTORY_KEY, JSON.stringify(history));
        this.clearCalculationCache();
    },

    saveDaily: function(daily) {
        localStorage.setItem(this.DAILY_KEY, JSON.stringify(daily));
    },

    async loadFromIndexedDB() {
        try {
            const items = await IDBStore.getAll('products');
            if (!items || items.length === 0) return;
            this.saveProducts(items);
        } catch (e) {
            // Silenciar errores de IDB
        }
    }
};

// Inicializar base de datos al cargar
DB.init();
