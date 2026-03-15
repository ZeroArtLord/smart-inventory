// calculator.js - Cálculos de consumo y predicciones
// Smart Inventory - ByteMind Solutions

const Calculator = {
    // Calcular consumo semanal
    calculateWeeklyConsumption: function(initialStock, purchase, finalStock) {
        return initialStock + purchase - finalStock;
    },
    
    // Calcular consumo promedio de las últimas N semanas
    calculateAverageConsumption: function(historyRecords, weeks = 4) {
        if (!historyRecords || historyRecords.length === 0) {
            return 0;
        }
        
        // Ordenar por fecha (más reciente primero)
        const sortedHistory = [...historyRecords]
            .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
            .slice(0, weeks);
        
        if (sortedHistory.length === 0) {
            return 0;
        }
        
        const totalConsumption = sortedHistory.reduce((sum, record) => {
            return sum + (record.consumption || 0);
        }, 0);
        
        return Math.round(totalConsumption / sortedHistory.length);
    },
    
    // Calcular recomendación de compra
    calculatePurchaseRecommendation: function(product, avgConsumption) {
        if (!product) return 'NO COMPRAR';
        
        const currentStock = product.currentStock || 0;
        const minStock = product.minStock || 0;
        
        // Fórmula: (consumo_promedio + stock_mínimo) - stock_actual
        const needed = (avgConsumption + minStock) - currentStock;
        
        if (needed <= 0) {
            return 'NO COMPRAR';
        }
        
        return `COMPRAR ${Math.max(0, needed)}`;
    },
    
    // Determinar estado del producto
    determineProductStatus: function(product, avgConsumption) {
        if (!product) return { status: 'unknown', icon: '⚫', label: 'Desconocido' };
        
        const currentStock = product.currentStock || 0;
        const minStock = product.minStock || 0;
        
        // Estado crítico: stock actual <= stock mínimo
        if (currentStock <= minStock) {
            return { 
                status: 'critical', 
                icon: '🔴', 
                label: 'Crítico',
                description: 'Stock por debajo del mínimo'
            };
        }
        
        // Estado bajo: stock actual < (consumo_promedio * 1.5)
        if (currentStock < (avgConsumption * 1.5)) {
            return { 
                status: 'low', 
                icon: '🟡', 
                label: 'Bajo',
                description: 'Stock por debajo del nivel seguro'
            };
        }
        
        // Estado bueno: stock actual >= (consumo_promedio * 1.5)
        return { 
            status: 'good', 
            icon: '🟢', 
            label: 'Bueno',
            description: 'Stock en nivel seguro'
        };
    },
    
    // Calcular fecha de la semana actual en formato YYYY-Www
    getCurrentWeek: function() {
        const now = new Date();
        const target = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
        const dayNr = (target.getUTCDay() + 6) % 7;
        target.setUTCDate(target.getUTCDate() - dayNr + 3);
        const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
        const week = 1 + Math.round((target - firstThursday) / (7 * 24 * 60 * 60 * 1000));
        const year = target.getUTCFullYear();
        
        return `${year}-W${week.toString().padStart(2, '0')}`;
    },
    
    // Formatear fecha de semana para mostrar
    formatWeekDisplay: function(weekString) {
        if (!weekString) return 'Semana no especificada';
        
        const [year, week] = weekString.split('-W');
        if (!year || !week) return weekString;
        
        // Calcular fecha aproximada del lunes de esa semana
        const firstDayOfYear = new Date(year, 0, 1);
        const daysToAdd = (week - 1) * 7;
        const mondayDate = new Date(firstDayOfYear);
        mondayDate.setDate(firstDayOfYear.getDate() + daysToAdd - firstDayOfYear.getDay() + 1);
        
        const options = { month: 'long', day: 'numeric' };
        const monthDay = mondayDate.toLocaleDateString('es-ES', options);
        
        return `Semana ${week} (${monthDay})`;
    },
    
    // Calcular proyección de stock
    calculateStockProjection: function(product, weeksAhead = 4) {
        if (!product) return [];
        
        const avgConsumption = DB.getAverageConsumption(product.id);
        const projection = [];
        let currentStock = product.currentStock || 0;
        
        for (let i = 1; i <= weeksAhead; i++) {
            currentStock = Math.max(0, currentStock - avgConsumption);
            projection.push({
                week: i,
                projectedStock: currentStock,
                status: currentStock <= product.minStock ? 'critical' : 
                       currentStock < (avgConsumption * 1.5) ? 'low' : 'good'
            });
        }
        
        return projection;
    },
    
    // Calcular punto de reorden
    calculateReorderPoint: function(product) {
        if (!product) return 0;
        
        const avgConsumption = DB.getAverageConsumption(product.id);
        const leadTimeWeeks = 1; // Supuesto: 1 semana de tiempo de entrega
        const safetyStock = avgConsumption * 0.5; // Stock de seguridad (50% del consumo semanal)
        
        return Math.round((avgConsumption * leadTimeWeeks) + safetyStock);
    },
    
    // Validar datos de entrada
    validateInput: function(data, type) {
        const errors = [];
        
        switch(type) {
            case 'product':
                if (!data.name || data.name.trim() === '') {
                    errors.push('El nombre del producto es requerido');
                }
                if (data.currentStock < 0) {
                    errors.push('El stock actual no puede ser negativo');
                }
                if (data.minStock < 0) {
                    errors.push('El stock mínimo no puede ser negativo');
                }
                if (data.maxStock < 0) {
                    errors.push('El stock máximo no puede ser negativo');
                }
                if (data.maxStock > 0 && data.maxStock < data.minStock) {
                    errors.push('El stock máximo no puede ser menor al stock mínimo');
                }
                break;
                
            case 'weekly':
                if (!data.productId) {
                    errors.push('Debe seleccionar un producto');
                }
                if (data.initialStock < 0) {
                    errors.push('El stock inicial no puede ser negativo');
                }
                if (data.purchase < 0) {
                    errors.push('La compra no puede ser negativa');
                }
                if (data.finalStock < 0) {
                    errors.push('El stock final no puede ser negativo');
                }
                if (data.initialStock + data.purchase < data.finalStock) {
                    errors.push('El stock final no puede ser mayor al stock inicial + compras');
                }
                break;
                
            case 'weekly_simple':
                if (!data.productId) {
                    errors.push('Debe seleccionar un producto');
                }
                if (data.currentStock < 0) {
                    errors.push('El stock actual no puede ser negativo');
                }
                break;
        }
        
        return {
            isValid: errors.length === 0,
            errors: errors
        };
    }
};
