// app.js - Aplicación principal de Smart Inventory
// ByteMind Solutions

const App = {
    checklistSaveTimers: {},
    checklistPageSize: 50,
    checklistOffset: 0,
    currentChecklistCategory: 'ALL',
    currentChecklistSearch: '',
    checklistQuickReview: false,
    checklistProgress: new Set(),
    selectedProductIds: new Set(),
    sortState: {},
    comparisonEnabled: false,
    rateLimit: {
        count: 0,
        lastTime: Date.now()
    },
    calculationCache: {
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
    // Inicialización
    init: function() {
        if (window.Security) {
            Security.checkAndBackup();
            Security.validateDataIntegrity();
            Security.verifyProductsHash();
            Security.checkStorageLimit();
        }
        this.cargarEventos();
        this.actualizarDashboard();
        this.cargarSelectores();
        this.cargarSemanaActual();
        this.loadChecklistProgress();
        this.cargarChecklist();
        this.cargarPredicciones();
        this.cargarAlertas();
        this.setupAutoSave();
        this.initNightMode();
        this.initKeyboardShortcuts();
        this.initInactivityMonitor();
        this.checkStorageLimit();
        DB.autoBackup();
    },

    // Cargar todos los eventos
    cargarEventos: function() {
        // Navegación
        document.querySelectorAll('.nav-btn').forEach(btn => {
            btn.addEventListener('click', (e) => this.cambiarSeccion(e));
        });
        
        // Menú hamburguesa
        document.getElementById('menuToggle').addEventListener('click', () => {
            document.getElementById('navMenu').classList.toggle('active');
        });

        // Botones Excel
        document.getElementById('importExcel').addEventListener('click', () => {
            document.getElementById('excelFile').click();
        });
        
        document.getElementById('excelFile').addEventListener('change', (e) => {
            this.manejarImportacion(e);
        });
        
        document.getElementById('exportExcel').addEventListener('click', () => {
            ExcelHandler.exportToExcel();
        });

        // Actualizar categoría automática en formulario
        document.getElementById('productName').addEventListener('input', (e) => {
            const categorySelect = document.getElementById('category');
            if (!categorySelect) return;
            if (categorySelect.dataset.manual === '1') return;
            const category = DB.getCategoryForName(e.target.value);
            categorySelect.value = category;
        });

        const categorySelect = document.getElementById('category');
        if (categorySelect) {
            categorySelect.addEventListener('change', () => {
                categorySelect.dataset.manual = '1';
            });
        }

        // Formulario productos
        document.getElementById('addProductBtn').addEventListener('click', () => {
            this.mostrarFormularioProducto();
        });
        
        document.getElementById('cancelForm').addEventListener('click', () => {
            this.ocultarFormularioProducto();
        });
        
        document.getElementById('productForm').addEventListener('submit', (e) => {
            e.preventDefault();
            this.guardarProducto();
        });

        // Registro semanal
        document.getElementById('calculateConsumption').addEventListener('click', () => {
            this.calcularConsumoSemanal();
        });
        
        document.getElementById('weeklyForm').addEventListener('submit', (e) => {
            e.preventDefault();
            this.guardarRegistroSemanal();
        });
        
        document.getElementById('registerProduct').addEventListener('change', () => {
            this.actualizarUnidadRegistro();
        });

        // Selector historial
        document.getElementById('historyProduct').addEventListener('change', () => {
            this.cargarHistorial();
        });

        // Modales
        document.getElementById('modalCancel').addEventListener('click', () => {
            this.cerrarModal('confirmModal');
        });
        
        document.getElementById('modalConfirm').addEventListener('click', () => {
            if (this.productoAEliminar) {
                DB.deleteProduct(this.productoAEliminar);
                this.productoAEliminar = null;
                this.cerrarModal('confirmModal');
                this.actualizarDashboard();
                this.cargarSelectores();
            }
        });
        
        document.getElementById('closeImportModal').addEventListener('click', () => {
            this.cerrarModal('importModal');
        });
        
        // Checklist filters
        document.querySelectorAll('.filter-btn').forEach(btn => {
            btn.addEventListener('click', (e) => this.filtrarChecklist(e));
        });
        
        const checklistSearch = document.getElementById('checklistSearch');
        if (checklistSearch) {
            checklistSearch.addEventListener('input', (e) => {
                this.currentChecklistSearch = e.target.value || '';
                this.cargarChecklist(this.currentChecklistCategory);
            });
        }
        
        // Summary modal
        document.getElementById('openSummary').addEventListener('click', () => {
            this.mostrarResumenDia();
        });
        document.getElementById('floatingSummary').addEventListener('click', () => {
            this.mostrarResumenDia();
        });
        document.getElementById('closeSummaryModal').addEventListener('click', () => {
            this.cerrarModal('summaryModal');
        });
        document.getElementById('executePurchases').addEventListener('click', () => {
            this.ejecutarCompras();
        });
        document.getElementById('executeOrders').addEventListener('click', () => {
            this.ejecutarPedidos();
        });
        document.getElementById('exportDailyReport').addEventListener('click', () => {
            ExcelHandler.exportDailyReport(this.getTodayDate());
        });
        const exportAuditBtn = document.getElementById('exportAuditLogs');
        if (exportAuditBtn) {
            exportAuditBtn.addEventListener('click', () => this.exportAuditLogs());
        }
        const restoreBackupBtn = document.getElementById('restoreLatestBackup');
        if (restoreBackupBtn) {
            restoreBackupBtn.addEventListener('click', () => this.restoreLatestBackup());
        }

        // Target days controls
        const targetInput = document.getElementById('targetDays');
        if (targetInput) {
            targetInput.value = DB.getTargetDays();
            targetInput.addEventListener('change', () => {
                DB.setTargetDays(targetInput.value);
                this.cargarChecklist();
                this.cargarPredicciones();
            });
        }
        
        document.querySelectorAll('.target-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const days = parseInt(e.target.dataset.days, 10);
                if (!Number.isNaN(days)) {
                    DB.setTargetDays(days);
                    if (targetInput) targetInput.value = days;
                    this.cargarChecklist();
                    this.cargarPredicciones();
                }
            });
        });
        
        const loadMoreBtn = document.getElementById('loadMoreChecklist');
        if (loadMoreBtn) {
            loadMoreBtn.addEventListener('click', () => this.cargarChecklist(this.currentChecklistCategory, true));
        }
        
        const toggleComparison = document.getElementById('toggleComparison');
        if (toggleComparison) {
            toggleComparison.addEventListener('click', () => {
                this.comparisonEnabled = !this.comparisonEnabled;
                toggleComparison.classList.toggle('active', this.comparisonEnabled);
                this.cargarChecklist(this.currentChecklistCategory);
            });
        }

        const toggleQuickReview = document.getElementById('toggleQuickReview');
        if (toggleQuickReview) {
            toggleQuickReview.addEventListener('click', () => {
                this.checklistQuickReview = !this.checklistQuickReview;
                toggleQuickReview.classList.toggle('active', this.checklistQuickReview);
                this.cargarChecklist(this.currentChecklistCategory);
            });
        }

        const toggleTheme = document.getElementById('toggleTheme');
        if (toggleTheme) {
            toggleTheme.addEventListener('click', () => {
                const enabled = !document.body.classList.contains('night-mode');
                this.setNightMode(enabled);
            });
        }

        // Dashboard filters
        const dashboardCat = document.getElementById('dashboardCategoryFilter');
        const dashboardSearch = document.getElementById('dashboardSearch');
        if (dashboardCat) {
            dashboardCat.addEventListener('change', () => this.filtrarDashboard());
        }
        if (dashboardSearch) {
            dashboardSearch.addEventListener('input', () => this.filtrarDashboard());
        }

        // Products filters
        const productsCat = document.getElementById('productsCategoryFilter');
        const productsSearch = document.getElementById('productsSearch');
        if (productsCat) {
            productsCat.addEventListener('change', () => this.filtrarProductos());
        }
        if (productsSearch) {
            productsSearch.addEventListener('input', () => this.filtrarProductos());
        }

        const resetDashboardFilters = document.getElementById('resetDashboardFilters');
        if (resetDashboardFilters) {
            resetDashboardFilters.addEventListener('click', () => this.resetFiltrosDashboard());
        }

        const resetProductsFilters = document.getElementById('resetProductsFilters');
        if (resetProductsFilters) {
            resetProductsFilters.addEventListener('click', () => this.resetFiltrosProductos());
        }

        const exportHistory = document.getElementById('exportHistory');
        if (exportHistory) {
            exportHistory.addEventListener('click', () => this.exportHistory());
        }

        const selectAll = document.getElementById('selectAllProducts');
        if (selectAll) {
            selectAll.addEventListener('change', (e) => this.toggleSelectAll(e.target.checked));
        }

        const bulkEditBtn = document.getElementById('bulkEditBtn');
        if (bulkEditBtn) {
            bulkEditBtn.addEventListener('click', () => this.openBulkEditModal());
        }

        const cancelBulkEdit = document.getElementById('cancelBulkEdit');
        if (cancelBulkEdit) {
            cancelBulkEdit.addEventListener('click', () => this.cerrarModal('bulkEditModal'));
        }

        const applyBulkEdit = document.getElementById('applyBulkEdit');
        if (applyBulkEdit) {
            applyBulkEdit.addEventListener('click', () => this.applyBulkEdit());
        }

        this.initSortableTables();
    },

    // Cambiar entre secciones
    cambiarSeccion: function(e) {
        document.querySelectorAll('.nav-btn').forEach(btn => {
            btn.classList.remove('active');
        });
        e.target.closest('.nav-btn').classList.add('active');
        
        const seccion = e.target.closest('.nav-btn').dataset.section;
        document.querySelectorAll('.section').forEach(s => {
            s.classList.remove('active');
        });
        document.getElementById(seccion).classList.add('active');
        
        document.getElementById('navMenu').classList.remove('active');
        
        if (seccion === 'dashboard') {
            this.actualizarDashboard();
            this.filtrarDashboard();
        }
        if (seccion === 'checklist') this.cargarChecklist(this.currentChecklistCategory);
        if (seccion === 'products') {
            this.cargarListaProductos();
            this.filtrarProductos();
        }
        if (seccion === 'history') this.cargarSelectores();
    },

    // Actualizar dashboard
    actualizarDashboard: function() {
        const stats = DB.getStatistics();
        
        document.getElementById('totalProducts').textContent = stats.total;
        document.getElementById('goodProducts').textContent = stats.good;
        document.getElementById('lowProducts').textContent = stats.low;
        document.getElementById('criticalProducts').textContent = stats.critical;
        
        this.cargarTablaDashboard();
        this.cargarPredicciones();
        this.cargarAlertas();
        this.renderPredictionChart();
    },
    
    // Crear celda con texto seguro
    crearCeldaTexto: function(texto) {
        const td = document.createElement('td');
        td.textContent = texto;
        return td;
    },
    
    // Crear celda de estado
    crearCeldaEstado: function(estado) {
        const td = document.createElement('td');
        const span = document.createElement('span');
        span.className = `status-badge status-${estado.status}`;
        span.textContent = `${estado.icon} ${estado.label}`;
        td.appendChild(span);
        return td;
    },
    
    // Crear botón con ícono
    crearBotonAccion: function(className, iconClass, onClick) {
        const btn = document.createElement('button');
        btn.className = className;
        const icon = document.createElement('i');
        icon.className = iconClass;
        btn.appendChild(icon);
        btn.addEventListener('click', onClick);
        return btn;
    },
    
    // Crear celda de acciones para productos
    crearCeldaAccionesProducto: function(productId) {
        const td = document.createElement('td');
        const editBtn = this.crearBotonAccion(
            'btn btn-secondary btn-sm',
            'fas fa-edit',
            () => this.editarProducto(productId)
        );
        const dupBtn = this.crearBotonAccion(
            'btn btn-secondary btn-sm',
            'fas fa-copy',
            () => this.duplicarProducto(productId)
        );
        const deleteBtn = this.crearBotonAccion(
            'btn btn-danger btn-sm',
            'fas fa-trash',
            () => this.confirmarEliminar(productId)
        );
        
        td.appendChild(editBtn);
        td.appendChild(dupBtn);
        td.appendChild(deleteBtn);
        return td;
    },
    
    // Crear fila para el dashboard
    crearFilaProductoDashboard: function(prod) {
        const avgConsumption = DB.getAverageConsumption(prod.id);
        const recomendacion = DB.getPurchaseRecommendation(prod);
        const estado = DB.getProductStatus(prod);
        const unit = DB.normalizeUnit(prod.unit);
        
        const fila = document.createElement('tr');
        fila.appendChild(this.crearCeldaTexto(prod.name));
        fila.appendChild(this.crearCeldaTexto(DB.formatQuantity(prod.currentStock, unit)));
        fila.appendChild(this.crearCeldaTexto(DB.formatQuantity(prod.minStock, unit)));
        fila.appendChild(this.crearCeldaTexto(DB.formatQuantity(prod.maxStock || 0, unit)));
        fila.appendChild(this.crearCeldaTexto(unit));
        fila.appendChild(this.crearCeldaTexto(DB.formatQuantity(avgConsumption, unit)));
        fila.appendChild(this.crearCeldaTexto(recomendacion));
        fila.appendChild(this.crearCeldaEstado(estado));
        fila.appendChild(this.crearCeldaTexto(prod.category || 'OTROS'));
        fila.appendChild(this.crearCeldaAccionesProducto(prod.id));
        
        return fila;
    },
    
    // Crear fila para la lista de productos
    crearFilaProductoLista: function(prod) {
        const estado = DB.getProductStatus(prod);
        const unit = DB.normalizeUnit(prod.unit);
        
        const fila = document.createElement('tr');
        const selectTd = document.createElement('td');
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'product-select';
        checkbox.value = prod.id;
        checkbox.checked = this.selectedProductIds.has(prod.id);
        selectTd.appendChild(checkbox);
        fila.appendChild(selectTd);
        fila.appendChild(this.crearCeldaTexto(prod.name));
        fila.appendChild(this.crearCeldaTexto(DB.formatQuantity(prod.currentStock, unit)));
        fila.appendChild(this.crearCeldaTexto(DB.formatQuantity(prod.minStock, unit)));
        fila.appendChild(this.crearCeldaTexto(DB.formatQuantity(prod.maxStock || 0, unit)));
        fila.appendChild(this.crearCeldaTexto(unit));
        fila.appendChild(this.crearCeldaTexto(prod.category || 'OTROS'));
        fila.appendChild(this.crearCeldaEstado(estado));
        fila.appendChild(this.crearCeldaAccionesProducto(prod.id));
        
        return fila;
    },

    // Cargar tabla del dashboard
    cargarTablaDashboard: function() {
        this.filtrarDashboard();
    },

    // Buscar productos
    buscarProductos: function(texto) {
        const search = document.getElementById('dashboardSearch');
        if (search) search.value = texto || '';
        this.filtrarDashboard();
    },

    // Cargar lista de productos (sección productos)
    cargarListaProductos: function() {
        this.filtrarProductos();
    },

    // Filtros del Dashboard
    filtrarDashboard: function() {
        const categoria = document.getElementById('dashboardCategoryFilter')?.value || 'ALL';
        const texto = (document.getElementById('dashboardSearch')?.value || '').toLowerCase().trim();
        
        const productos = DB.getProducts().filter(p => {
            const cat = (p.category || 'OTROS');
            if (categoria !== 'ALL' && this.normalizeCategory(cat) !== this.normalizeCategory(categoria)) return false;
            if (texto && !p.name.toLowerCase().includes(texto)) return false;
            return true;
        });
        
        this.cargarTablaDashboardFiltrada(productos);
    },

    // Filtros de Productos
    filtrarProductos: function() {
        const categoria = document.getElementById('productsCategoryFilter')?.value || 'ALL';
        const texto = (document.getElementById('productsSearch')?.value || '').toLowerCase().trim();
        
        const productos = DB.getProducts().filter(p => {
            const cat = (p.category || 'OTROS');
            if (categoria !== 'ALL' && this.normalizeCategory(cat) !== this.normalizeCategory(categoria)) return false;
            if (texto && !p.name.toLowerCase().includes(texto)) return false;
            return true;
        });
        
        this.cargarTablaProductosFiltrada(productos);
    },

    resetFiltrosDashboard: function() {
        const cat = document.getElementById('dashboardCategoryFilter');
        const search = document.getElementById('dashboardSearch');
        if (cat) cat.value = 'ALL';
        if (search) search.value = '';
        this.filtrarDashboard();
    },

    resetFiltrosProductos: function() {
        const cat = document.getElementById('productsCategoryFilter');
        const search = document.getElementById('productsSearch');
        if (cat) cat.value = 'ALL';
        if (search) search.value = '';
        this.filtrarProductos();
    },

    exportHistory: function() {
        const history = DB.getHistory();
        const blob = new Blob([JSON.stringify(history, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `SmartInventory_Historial_${this.getTodayDate()}.json`;
        a.click();
        URL.revokeObjectURL(url);
    },

    // Cargar tabla del dashboard filtrada
    cargarTablaDashboardFiltrada: function(productos) {
        const tbody = document.getElementById('productsTableBody');
        if (!tbody) return;
        tbody.innerHTML = '';
        
        productos.forEach(prod => {
            const fila = this.crearFilaProductoDashboard(prod);
            tbody.appendChild(fila);
        });

        this.applySortIfNeeded('productsTable');
    },

    // Cargar tabla de productos filtrada
    cargarTablaProductosFiltrada: function(productos) {
        const tbody = document.getElementById('productsListBody');
        if (!tbody) return;
        tbody.innerHTML = '';
        
        productos.forEach(prod => {
            const fila = this.crearFilaProductoLista(prod);
            tbody.appendChild(fila);
        });

        this.attachProductSelectionEvents();
        this.applySortIfNeeded('productsListTable');
    },

    attachProductSelectionEvents: function() {
        const tbody = document.getElementById('productsListBody');
        if (!tbody) return;
        tbody.querySelectorAll('.product-select').forEach(cb => {
            cb.addEventListener('change', () => {
                if (cb.checked) {
                    this.selectedProductIds.add(cb.value);
                } else {
                    this.selectedProductIds.delete(cb.value);
                }
                this.updateSelectAllCheckbox();
                this.updateBulkButton();
            });
        });
        this.updateSelectAllCheckbox();
        this.updateBulkButton();
    },

    toggleSelectAll: function(checked) {
        const tbody = document.getElementById('productsListBody');
        if (!tbody) return;
        tbody.querySelectorAll('.product-select').forEach(cb => {
            cb.checked = checked;
            if (checked) this.selectedProductIds.add(cb.value);
            else this.selectedProductIds.delete(cb.value);
        });
        this.updateSelectAllCheckbox();
        this.updateBulkButton();
    },

    updateSelectAllCheckbox: function() {
        const selectAll = document.getElementById('selectAllProducts');
        const tbody = document.getElementById('productsListBody');
        if (!selectAll || !tbody) return;
        const checkboxes = Array.from(tbody.querySelectorAll('.product-select'));
        const total = checkboxes.length;
        const checked = checkboxes.filter(cb => cb.checked).length;
        selectAll.indeterminate = checked > 0 && checked < total;
        selectAll.checked = total > 0 && checked === total;
    },

    updateBulkButton: function() {
        const bulkActions = document.getElementById('bulkActions');
        if (!bulkActions) return;
        bulkActions.classList.toggle('hidden', this.selectedProductIds.size === 0);
    },

    openBulkEditModal: function() {
        const count = this.selectedProductIds.size;
        if (count === 0) return;
        const label = document.getElementById('selectedCount');
        if (label) label.textContent = `${count} productos seleccionados`;
        document.getElementById('bulkEditModal').classList.add('active');
    },

    applyBulkEdit: function() {
        if (!this.checkRateLimit()) return;
        const unit = document.getElementById('bulkUnit')?.value || 'UND';
        const category = document.getElementById('bulkCategory')?.value || '';
        let updated = 0;
        
        this.selectedProductIds.forEach(id => {
            const updateData = { unit };
            if (category) updateData.category = category;
            const result = DB.updateProduct(id, updateData);
            if (result.success) updated++;
        });
        
        this.selectedProductIds.clear();
        this.cerrarModal('bulkEditModal');
        this.actualizarDashboard();
        this.cargarListaProductos();
        this.cargarChecklist(this.currentChecklistCategory);
        this.cargarSelectores();
        this.updateBulkButton();
        
        this.showToast(`Edición masiva aplicada: ${updated} productos`, 'success');
    },

    duplicarProducto: function(productId) {
        if (!this.checkRateLimit()) return;
        const original = DB.getProductById(productId);
        if (!original) return;
        const name = this.getDuplicateName(original.name);
        const copy = {
            name,
            currentStock: original.currentStock,
            minStock: original.minStock,
            maxStock: original.maxStock,
            unit: original.unit,
            category: original.category,
            supplier: original.supplier || ''
        };
        const result = DB.addProduct(copy);
        if (result.success) {
            this.actualizarDashboard();
            this.cargarListaProductos();
            this.cargarChecklist(this.currentChecklistCategory);
            this.cargarSelectores();
            this.showToast('Producto duplicado', 'success');
        } else {
            this.showToast('No se pudo duplicar', 'error');
        }
    },

    getDuplicateName: function(baseName) {
        const products = DB.getProducts();
        const base = `${baseName} (Copia)`;
        let name = base;
        let i = 2;
        const exists = (n) => products.some(p => p.name.toLowerCase() === n.toLowerCase());
        while (exists(name)) {
            name = `${base} ${i}`;
            i += 1;
        }
        return name;
    },

    initSortableTables: function() {
        ['productsTable', 'productsListTable'].forEach(tableId => {
            const table = document.getElementById(tableId);
            if (!table) return;
            table.querySelectorAll('th.sortable').forEach((th, index) => {
                th.dataset.colIndex = th.cellIndex;
                th.addEventListener('click', () => {
                    const type = th.dataset.type || 'string';
                    this.sortTable(tableId, th.cellIndex, type);
                });
            });
        });
    },

    sortTable: function(tableId, colIndex, dataType, directionOverride = null) {
        const table = document.getElementById(tableId);
        if (!table) return;
        const tbody = table.querySelector('tbody');
        if (!tbody) return;
        
        const state = this.sortState[tableId] || { colIndex: -1, direction: 'asc' };
        const direction = directionOverride || ((state.colIndex === colIndex && state.direction === 'asc') ? 'desc' : 'asc');
        this.sortState[tableId] = { colIndex, direction };
        
        const rows = Array.from(tbody.querySelectorAll('tr'));
        rows.sort((a, b) => {
            const aText = (a.children[colIndex]?.textContent || '').trim();
            const bText = (b.children[colIndex]?.textContent || '').trim();
            let aVal = aText;
            let bVal = bText;
            
            if (dataType === 'number') {
                aVal = parseFloat(aText) || 0;
                bVal = parseFloat(bText) || 0;
            } else if (dataType === 'unit') {
                aVal = parseFloat(aText) || 0;
                bVal = parseFloat(bText) || 0;
            } else {
                aVal = aText.toLowerCase();
                bVal = bText.toLowerCase();
            }
            
            if (aVal < bVal) return direction === 'asc' ? -1 : 1;
            if (aVal > bVal) return direction === 'asc' ? 1 : -1;
            return 0;
        });
        
        rows.forEach(r => tbody.appendChild(r));
        this.updateSortIndicators(tableId);
    },

    applySortIfNeeded: function(tableId) {
        const state = this.sortState[tableId];
        if (!state) return;
        this.sortTable(tableId, state.colIndex, this.getSortType(tableId, state.colIndex), state.direction);
    },

    getSortType: function(tableId, colIndex) {
        const table = document.getElementById(tableId);
        const th = table ? Array.from(table.querySelectorAll('th.sortable')).find(t => t.cellIndex === colIndex) : null;
        return th?.dataset.type || 'string';
    },

    updateSortIndicators: function(tableId) {
        const table = document.getElementById(tableId);
        if (!table) return;
        const state = this.sortState[tableId];
        table.querySelectorAll('th.sortable').forEach(th => {
            const span = th.querySelector('.sort-indicator');
            if (!span) return;
            if (state && th.cellIndex === state.colIndex) {
                span.textContent = state.direction === 'asc' ? '↑' : '↓';
            } else {
                span.textContent = '';
            }
        });
    },

    // Mostrar formulario de producto
    mostrarFormularioProducto: function(producto = null) {
        const container = document.getElementById('productFormContainer');
        const formTitle = document.getElementById('formTitle');
        const categorySelect = document.getElementById('category');
        
        if (producto) {
            formTitle.textContent = 'Editar Producto';
            document.getElementById('productId').value = producto.id;
            document.getElementById('productName').value = producto.name;
            document.getElementById('currentStock').value = producto.currentStock;
            document.getElementById('minStock').value = producto.minStock;
            document.getElementById('maxStock').value = producto.maxStock || 0;
            document.getElementById('unit').value = producto.unit || 'UND';
            if (categorySelect) {
                categorySelect.value = producto.category || DB.getCategoryForName(producto.name);
                categorySelect.dataset.manual = '1';
            }
        } else {
            formTitle.textContent = 'Nuevo Producto';
            document.getElementById('productForm').reset();
            document.getElementById('productId').value = '';
            if (categorySelect) {
                categorySelect.value = DB.getCategoryForName(document.getElementById('productName').value);
                categorySelect.dataset.manual = '0';
            }
        }
        
        container.style.display = 'block';
    },

    // Ocultar formulario de producto
    ocultarFormularioProducto: function() {
        document.getElementById('productFormContainer').style.display = 'none';
    },

    // Guardar producto
    guardarProducto: function() {
        if (!this.checkRateLimit()) return;
        const id = document.getElementById('productId').value;
        const productData = {
            name: document.getElementById('productName').value,
            currentStock: parseInt(document.getElementById('currentStock').value) || 0,
            minStock: parseInt(document.getElementById('minStock').value) || 0,
            maxStock: parseInt(document.getElementById('maxStock').value) || 0,
            unit: document.getElementById('unit').value,
            category: document.getElementById('category').value
        };
        
        const validation = Calculator.validateInput(productData, 'product');
        if (!validation.isValid) {
            alert('Errores:\n' + validation.errors.join('\n'));
            return;
        }
        
        let resultado;
        if (id) {
            resultado = DB.updateProduct(id, productData);
        } else {
            resultado = DB.addProduct(productData);
        }
        
        if (resultado.success) {
            this.ocultarFormularioProducto();
            this.actualizarDashboard();
            this.cargarListaProductos();
            this.cargarSelectores();
        } else {
            alert('Error: ' + resultado.message);
        }
    },

    // Editar producto
    editarProducto: function(id) {
        const producto = DB.getProductById(id);
        if (producto) {
            this.mostrarFormularioProducto(producto);
        }
    },

    // Confirmar eliminar
    confirmarEliminar: function(id) {
        this.productoAEliminar = id;
        document.getElementById('modalTitle').textContent = 'Confirmar eliminación';
        document.getElementById('modalMessage').textContent = '¿Está seguro de eliminar este producto?';
        document.getElementById('confirmModal').classList.add('active');
    },

    // Cerrar modal
    cerrarModal: function(modalId) {
        document.getElementById(modalId).classList.remove('active');
    },

    // Cargar semana actual
    cargarSemanaActual: function() {
        document.getElementById('currentWeek').textContent = 
            `Semana actual: ${Calculator.getCurrentWeek()}`;
        
        // Establecer semana actual en input
        const hoy = new Date();
        const semana = Calculator.getCurrentWeek();
        document.getElementById('weekDate').value = semana;
    },

    // Cargar selectores de productos
    cargarSelectores: function() {
        const productos = DB.getProducts();
        const selects = ['registerProduct', 'historyProduct'];
        
        selects.forEach(id => {
            const select = document.getElementById(id);
            if (!select) return;
            
            select.innerHTML = '<option value="">Seleccionar producto...</option>';
            
            productos.forEach(prod => {
                const option = document.createElement('option');
                option.value = prod.id;
                const unit = DB.normalizeUnit(prod.unit);
                option.textContent = `${prod.name} (${unit})`;
                select.appendChild(option);
            });
        });
        
        this.actualizarUnidadRegistro();
    },
    
    // ================= CHECKLIST =================
    cargarChecklist: function(category = 'ALL', append = false) {
        const container = document.getElementById('checklistContainer');
        if (!container) return;
        
        if (!append) {
            this.checklistOffset = 0;
            container.innerHTML = '';
        }
        this.currentChecklistCategory = category;
        const searchText = this.currentChecklistSearch.toLowerCase().trim();
        
        const productos = DB.getProducts()
            .filter(p => {
                if (category === 'ALL') return true;
                const productCat = this.normalizeCategory(p.category || 'OTROS');
                return productCat === this.normalizeCategory(category);
            })
            .filter(p => {
                if (!searchText) return true;
                return p.name.toLowerCase().includes(searchText);
            })
            .filter(p => {
                if (!this.checklistQuickReview) return true;
                const status = DB.getProductStatus(p);
                return status.status !== 'good';
            })
            .sort((a, b) => a.name.localeCompare(b.name));
        
        const startIndex = this.checklistOffset;
        const batch = productos.slice(startIndex, startIndex + this.checklistPageSize);
        this.checklistOffset += batch.length;
        
        const fragment = document.createDocumentFragment();
        batch.forEach((prod, idx) => {
            const rowIndex = startIndex + idx;
            const unit = DB.normalizeUnit(prod.unit);
            const status = DB.getProductStatus(prod);
            const avgConsumption = DB.getAverageConsumption(prod.id);
            const autoRecommend = DB.getSeasonalRecommendation ? DB.getSeasonalRecommendation(prod) : DB.calculateAutoRecommendation(prod);
            const history = DB.getHistoryByProduct(prod.id);
            const lastRecord = history.length > 0 ? history[0] : null;
            const trend = DB.getConsumptionTrend(prod.id);
            
            const card = document.createElement('div');
            card.className = `checklist-card ${status.status}`;
            card.dataset.productId = prod.id;
            card.dataset.row = rowIndex;
            
            const header = document.createElement('div');
            header.className = 'checklist-header';
            const title = document.createElement('div');
            title.className = 'checklist-title';
            title.textContent = prod.name;
            const unitPill = document.createElement('span');
            unitPill.className = 'unit-pill';
            unitPill.textContent = unit;
            header.appendChild(title);
            header.appendChild(unitPill);
            
            const inputs = document.createElement('div');
            inputs.className = 'checklist-inputs';
            
            inputs.appendChild(this.crearChecklistInput('STOCK', prod.currentStock, unit, prod.id, 'stock', rowIndex, 0));
            inputs.appendChild(this.crearChecklistInput('COMPRAR', prod.actionsPending?.buy || 0, unit, prod.id, 'buy', rowIndex, 1, autoRecommend));
            inputs.appendChild(this.crearChecklistInput('PEDIR', prod.actionsPending?.order || 0, unit, prod.id, 'order', rowIndex, 2, autoRecommend));
            
            const meta = document.createElement('div');
            meta.className = 'checklist-meta';
            const targetDays = DB.getTargetDays();
            const trendIcon = trend.direction === 'up' ? '↑' : (trend.direction === 'down' ? '↓' : '→');
            meta.innerHTML = `
                <span>MIN: ${DB.formatQuantity(prod.minStock, unit)}</span>
                <span>MAX: ${DB.formatQuantity(prod.maxStock || 0, unit)}</span>
                <span>PROM: ${DB.formatQuantity(avgConsumption, unit)} ${trendIcon}</span>
                <span>OBJ: ${targetDays} días</span>
                <span class="checklist-status">${status.icon} ${status.label}</span>
                <span class="rec-hint" data-recommend="${autoRecommend}">SUGERIDO: ${DB.formatQuantity(autoRecommend, unit)}</span>
                <span class="rec-warning">Comprando menos de lo sugerido</span>
            `;
            
            if (this.comparisonEnabled && lastRecord) {
                const compare = document.createElement('span');
                compare.className = 'compare-tag';
                compare.textContent = `Sem. ant: ${DB.formatQuantity(lastRecord.consumption || 0, unit)}`;
                meta.appendChild(compare);
            }
            
            card.appendChild(header);
            card.appendChild(inputs);
            card.appendChild(meta);
            fragment.appendChild(card);
        });
        
        container.appendChild(fragment);
        this.attachChecklistEvents(container);
        this.updateAllRecommendationWarnings();
        this.updateChecklistProgress();
        
        const loadMoreBtn = document.getElementById('loadMoreChecklist');
        if (loadMoreBtn) {
            loadMoreBtn.style.display = this.checklistOffset < productos.length ? 'block' : 'none';
        }
    },
    
    crearChecklistInput: function(label, value, unit, productId, field, row, col, recommend = 0) {
        const wrapper = document.createElement('div');
        wrapper.className = `checklist-field ${field}`;
        const lab = document.createElement('label');
        lab.textContent = `${label} (${unit})`;
        const input = document.createElement('input');
        input.type = 'number';
        input.min = '0';
        if (field === 'stock') {
            input.value = value || 0;
        } else {
            input.value = value > 0 ? value : '';
        }
        if (recommend > 0) {
            input.placeholder = `Sugerido: ${recommend} ${unit}`;
        }
        input.dataset.recommend = recommend;
        input.dataset.productId = productId;
        input.dataset.field = field;
        input.dataset.row = row;
        input.dataset.col = col;
        wrapper.appendChild(lab);
        wrapper.appendChild(input);
        return wrapper;
    },
    
    attachChecklistEvents: function(scope) {
        const root = scope || document;
        root.querySelectorAll('.checklist-inputs input').forEach(input => {
            input.addEventListener('keydown', (e) => this.handleChecklistKey(e));
            input.addEventListener('input', (e) => this.debouncedSaveChecklist(e));
            input.addEventListener('blur', (e) => this.saveChecklistImmediately(e));
            input.addEventListener('input', () => this.updateRecommendationWarningForInput(input));
            if (input.dataset.field === 'stock') {
                // Actualiza sugerencias en tiempo real al cambiar stock
                input.addEventListener('input', (e) => this.actualizarSugerenciaPorStock(e.target));
            }
        });
    },
    
    setupAutoSave: function() {
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') {
                this.flushAllChecklistSaves();
            }
        });
        
        window.addEventListener('beforeunload', () => {
            this.flushAllChecklistSaves();
        });
    },
    
    handleChecklistKey: function(e) {
        const input = e.target;
        const row = parseInt(input.dataset.row, 10);
        const col = parseInt(input.dataset.col, 10);
        
        if (e.key === 'Enter') {
            e.preventDefault();
            this.guardarChecklistFila(row);
            this.focusChecklistCell(row + 1, 0);
            return;
        }
        
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            this.focusChecklistCell(row + 1, col);
            return;
        }
        
        if (e.key === 'ArrowUp') {
            e.preventDefault();
            this.focusChecklistCell(row - 1, col);
            return;
        }
        
        if (e.key === 'Escape') {
            e.preventDefault();
            input.value = '';
        }
    },
    
    focusChecklistCell: function(row, col) {
        const next = document.querySelector(`.checklist-inputs input[data-row="${row}"][data-col="${col}"]`);
        if (next) next.focus();
    },
    
    debouncedSaveChecklist: function(e) {
        const input = e.target;
        const row = parseInt(input.dataset.row, 10);
        if (Number.isNaN(row)) return;
        
        if (this.checklistSaveTimers[row]) {
            clearTimeout(this.checklistSaveTimers[row]);
        }
        
        this.checklistSaveTimers[row] = setTimeout(() => {
            this.guardarChecklistFila(row);
            delete this.checklistSaveTimers[row];
        }, 500);
    },
    
    saveChecklistImmediately: function(e) {
        const input = e.target;
        const row = parseInt(input.dataset.row, 10);
        if (Number.isNaN(row)) return;
        this.guardarChecklistFila(row);
    },
    
    flushAllChecklistSaves: function() {
        const rows = new Set();
        document.querySelectorAll('.checklist-inputs input').forEach(input => {
            const row = parseInt(input.dataset.row, 10);
            if (!Number.isNaN(row)) rows.add(row);
        });
        
        rows.forEach(row => this.guardarChecklistFila(row));
    },
    
    guardarChecklistFila: function(row) {
        if (!this.checkRateLimit()) return;
        const inputs = document.querySelectorAll(`.checklist-inputs input[data-row="${row}"]`);
        if (!inputs || inputs.length === 0) return;
        
        const productId = inputs[0].dataset.productId;
        const product = DB.getProductById(productId);
        if (!product) return;
        
        const stock = this.getChecklistValue(inputs, 'stock');
        let buy = this.getChecklistValue(inputs, 'buy');
        let order = this.getChecklistValue(inputs, 'order');
        
        if (stock < 0 || buy < 0 || order < 0) {
            this.showToast('No se permiten valores negativos.', 'error');
            return;
        }
        
        const maxStock = DB.normalizeNumber(product.maxStock);
        if (maxStock > 0 && (stock + buy + order) > maxStock) {
            const allowedExtra = Math.max(0, maxStock - stock);
            let newBuy = buy;
            let newOrder = order;
            
            if (newBuy + newOrder > allowedExtra) {
                const excess = (newBuy + newOrder) - allowedExtra;
                // Reducir primero PEDIR y luego COMPRAR
                if (newOrder >= excess) {
                    newOrder -= excess;
                } else {
                    const remaining = excess - newOrder;
                    newOrder = 0;
                    newBuy = Math.max(0, newBuy - remaining);
                }
            }
            
            // Actualizar inputs
            this.setChecklistValue(inputs, 'buy', newBuy);
            this.setChecklistValue(inputs, 'order', newOrder);
            
            buy = newBuy;
            order = newOrder;
            
            this.showToast('Ajusté COMPRAR/PEDIR para no exceder el máximo.', 'warning');
        }
        
        DB.updateProduct(productId, { currentStock: stock });
        DB.setPendingActions(productId, buy, order);
        
        DB.upsertDailyRecord(this.getTodayDate(), {
            id: product.id,
            name: product.name,
            unit: DB.normalizeUnit(product.unit),
            stockBefore: product.currentStock,
            buyToday: buy,
            orderToday: order,
            stockAfter: stock
        });
        this.markChecklistProgress(productId);
        Array.from(inputs).forEach(input => this.updateRecommendationWarningForInput(input));
        
        const card = document.querySelector(`.checklist-card[data-row="${row}"]`);
        if (card) {
            card.classList.add('save-flash');
            setTimeout(() => card.classList.remove('save-flash'), 1000);
        }
        
        this.actualizarDashboard();
    },
    
    getChecklistValue: function(inputs, field) {
        const input = Array.from(inputs).find(i => i.dataset.field === field);
        if (!input) return 0;
        return parseFloat(input.value) || 0;
    },
    
    updateAllRecommendationWarnings: function() {
        document.querySelectorAll('.checklist-inputs input').forEach(input => {
            this.updateRecommendationWarningForInput(input);
        });
    },
    
    updateRecommendationWarningForInput: function(input) {
        const row = input.dataset.row;
        if (row === undefined) return;
        const inputs = document.querySelectorAll(`.checklist-inputs input[data-row="${row}"]`);
        if (!inputs || inputs.length === 0) return;
        
        const buyInput = Array.from(inputs).find(i => i.dataset.field === 'buy');
        const orderInput = Array.from(inputs).find(i => i.dataset.field === 'order');
        const recommend = Math.max(
            parseFloat(buyInput?.dataset.recommend || 0),
            parseFloat(orderInput?.dataset.recommend || 0)
        );
        const buy = this.getChecklistValue(inputs, 'buy');
        const order = this.getChecklistValue(inputs, 'order');
        const total = buy + order;
        
        const card = document.querySelector(`.checklist-card[data-row="${row}"]`);
        const hint = card ? card.querySelector('.rec-hint') : null;
        const warn = card ? card.querySelector('.rec-warning') : null;
        
        if (recommend > 0 && total < recommend) {
            if (card) card.classList.add('under-recommend');
            if (hint) hint.classList.add('warn');
            if (warn) warn.classList.add('show');
        } else {
            if (card) card.classList.remove('under-recommend');
            if (hint) hint.classList.remove('warn');
            if (warn) warn.classList.remove('show');
        }
    },

    // Recalcular sugerencias cuando cambia el stock (sin guardar)
    actualizarSugerenciaPorStock: function(stockInput) {
        const row = stockInput.dataset.row;
        if (row === undefined) return;
        
        const inputs = document.querySelectorAll(`.checklist-inputs input[data-row="${row}"]`);
        if (!inputs || inputs.length === 0) return;
        
        const productId = inputs[0].dataset.productId;
        const product = DB.getProductById(productId);
        if (!product) return;
        
        const nuevoStock = parseFloat(stockInput.value) || 0;
        const unidad = DB.normalizeUnit(product.unit);
        const tmpProduct = { ...product, currentStock: nuevoStock };
        
        const autoRecommend = DB.getSeasonalRecommendation ? 
            DB.getSeasonalRecommendation(tmpProduct) : 
            DB.calculateAutoRecommendation(tmpProduct);
        
        const buyInput = Array.from(inputs).find(i => i.dataset.field === 'buy');
        const orderInput = Array.from(inputs).find(i => i.dataset.field === 'order');
        
        if (buyInput) {
            buyInput.dataset.recommend = autoRecommend;
            buyInput.placeholder = `Sugerido: ${autoRecommend} ${unidad}`;
        }
        if (orderInput) {
            orderInput.dataset.recommend = autoRecommend;
            orderInput.placeholder = `Sugerido: ${autoRecommend} ${unidad}`;
        }
        
        const card = document.querySelector(`.checklist-card[data-row="${row}"]`);
        if (card) {
            const hint = card.querySelector('.rec-hint');
            if (hint) {
                hint.textContent = `SUGERIDO: ${DB.formatQuantity(autoRecommend, unidad)}`;
                hint.dataset.recommend = autoRecommend;
            }
        }
        
        this.updateRecommendationWarningForInput(stockInput);
    },
    
    setChecklistValue: function(inputs, field, value) {
        const input = Array.from(inputs).find(i => i.dataset.field === field);
        if (input) input.value = value;
    },
    
    filtrarChecklist: function(e) {
        document.querySelectorAll('.filter-btn').forEach(btn => btn.classList.remove('active'));
        const btn = e.target.closest('.filter-btn');
        btn.classList.add('active');
        const category = btn.dataset.category;
        this.checklistOffset = 0;
        this.cargarChecklist(category);
    },
    
    normalizeCategory: function(value) {
        const text = String(value || '').toUpperCase();
        return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    },
    
    productOffset: 0,
    pageSize: 50,
    cargarProductosPaginados: function(category = 'ALL') {
        const productos = DB.getProducts()
            .filter(p => category === 'ALL' || this.normalizeCategory(p.category || 'OTROS') === this.normalizeCategory(category))
            .slice(this.productOffset, this.productOffset + this.pageSize);
        this.productOffset += this.pageSize;
        return productos;
    },
    
    resetPagination: function() {
        this.productOffset = 0;
    },
    
    getTodayDate: function() {
        return new Date().toISOString().split('T')[0];
    },
    
    mostrarResumenDia: function() {
        const products = DB.getProducts();
        const buyItems = products.filter(p => (p.actionsPending?.buy || 0) > 0);
        const orderItems = products.filter(p => (p.actionsPending?.order || 0) > 0);
        
        const summary = document.getElementById('summaryContent');
        summary.innerHTML = '';
        
        const buySection = document.createElement('div');
        buySection.className = 'summary-section';
        const buyTitle = document.createElement('div');
        buyTitle.className = 'tag-buy';
        buyTitle.textContent = 'Compras (Mercado)';
        const buyUl = document.createElement('ul');
        buyUl.className = 'summary-list';
        
        if (buyItems.length === 0) {
            const li = document.createElement('li');
            li.textContent = 'Sin compras';
            buyUl.appendChild(li);
        } else {
            buyItems.forEach(p => {
                const unit = DB.normalizeUnit(p.unit);
                const qty = DB.formatQuantity(p.actionsPending.buy, unit);
                const status = DB.getProductStatus(p);
                const li = document.createElement('li');
                li.textContent = `${p.name}: ${qty} (${status.icon} ${status.label})`;
                buyUl.appendChild(li);
            });
        }
        
        buySection.appendChild(buyTitle);
        buySection.appendChild(buyUl);
        
        const orderSection = document.createElement('div');
        orderSection.className = 'summary-section';
        const orderTitle = document.createElement('div');
        orderTitle.className = 'tag-order';
        orderTitle.textContent = 'Pedidos (Proveedor)';
        const orderUl = document.createElement('ul');
        orderUl.className = 'summary-list';
        
        if (orderItems.length === 0) {
            const li = document.createElement('li');
            li.textContent = 'Sin pedidos';
            orderUl.appendChild(li);
        } else {
            orderItems.forEach(p => {
                const unit = DB.normalizeUnit(p.unit);
                const qty = DB.formatQuantity(p.actionsPending.order, unit);
                const supplier = p.supplier ? ` (${p.supplier})` : '';
                const li = document.createElement('li');
                li.textContent = `${p.name}: ${qty}${supplier}`;
                orderUl.appendChild(li);
            });
        }
        
        orderSection.appendChild(orderTitle);
        orderSection.appendChild(orderUl);
        
        summary.appendChild(buySection);
        summary.appendChild(orderSection);
        
        const totals = document.createElement('div');
        totals.className = 'summary-section';
        totals.textContent = `Totales: Compras ${buyItems.length} | Pedidos ${orderItems.length}`;
        summary.appendChild(totals);
        
        document.getElementById('summaryModal').classList.add('active');
    },
    
    cargarPredicciones: function() {
        const products = DB.getProducts();
        const container = document.getElementById('predictionsContainer');
        if (!container) return;
        
        container.innerHTML = '';
        
        products.forEach(p => {
            const avgConsumption = DB.getAverageConsumption(p.id);
            if (avgConsumption === 0) return;
            
            const currentStock = DB.normalizeNumber(p.currentStock);
            const unit = DB.normalizeUnit(p.unit);
            const weeksToZero = avgConsumption > 0 ? Math.floor(currentStock / avgConsumption) : 0;
            const stockIn4 = currentStock - (avgConsumption * 4);
            const recommendation = DB.getSeasonalRecommendation ? DB.getSeasonalRecommendation(p) : DB.calculateAutoRecommendation(p);
            const trend = DB.getConsumptionTrend(p.id);
            const seasonal = DB.detectSeasonality(p.id);
            const stockout = DB.predictStockout(p);
            
            let status = 'good';
            
            if (weeksToZero <= 1) {
                status = 'critical';
            } else if (weeksToZero <= 2) {
                status = 'low';
            }
            
            const card = document.createElement('div');
            card.className = `prediction-card status-${status}`;
            
            const header = document.createElement('div');
            header.className = 'prediction-header';
            const name = document.createElement('span');
            name.className = 'prediction-name';
            name.textContent = p.name;
            const unitEl = document.createElement('span');
            unitEl.className = 'prediction-unit';
            unitEl.textContent = unit;
            header.appendChild(name);
            header.appendChild(unitEl);
            
            const details = document.createElement('div');
            details.className = 'prediction-details';
            
            const d1 = document.createElement('div');
            const trendIcon = trend.direction === 'up' ? '↑' : (trend.direction === 'down' ? '↓' : '→');
            d1.textContent = `Consumo promedio: ${DB.formatQuantity(avgConsumption, unit)}/semana ${trendIcon}`;
            const d2 = document.createElement('div');
            d2.textContent = `Stock actual: ${DB.formatQuantity(currentStock, unit)}`;
            const d3 = document.createElement('div');
            d3.textContent = `Stock en 4 semanas: ${DB.formatQuantity(stockIn4, unit)}`;
            
            details.appendChild(d1);
            details.appendChild(d2);
            details.appendChild(d3);
            
            if (stockout) {
                const d4 = document.createElement('div');
                d4.textContent = `Ruptura estimada: ${stockout.days} días (${stockout.date})`;
                if (stockout.critical) d4.className = 'prediction-critical-text';
                details.appendChild(d4);
            }
            
            if (seasonal.isSeasonal) {
                const d5 = document.createElement('div');
                d5.textContent = `Estacionalidad detectada (${Math.round(seasonal.confidence * 100)}%)`;
                details.appendChild(d5);
            }
            
            if (recommendation > 0) {
                const rec = document.createElement('div');
                rec.className = `prediction-recommend status-${status}`;
                rec.textContent = `Recomendación: Comprar ${DB.formatQuantity(recommendation, unit)}`;
                details.appendChild(rec);
            } else {
                const ok = document.createElement('div');
                ok.className = 'prediction-good';
                ok.textContent = 'Stock suficiente';
                details.appendChild(ok);
            }
            
            card.appendChild(header);
            card.appendChild(details);
            
            container.appendChild(card);
        });
    },

    cargarAlertas: function() {
        const container = document.getElementById('alertsContainer');
        if (!container) return;
        container.innerHTML = '';
        
        const products = DB.getProducts();
        const alerts = [];
        
        products.forEach(p => {
            const stockout = DB.predecirRoturaStock(p);
            if (stockout && stockout.diasRestantes !== Infinity) {
                if (stockout.diasRestantes < 7) {
                    alerts.push({
                        product: p,
                        type: stockout.diasRestantes < 3 ? 'danger' : 'warning',
                        title: p.name,
                        badge: stockout.diasRestantes < 3 ? 'CRÍTICO' : 'ALERTA',
                        details: `Ruptura en ${stockout.diasRestantes} días (${stockout.fecha || 'pronto'})`,
                        action: stockout.alerta || 'Revisar stock'
                    });
                }
            }
            
            const est = DB.detectarEstacionalidad(p.id);
            if (est.tieneEstacionalidad) {
                alerts.push({
                    product: p,
                    type: 'warning',
                    title: p.name,
                    badge: 'ESTACIONAL',
                    details: `Variación detectada (${Math.round(est.confianza * 100)}%)`,
                    action: 'Ajusta tu compra sugerida'
                });
            }
        });
        
        if (alerts.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'alert-card';
            empty.textContent = 'No hay alertas por ahora.';
            container.appendChild(empty);
            return;
        }
        
        alerts.slice(0, 12).forEach(item => {
            const card = document.createElement('div');
            card.className = `alert-card ${item.type}`;
            
            const header = document.createElement('div');
            header.className = 'alert-header';
            const title = document.createElement('div');
            title.className = 'alert-title';
            title.textContent = item.title;
            const badge = document.createElement('span');
            badge.className = `alert-badge ${item.type === 'danger' ? 'critico' : 'alerta'}`;
            badge.textContent = item.badge;
            header.appendChild(title);
            header.appendChild(badge);
            
            const details = document.createElement('div');
            details.className = 'alert-details';
            details.textContent = item.details;
            
            const action = document.createElement('div');
            action.className = 'alert-action';
            action.textContent = item.action;
            
            card.appendChild(header);
            card.appendChild(details);
            card.appendChild(action);
            container.appendChild(card);
        });
    },
    
    renderPredictionChart: function() {
        const canvas = document.getElementById('predictionChart');
        if (!canvas || typeof Chart === 'undefined') return;
        const products = DB.getProducts()
            .map(p => {
                const avg = DB.getAverageConsumption(p.id);
                const current = DB.normalizeNumber(p.currentStock);
                const weeksToZero = avg > 0 ? current / avg : 999;
                return { product: p, avg, current, weeksToZero };
            })
            .filter(p => p.avg > 0)
            .sort((a, b) => a.weeksToZero - b.weeksToZero)
            .slice(0, 5);
        
        const labels = Array.from({ length: 9 }, (_, i) => `Sem ${i}`);
        const datasets = products.map((entry, idx) => {
            const data = labels.map((_, i) => Math.max(0, Math.round(entry.current - (entry.avg * i))));
            const color = ['#e74c3c', '#f39c12', '#3498db', '#2ecc71', '#9b59b6'][idx % 5];
            return {
                label: entry.product.name,
                data,
                borderColor: color,
                backgroundColor: 'transparent',
                tension: 0.2
            };
        });
        
        if (this.predictionChartInstance) {
            this.predictionChartInstance.destroy();
        }
        this.predictionChartInstance = new Chart(canvas, {
            type: 'line',
            data: { labels, datasets },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'bottom' },
                    title: { display: true, text: 'Predicción de stock a 8 semanas (Top críticos)' }
                },
                scales: {
                    y: { beginAtZero: true }
                }
            }
        });
    },
    
    ejecutarCompras: function() {
        if (!this.checkRateLimit()) return;
        const updated = DB.executePurchases();
        this.cargarChecklist();
        this.actualizarDashboard();
        this.showToast(`Compras registradas: ${updated} productos`, 'success');
    },
    
    ejecutarPedidos: function() {
        if (!this.checkRateLimit()) return;
        const updated = DB.executeOrders();
        this.cargarChecklist();
        this.actualizarDashboard();
        this.showToast(`Pedidos registrados: ${updated} productos`, 'success');
    },
    
    showToast: function(message, type = 'info') {
        const toast = document.createElement('div');
        toast.className = 'toast';
        if (type === 'error') toast.style.borderLeftColor = 'var(--danger-color)';
        if (type === 'warning') toast.style.borderLeftColor = 'var(--warning-color)';
        if (type === 'success') toast.style.borderLeftColor = 'var(--success-color)';
        
        toast.textContent = message;
        document.body.appendChild(toast);
        
        setTimeout(() => {
            toast.remove();
        }, 2500);
    },
    
    checkRateLimit: function() {
        if (window.Security) {
            return Security.checkRateLimit(300, 60000);
        }
        const now = Date.now();
        if (now - this.rateLimit.lastTime > 60000) {
            this.rateLimit.count = 0;
            this.rateLimit.lastTime = now;
        }
        this.rateLimit.count++;
        if (this.rateLimit.count > 300) {
            this.showToast('Demasiadas acciones. Espera un momento.', 'warning');
            return false;
        }
        return true;
    },
    
    initNightMode: function() {
        const key = 'smart_inventory_theme';
        const stored = localStorage.getItem(key);
        this.setNightMode(stored === 'dark');
    },

    setNightMode: function(enabled) {
        const key = 'smart_inventory_theme';
        document.body.classList.toggle('night-mode', enabled);
        localStorage.setItem(key, enabled ? 'dark' : 'light');
        this.updateThemeToggle();
    },

    updateThemeToggle: function() {
        const btn = document.getElementById('toggleTheme');
        if (!btn) return;
        const isDark = document.body.classList.contains('night-mode');
        btn.innerHTML = isDark
            ? '<i class="fas fa-sun"></i> Modo claro'
            : '<i class="fas fa-moon"></i> Modo oscuro';
    },
    
    initKeyboardShortcuts: function() {
        document.addEventListener('keydown', (e) => {
            if (e.ctrlKey && e.key.toLowerCase() === 's') {
                e.preventDefault();
                this.flushAllChecklistSaves();
                this.showToast('Todo guardado', 'success');
                if (window.Security) {
                    Security.auditLog('manual_save', {});
                }
            }
            if (e.ctrlKey && e.key.toLowerCase() === 'f') {
                e.preventDefault();
                const search = document.getElementById('dashboardSearch');
                if (search) search.focus();
            }
            if (e.key === 'F5') {
                e.preventDefault();
                this.actualizarDashboard();
                this.showToast('Datos actualizados', 'info');
            }
            if (e.ctrlKey && e.key.toLowerCase() === 'b') {
                e.preventDefault();
                if (window.Security) {
                    const backupKey = Security.createBackup();
                    this.showToast(`Backup creado: ${backupKey}`, 'success');
                }
            }
        });
    },
    
    initInactivityMonitor: function() {
        const reset = () => this.resetInactivityTimer();
        ['click', 'keydown', 'input', 'touchstart'].forEach(evt => {
            document.addEventListener(evt, reset, { passive: true });
        });
        this.resetInactivityTimer();
    },
    
    resetInactivityTimer: function() {
        if (this.inactivityTimer) clearTimeout(this.inactivityTimer);
        this.inactivityTimer = setTimeout(() => {
            this.showToast('Inactividad detectada. Asegúrate de guardar.', 'warning');
        }, 3600000);
    },
    
    checkStorageLimit: function() {
        let totalSize = 0;
        for (const key in localStorage) {
            if (Object.prototype.hasOwnProperty.call(localStorage, key)) {
                totalSize += (localStorage[key] || '').length * 2;
            }
        }
        if (totalSize > 4.5 * 1024 * 1024) {
            this.showToast('Almacenamiento casi lleno. Exporta y limpia datos antiguos.', 'warning');
        }
    },
    
    getChecklistProgressKey: function() {
        const date = new Date().toISOString().split('T')[0];
        return `smart_inventory_progress_${date}`;
    },
    
    loadChecklistProgress: function() {
        const key = this.getChecklistProgressKey();
        const raw = localStorage.getItem(key);
        if (!raw) return;
        try {
            const ids = JSON.parse(raw);
            this.checklistProgress = new Set(ids);
        } catch (e) {
            this.checklistProgress = new Set();
        }
    },
    
    saveChecklistProgress: function() {
        const key = this.getChecklistProgressKey();
        localStorage.setItem(key, JSON.stringify(Array.from(this.checklistProgress)));
    },
    
    markChecklistProgress: function(productId) {
        if (!productId) return;
        this.checklistProgress.add(productId);
        this.saveChecklistProgress();
        this.updateChecklistProgress();
    },
    
    updateChecklistProgress: function() {
        const total = DB.getProducts().length || 1;
        const done = this.checklistProgress.size;
        const pct = Math.min(100, Math.round((done / total) * 100));
        const bar = document.getElementById('checklistProgress');
        if (bar) bar.style.width = `${pct}%`;
    },
    
    exportAuditLogs: function() {
        const logs = DB.getAuditLogs();
        const blob = new Blob([JSON.stringify(logs, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `SmartInventory_Auditoria_${this.getTodayDate()}.json`;
        a.click();
        URL.revokeObjectURL(url);
    },
    
    restoreLatestBackup: function() {
        const backup = DB.getLatestBackup();
        if (!backup) {
            this.showToast('No hay backups disponibles.', 'warning');
            return;
        }
        if (confirm('¿Restaurar el último backup? Esto reemplaza los datos actuales.')) {
            const ok = DB.restoreFromBackup(backup);
            if (ok) {
                this.actualizarDashboard();
                this.cargarChecklist();
                this.cargarSelectores();
                this.showToast('Backup restaurado.', 'success');
            }
        }
    },
    
    actualizarUnidadRegistro: function() {
        const productoId = document.getElementById('registerProduct').value;
        const hint = document.getElementById('currentUnitHint');
        if (!hint) return;
        
        if (!productoId) {
            hint.textContent = 'UND';
            return;
        }
        
        const producto = DB.getProductById(productoId);
        hint.textContent = DB.normalizeUnit(producto ? producto.unit : 'UND');
    },

    // Calcular consumo semanal
    calcularConsumoSemanal: function() {
        const productoId = document.getElementById('registerProduct').value;
        const stockActual = parseInt(document.getElementById('currentStockWeek').value) || 0;
        
        if (!productoId) {
            alert('Seleccione un producto');
            return;
        }
        
        const producto = DB.getProductById(productoId);
        const historial = DB.getHistoryByProduct(productoId);
        const lastRecord = historial.length > 0 ? historial[0] : null;
        const stockInicial = lastRecord ? lastRecord.finalStock : stockActual;
        
        let consumo = 0;
        if (stockActual <= stockInicial) {
            consumo = stockInicial - stockActual;
        }
        
        const unit = DB.normalizeUnit(producto.unit);
        document.getElementById('weeklyConsumption').textContent = DB.formatQuantity(consumo, unit);
        document.getElementById('weeklyResult').style.display = 'block';
    },

    // Guardar registro semanal
    guardarRegistroSemanal: function() {
        if (!this.checkRateLimit()) return;
        const productoId = document.getElementById('registerProduct').value;
        if (!productoId) {
            alert('Seleccione un producto');
            return;
        }
        
        const producto = DB.getProductById(productoId);
        const stockActual = parseInt(document.getElementById('currentStockWeek').value) || 0;
        const semana = document.getElementById('weekDate').value;
        
        const validation = Calculator.validateInput({
            productId: productoId,
            currentStock: stockActual
        }, 'weekly_simple');
        
        if (!validation.isValid) {
            alert('Errores:\n' + validation.errors.join('\n'));
            return;
        }
        
        const historial = DB.getHistoryByProduct(productoId);
        const lastRecord = historial.length > 0 ? historial[0] : null;
        const stockInicial = lastRecord ? lastRecord.finalStock : stockActual;
        
        let compra = 0;
        let consumo = 0;
        if (stockActual <= stockInicial) {
            consumo = stockInicial - stockActual;
        } else {
            compra = stockActual - stockInicial;
            consumo = 0;
        }
        
        const resultado = DB.addHistoryRecord({
            productId: productoId,
            productName: producto.name,
            initialStock: stockInicial,
            purchase: compra,
            finalStock: stockActual,
            consumption: consumo,
            weekDate: semana
        });
        
        if (resultado.success) {
            document.getElementById('weeklyForm').reset();
            document.getElementById('weeklyResult').style.display = 'none';
            this.cargarSemanaActual();
            this.actualizarDashboard();
            alert('Registro guardado exitosamente');
        }
    },

    // Cargar historial
    cargarHistorial: function() {
        const productoId = document.getElementById('historyProduct').value;
        if (!productoId) return;
        
        const producto = DB.getProductById(productoId);
        if (!producto) return;
        const historial = DB.getHistoryByProduct(productoId);
        const tbody = document.getElementById('historyTableBody');
        tbody.innerHTML = '';
        
        historial.forEach(reg => {
            const fila = document.createElement('tr');
            const unit = DB.normalizeUnit(producto.unit);
            
            fila.appendChild(this.crearCeldaTexto(Calculator.formatWeekDisplay(reg.weekDate)));
            fila.appendChild(this.crearCeldaTexto(DB.formatQuantity(reg.initialStock, unit)));
            fila.appendChild(this.crearCeldaTexto(DB.formatQuantity(reg.purchase, unit)));
            
            const tipoRaw = String(reg.actionType || '').toLowerCase();
            let tipoLabel = '-';
            if (tipoRaw === 'compra' || tipoRaw === 'buy') tipoLabel = 'Compra';
            else if (tipoRaw === 'pedido' || tipoRaw === 'order') tipoLabel = 'Pedido';
            else if (tipoRaw) tipoLabel = 'Manual';
            fila.appendChild(this.crearCeldaTexto(tipoLabel));
            
            fila.appendChild(this.crearCeldaTexto(DB.formatQuantity(reg.finalStock, unit)));
            
            const consumoTd = document.createElement('td');
            const consumoStrong = document.createElement('strong');
            consumoStrong.textContent = DB.formatQuantity(reg.consumption, unit);
            consumoTd.appendChild(consumoStrong);
            fila.appendChild(consumoTd);
            
            const accionesTd = document.createElement('td');
            const deleteBtn = this.crearBotonAccion(
                'btn btn-danger btn-sm',
                'fas fa-trash',
                () => this.eliminarRegistro(reg.id)
            );
            accionesTd.appendChild(deleteBtn);
            fila.appendChild(accionesTd);
            tbody.appendChild(fila);
        });
        
        // Actualizar gráfico
        Charts.createConsumptionChart('consumptionChart', historial);
    },

    // Eliminar registro
    eliminarRegistro: function(registroId) {
        if (confirm('¿Eliminar este registro?')) {
            DB.deleteHistoryRecord(registroId);
            this.cargarHistorial();
            this.actualizarDashboard();
        }
    },

    // Manejar importación de Excel
    manejarImportacion: async function(event) {
        if (!this.checkRateLimit()) return;
        const file = event.target.files[0];
        if (!file) return;
        
        const validacion = ExcelHandler.validateFile(file);
        if (!validacion.valid) {
            alert(validacion.message);
            return;
        }
        
        try {
            const resultado = await ExcelHandler.importExcelFile(file);
            
            if (resultado.success) {
                const results = document.getElementById('importResults');
                results.innerHTML = '';
                const p = document.createElement('p');
                p.textContent = `✅ ${resultado.message}`;
                const ul = document.createElement('ul');
                const liNew = document.createElement('li');
                liNew.textContent = `📦 Nuevos: ${resultado.details.new}`;
                const liUpdated = document.createElement('li');
                liUpdated.textContent = `🔄 Actualizados: ${resultado.details.updated}`;
                ul.appendChild(liNew);
                ul.appendChild(liUpdated);
                if (resultado.details.errors.length > 0) {
                    const liErr = document.createElement('li');
                    liErr.textContent = `⚠️ Errores: ${resultado.details.errors.length}`;
                    ul.appendChild(liErr);
                }
                results.appendChild(p);
                results.appendChild(ul);
                document.getElementById('importModal').classList.add('active');
                DB.auditLog('import_excel', {
                    new: resultado.details.new,
                    updated: resultado.details.updated,
                    errors: resultado.details.errors.length
                });
                
                this.actualizarDashboard();
                this.cargarListaProductos();
                this.cargarSelectores();
            } else {
                alert('Error: ' + resultado.message);
            }
            
        } catch (error) {
            alert('Error al importar: ' + error);
        }
        
        event.target.value = '';
    }
};

// Inicializar cuando el DOM esté listo
document.addEventListener('DOMContentLoaded', () => {
    // Inicializar Firebase + Sync
    try {
        window.firebaseApp = firebase.initializeApp(firebaseConfig);
        window.firebaseDb = firebase.firestore();
    } catch (e) {
        // Ignorar si Firebase no carga
    }
    
    if (window.firebaseDb) {
        Sync.init();
    }
    
    App.init();
});

// Hacer App global para los onclick
window.App = App;
