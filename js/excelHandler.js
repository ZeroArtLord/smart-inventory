// excelHandler.js - Manejo de importación/exportación Excel
// Smart Inventory - ByteMind Solutions

const ExcelHandler = {
    // Importar archivo Excel
    importExcelFile: function(file) {
        return new Promise((resolve, reject) => {
            if (!file) {
                reject('No se seleccionó ningún archivo');
                return;
            }
            
            const reader = new FileReader();
            
            reader.onload = function(e) {
                try {
                    const data = new Uint8Array(e.target.result);
                    const workbook = XLSX.read(data, { type: 'array' });
                    
                    // Obtener la primera hoja
                    const firstSheetName = workbook.SheetNames[0];
                    const worksheet = workbook.Sheets[firstSheetName];
                    
                    // Convertir a JSON
                    const jsonData = XLSX.utils.sheet_to_json(worksheet, {
                        header: 1,
                        defval: ''
                    });
                    
                    // Procesar los datos
                    const result = ExcelHandler.processImportData(jsonData);
                    resolve(result);
                } catch (error) {
                    reject('Error al procesar el archivo: ' + error.message);
                }
            };
            
            reader.onerror = function() {
                reject('Error al leer el archivo');
            };
            
            reader.readAsArrayBuffer(file);
        });
    },
    
    // Procesar datos importados
    processImportData: function(data) {
        if (!data || data.length < 2) {
            return {
                success: false,
                message: 'El archivo está vacío o no tiene datos válidos'
            };
        }
        
        const results = {
            total: 0,
            new: 0,
            updated: 0,
            errors: [],
            products: []
        };
        
        // Asumir que la primera fila son encabezados
        // Buscar índices de columnas
        let nameIndex = 0; // Columna A por defecto
        let minStockIndex = 1; // Columna B por defecto
        let maxStockIndex = 2; // Columna C por defecto
        let stockIndex = 3; // Columna D por defecto
        let categoryIndex = 4; // Columna E por defecto
        
        // Intentar detectar encabezados
        const headers = data[0] || [];
        let hasHeader = false;
        if (headers && headers.length > 0) {
            headers.forEach((header, index) => {
                let headerStr = String(header).trim().toLowerCase();
                if (headerStr.normalize) {
                    headerStr = headerStr.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
                }
                
                if (headerStr.includes('producto') || headerStr.includes('nombre')) {
                    nameIndex = index;
                    hasHeader = true;
                } else if (headerStr.includes('minimo') || headerStr.includes('mínimo')) {
                    minStockIndex = index;
                    hasHeader = true;
                } else if (headerStr.includes('maximo') || headerStr.includes('máximo')) {
                    maxStockIndex = index;
                    hasHeader = true;
                } else if (headerStr.includes('existencia') || (headerStr.includes('stock') && headerStr.includes('actual'))) {
                    stockIndex = index;
                    hasHeader = true;
                } else if (headerStr.includes('categoria') || headerStr.includes('categoría')) {
                    categoryIndex = index;
                    hasHeader = true;
                }
            });
        }
        
        // Procesar filas de datos (empezando desde la fila 1 si hay encabezados)
        const startRow = hasHeader ? 1 : 0;
        
        for (let i = startRow; i < data.length; i++) {
            const row = data[i];
            
            // Saltar filas vacías
            if (!row || row.length === 0 || (row[nameIndex] === '' && row[stockIndex] === '')) {
                continue;
            }
            
            const productName = String(row[nameIndex] || '').trim();
            
            if (!productName) {
                results.errors.push(`Fila ${i + 1}: Nombre de producto vacío`);
                continue;
            }
            
            const parsedMin = ExcelHandler.parseQuantityUnit(row[minStockIndex]);
            const parsedMax = ExcelHandler.parseQuantityUnit(row[maxStockIndex]);
            const parsedStock = ExcelHandler.parseQuantityUnit(row[stockIndex]);
            
            const unit = ExcelHandler.detectUnit(productName, row[minStockIndex], row[maxStockIndex], row[stockIndex], [
                parsedMin.unit, parsedMax.unit, parsedStock.unit
            ]);
            const currentStock = parsedStock.value;
            const minStock = parsedMin.value;
            const maxStock = parsedMax.value;
            const category = String(row[categoryIndex] || '').trim();
            
            // Buscar si el producto ya existe
            const existingProduct = DB.findProductByName(productName);
            
            if (existingProduct) {
                // Actualizar producto existente
                const updateResult = DB.updateProduct(existingProduct.id, {
                    currentStock: currentStock,
                    minStock: minStock,
                    maxStock: maxStock,
                    unit: existingProduct.unit || unit,
                    category: category || existingProduct.category
                });
                
                if (updateResult.success) {
                    results.updated++;
                    results.products.push({
                        name: productName,
                        action: 'updated',
                        oldStock: existingProduct.currentStock,
                        newStock: currentStock
                    });
                } else {
                    results.errors.push(`Fila ${i + 1}: ${updateResult.message}`);
                }
            } else {
                // Crear nuevo producto
                const addResult = DB.addProduct({
                    name: productName,
                    currentStock: currentStock,
                    minStock: minStock,
                    maxStock: maxStock,
                    unit: unit,
                    category: category
                });
                
                if (addResult.success) {
                    results.new++;
                    results.products.push({
                        name: productName,
                        action: 'added',
                        stock: currentStock
                    });
                } else {
                    results.errors.push(`Fila ${i + 1}: ${addResult.message}`);
                }
            }
            
            results.total++;
        }
        
        return {
            success: results.total > 0,
            message: `Se procesaron ${results.total} productos: ${results.new} nuevos, ${results.updated} actualizados`,
            details: results
        };
    },
    
    // Exportar a Excel
    exportToExcel: function() {
        const products = DB.getProducts();
        const history = DB.getHistory();
        
        if (products.length === 0) {
            alert('No hay productos para exportar');
            return;
        }
        
        // Preparar datos para exportación
        const exportData = [];
        
        // Encabezados
        exportData.push([
            'Producto',
            'Categoría',
            'Stock Actual',
            'Stock Mínimo',
            'Stock Máximo',
            'Unidad',
            'Consumo Promedio (4 semanas)',
            'Recomendación de Compra',
            'Estado',
            'Última Actualización'
        ]);
        
        // Datos de productos
        products.forEach(product => {
            const avgConsumption = DB.getAverageConsumption(product.id);
            const recommendation = DB.getPurchaseRecommendation(product);
            const status = DB.getProductStatus(product);
            
            // Obtener historial reciente (últimas 4 semanas)
            const recentHistory = history
                .filter(h => h.productId === product.id)
                .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
                .slice(0, 4);
            
            exportData.push([
                product.name,
                product.category || 'OTROS',
                product.currentStock,
                product.minStock,
                product.maxStock || 0,
                product.unit || 'UND',
                avgConsumption,
                recommendation,
                status.label,
                new Date(product.updatedAt).toLocaleDateString('es-ES')
            ]);
            
            // Agregar historial si existe
            if (recentHistory.length > 0) {
                exportData.push(['', 'Historial de las últimas 4 semanas:', '', '', '', '', '', '', '', '', '']);
                exportData.push(['Semana', 'Stock Inicial', 'Compra', 'Stock Final', 'Consumo', '', '', '', '', '', '']);
                
                recentHistory.forEach(record => {
                    exportData.push([
                        Calculator.formatWeekDisplay(record.weekDate),
                        record.initialStock,
                        record.purchase,
                        record.finalStock,
                        record.consumption,
                        '',
                        '',
                        '',
                        '',
                        '',
                        ''
                    ]);
                });
                
                exportData.push(['', '', '', '', '', '', '', '', '', '', '']); // Línea en blanco
            }
        });
        
        // Crear libro de trabajo
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.aoa_to_sheet(exportData);
        
        // Establecer anchos de columna
        const colWidths = [
            { wch: 30 }, // Producto
            { wch: 18 }, // Categoría
            { wch: 15 }, // Stock Actual
            { wch: 15 }, // Stock Mínimo
            { wch: 15 }, // Stock Máximo
            { wch: 10 }, // Unidad
            { wch: 25 }, // Consumo Promedio
            { wch: 25 }, // Recomendación
            { wch: 15 }, // Estado
            { wch: 20 }  // Última Actualización
        ];
        ws['!cols'] = colWidths;
        
        // Agregar hoja al libro
        XLSX.utils.book_append_sheet(wb, ws, 'Inventario');
        
        // Generar archivo y descargar
        const fileName = `SmartInventory_Export_${new Date().toISOString().slice(0, 10)}.xlsx`;
        XLSX.writeFile(wb, fileName);
        
        return {
            success: true,
            fileName: fileName,
            productsExported: products.length
        };
    },
    
    // Exportar reporte diario de compras/pedidos
    exportDailyReport: function(dateStr) {
        const products = DB.getProducts();
        const date = dateStr || new Date().toISOString().split('T')[0];
        
        const buyRows = [
            ['Producto', 'Cantidad', 'Unidad', 'Estado']
        ];
        const orderRows = [
            ['Producto', 'Cantidad', 'Unidad', 'Proveedor']
        ];
        
        products.forEach(p => {
            const unit = DB.normalizeUnit(p.unit);
            const status = DB.getProductStatus(p);
            
            if ((p.actionsPending?.buy || 0) > 0) {
                buyRows.push([
                    p.name,
                    DB.formatNumber(p.actionsPending.buy),
                    unit,
                    status.label
                ]);
            }
            
            if ((p.actionsPending?.order || 0) > 0) {
                orderRows.push([
                    p.name,
                    DB.formatNumber(p.actionsPending.order),
                    unit,
                    p.supplier || ''
                ]);
            }
        });
        
        const wb = XLSX.utils.book_new();
        const wsBuy = XLSX.utils.aoa_to_sheet(buyRows);
        const wsOrder = XLSX.utils.aoa_to_sheet(orderRows);
        
        XLSX.utils.book_append_sheet(wb, wsBuy, 'Compras');
        XLSX.utils.book_append_sheet(wb, wsOrder, 'Pedidos');
        
        const fileName = `SmartInventory_Reporte_${date}.xlsx`;
        XLSX.writeFile(wb, fileName);
        
        return { success: true, fileName };
    },
    
    // Generar plantilla de importación
    generateImportTemplate: function() {
        const templateData = [
            ['Producto', 'Mínimo', 'Máximo', 'Existencia', 'Categoría'],
            ['CLORO LT', '10LT', '30LT', '15', 'LIMPIEZA'],
            ['JABON EN POLVO KG', '8KG', '24KG', '7', 'LIMPIEZA'],
            ['SERVILLETAS', '5 BULTOS', '10 BULTOS', '3', 'DESECHABLES'],
            ['', '', '', '', ''],
            ['INSTRUCCIONES:', '', '', '', ''],
            ['1. Complete los datos en las columnas indicadas', '', '', '', ''],
            ['2. La columna A debe contener el nombre del producto', '', '', '', ''],
            ['3. Puede incluir unidades en Mínimo/Máximo (ej: 10LT, 5 BULTOS)', '', '', '', ''],
            ['4. Si no hay unidad, se asume UND', '', '', '', ''],
            ['5. Categoría va en la columna E', '', '', '', '']
        ];
        
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.aoa_to_sheet(templateData);
        
        // Establecer anchos de columna
        ws['!cols'] = [
            { wch: 30 },
            { wch: 15 },
            { wch: 15 },
            { wch: 15 },
            { wch: 18 }
        ];
        
        XLSX.utils.book_append_sheet(wb, ws, 'Plantilla');
        
        const fileName = 'Plantilla_Importacion_SmartInventory.xlsx';
        XLSX.writeFile(wb, fileName);
        
        return {
            success: true,
            fileName: fileName
        };
    },
    
    // Validar archivo antes de importar
    validateFile: function(file) {
        const validExtensions = ['.xlsx', '.xls', '.csv'];
        const maxSize = 5 * 1024 * 1024; // 5MB
        
        if (!file) {
            return { valid: false, message: 'No se seleccionó ningún archivo' };
        }
        
        // Validar extensión
        const fileName = file.name.toLowerCase();
        const hasValidExtension = validExtensions.some(ext => fileName.endsWith(ext));
        
        if (!hasValidExtension) {
            return { 
                valid: false, 
                message: 'Formato de archivo no válido. Use .xlsx, .xls o .csv' 
            };
        }
        
        // Validar tamaño
        if (file.size > maxSize) {
            return { 
                valid: false, 
                message: 'El archivo es demasiado grande. Máximo 5MB' 
            };
        }
        
        return { valid: true, message: 'Archivo válido' };
    },
    
    // Parsear cantidad y unidad desde una celda
    parseQuantityUnit: function(rawValue) {
        if (rawValue === null || rawValue === undefined || rawValue === '') {
            return { value: 0, unit: '' };
        }
        
        const str = String(rawValue).trim();
        if (str === '') return { value: 0, unit: '' };
        
        // Si es solo número
        if (/^-?\d+([.,]\d+)?$/.test(str)) {
            return { value: parseFloat(str.replace(',', '.')), unit: '' };
        }
        
        // Intentar patrón número + unidad
        const match = /^(-?\d+(?:[.,]\d+)?)\s*([a-zA-Z]+)?$/i.exec(str.replace(/\s+/g, ' '));
        if (match) {
            const value = parseFloat(match[1].replace(',', '.'));
            const unit = match[2] ? match[2].toUpperCase() : '';
            return { value: Number.isNaN(value) ? 0 : value, unit: unit };
        }
        
        return { value: 0, unit: '' };
    },
    
    // Resolver unidad final entre mínimo/máximo/existencia
    resolveUnit: function(unitA, unitB, unitC) {
        const u = (unitA || unitB || unitC || 'UND').toString().trim().toUpperCase();
        return u || 'UND';
    },
    
    // Detectar unidad automáticamente
    detectUnit: function(name, minRaw, maxRaw, stockRaw, unitsFound = []) {
        const text = String(name || '').toLowerCase();
        
        // Prioridad 1: nombre del producto
        if (text.includes(' litro') || text.includes(' lt') || text.includes('lts') || text.includes('litro')) return 'LT';
        if (text.includes(' kilo') || text.includes(' kg') || text.includes('kgs') || text.includes('kilo')) return 'KG';
        if (text.includes(' caja')) return 'CAJA';
        if (text.includes(' bulto')) return 'BULTOS';
        if (text.includes(' galón') || text.includes(' galon') || text.includes(' gal')) return 'GALÓN';
        if (text.includes(' unidad') || text.includes(' und')) return 'UND';
        
        // Prioridad 2: unidades detectadas en celdas
        const fromCells = unitsFound.find(u => u && u.trim());
        if (fromCells) return fromCells.toUpperCase();
        
        // Prioridad 3: extraer de textos crudos
        const rawCandidates = [minRaw, maxRaw, stockRaw].map(v => String(v || '').replace(/[0-9\s.,]/g, '').trim());
        const rawUnit = rawCandidates.find(u => u);
        if (rawUnit) return rawUnit.toUpperCase();
        
        return 'UND';
    }
};
