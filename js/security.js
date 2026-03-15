// security.js - Funciones de seguridad y utilidades
// ByteMind Solutions

const Security = {
    sanitizeInput: function(input) {
        if (typeof input !== 'string') return input;
        const div = document.createElement('div');
        div.textContent = input;
        return div.innerHTML;
    },

    validateProductId: function(id) {
        return /^[a-zA-Z0-9_-]+$/.test(String(id));
    },

    actionCount: 0,
    lastActionTime: Date.now(),
    checkRateLimit: function(limit = 100, timeWindow = 60000) {
        const now = Date.now();
        if (now - this.lastActionTime > timeWindow) {
            this.actionCount = 0;
            this.lastActionTime = now;
        }
        this.actionCount++;
        if (this.actionCount > limit) {
            if (window.App && App.showToast) {
                App.showToast('Demasiadas acciones. Espere un momento.', 'warning');
            }
            return false;
        }
        return true;
    },

    createBackup: function() {
        const data = {
            products: DB.getProducts(),
            history: DB.getHistory(),
            daily: DB.getDailyRecords(),
            date: new Date().toISOString(),
            version: '2.0'
        };
        const backupKey = `backup_${new Date().toISOString().slice(0, 10)}`;
        localStorage.setItem(backupKey, JSON.stringify(data));
        localStorage.setItem('last_backup', Date.now().toString());
        return backupKey;
    },

    checkAndBackup: function() {
        const lastBackup = localStorage.getItem('last_backup');
        const now = Date.now();
        if (!lastBackup || now - parseInt(lastBackup, 10) > 86400000) {
            return this.createBackup();
        }
        return null;
    },

    validateDataIntegrity: function() {
        const products = DB.getProducts();
        let corrupted = [];
        
        for (const p of products) {
            if (!p.id || !p.name || typeof p.currentStock !== 'number') {
                corrupted.push(p);
            }
        }
        
        if (corrupted.length > 0) {
            console.warn('Productos corruptos:', corrupted);
            return false;
        }
        return true;
    },

    calculateHash: function(data) {
        const str = JSON.stringify(data);
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash |= 0;
        }
        return hash.toString();
    },

    verifyProductsHash: function() {
        const products = DB.getProducts();
        const currentHash = this.calculateHash(products);
        const storedHash = localStorage.getItem('products_hash');
        
        if (storedHash && currentHash !== storedHash) {
            if (window.App && App.showToast) {
                App.showToast('Posible manipulación de datos', 'error');
            }
            return false;
        }
        
        localStorage.setItem('products_hash', currentHash);
        return true;
    },

    checkStorageLimit: function() {
        let totalSize = 0;
        for (const key in localStorage) {
            if (Object.prototype.hasOwnProperty.call(localStorage, key)) {
                totalSize += (localStorage[key].length * 2);
            }
        }
        const limit = 4.5 * 1024 * 1024;
        
        if (totalSize > limit) {
            if (window.App && App.showToast) {
                App.showToast('Almacenamiento casi lleno. Exporte datos.', 'warning');
            }
            return false;
        }
        return true;
    },

    auditLog: function(accion, detalles) {
        const log = {
            timestamp: new Date().toISOString(),
            accion: accion,
            detalles: detalles,
            userAgent: navigator.userAgent
        };
        
        let logs = JSON.parse(localStorage.getItem('audit_logs') || '[]');
        logs.push(log);
        
        if (logs.length > 500) logs = logs.slice(-500);
        
        localStorage.setItem('audit_logs', JSON.stringify(logs));
    },

    exportAuditLogs: function() {
        const logs = localStorage.getItem('audit_logs');
        if (!logs) {
            if (window.App && App.showToast) {
                App.showToast('No hay logs para exportar', 'info');
            }
            return;
        }
        
        const blob = new Blob([logs], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `audit_logs_${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
    },

    restoreFromBackup: function(backupDate) {
        const backupKey = `backup_${backupDate}`;
        const backup = localStorage.getItem(backupKey);
        if (!backup) {
            if (window.App && App.showToast) {
                App.showToast('Backup no encontrado', 'error');
            }
            return false;
        }
        
        try {
            const data = JSON.parse(backup);
            localStorage.setItem(DB.PRODUCTS_KEY, JSON.stringify(data.products || []));
            localStorage.setItem(DB.HISTORY_KEY, JSON.stringify(data.history || []));
            localStorage.setItem(DB.DAILY_KEY, JSON.stringify(data.daily || []));
            if (window.App && App.showToast) {
                App.showToast('Backup restaurado', 'success');
            }
            return true;
        } catch (e) {
            if (window.App && App.showToast) {
                App.showToast('Error al restaurar backup', 'error');
            }
            return false;
        }
    }
};
