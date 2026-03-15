// charts.js - Manejo de gráficos con Chart.js
// Smart Inventory - ByteMind Solutions

const Charts = {
    // Instancia del gráfico actual
    currentChart: null,
    
    // Configuración común para gráficos
    commonOptions: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: {
                position: 'top',
                labels: {
                    font: {
                        size: 12
                    }
                }
            },
            tooltip: {
                mode: 'index',
                intersect: false
            }
        },
        scales: {
            y: {
                beginAtZero: true,
                title: {
                    display: true,
                    text: 'Unidades'
                }
            },
            x: {
                title: {
                    display: true,
                    text: 'Semanas'
                }
            }
        }
    },
    
    // Crear gráfico de consumo
    createConsumptionChart: function(canvasId, historyData) {
        const ctx = document.getElementById(canvasId).getContext('2d');
        
        // Destruir gráfico anterior si existe
        if (this.currentChart) {
            this.currentChart.destroy();
        }
        
        // Ordenar historial por semana (ms antigua primero)
        const sortedHistory = [...historyData]
            .sort((a, b) => this.compareWeekAsc(a, b));
        
        // Preparar datos para el gráfico
        const labels = sortedHistory.map(record => 
            Calculator.formatWeekDisplay(record.weekDate)
        );
        
        const consumptionData = sortedHistory.map(record => record.consumption);
        const stockData = sortedHistory.map(record => record.finalStock);
        const purchaseData = sortedHistory.map(record => record.purchase);
        
        // Configuración del gráfico
        const config = {
            type: 'line',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: 'Consumo Semanal',
                        data: consumptionData,
                        borderColor: '#3498db',
                        backgroundColor: 'rgba(52, 152, 219, 0.1)',
                        borderWidth: 2,
                        fill: true,
                        tension: 0.4
                    },
                    {
                        label: 'Stock Final',
                        data: stockData,
                        borderColor: '#27ae60',
                        backgroundColor: 'rgba(39, 174, 96, 0.1)',
                        borderWidth: 2,
                        fill: false,
                        tension: 0.4
                    },
                    {
                        label: 'Compras',
                        data: purchaseData,
                        borderColor: '#f39c12',
                        backgroundColor: 'rgba(243, 156, 18, 0.1)',
                        borderWidth: 2,
                        fill: false,
                        tension: 0.4
                    }
                ]
            },
            options: {
                ...this.commonOptions,
                plugins: {
                    ...this.commonOptions.plugins,
                    title: {
                        display: true,
                        text: 'Consumo Semanal y Stock',
                        font: {
                            size: 16
                        }
                    }
                }
            }
        };
        
        // Crear nuevo gráfico
        this.currentChart = new Chart(ctx, config);
        return this.currentChart;
    },
    
    // Crear gráfico de estado de inventario
    createInventoryStatusChart: function(canvasId, statistics) {
        const ctx = document.getElementById(canvasId).getContext('2d');
        
        const config = {
            type: 'doughnut',
            data: {
                labels: ['Bueno', 'Bajo', 'Crítico'],
                datasets: [{
                    data: [statistics.good, statistics.low, statistics.critical],
                    backgroundColor: [
                        'rgba(39, 174, 96, 0.8)',    // Verde
                        'rgba(243, 156, 18, 0.8)',   // Amarillo
                        'rgba(231, 76, 60, 0.8)'     // Rojo
                    ],
                    borderColor: [
                        '#27ae60',
                        '#f39c12',
                        '#e74c3c'
                    ],
                    borderWidth: 2
                }]
            },
            options: {
                responsive: true,
                plugins: {
                    legend: {
                        position: 'top',
                    },
                    title: {
                        display: true,
                        text: 'Estado del Inventario',
                        font: {
                            size: 16
                        }
                    },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                const label = context.label || '';
                                const value = context.raw || 0;
                                const total = context.dataset.data.reduce((a, b) => a + b, 0);
                                const percentage = Math.round((value / total) * 100);
                                return `${label}: ${value} productos (${percentage}%)`;
                            }
                        }
                    }
                }
            }
        };
        
        return new Chart(ctx, config);
    },
    
    // Crear gráfico de proyección de stock
    createStockProjectionChart: function(canvasId, product) {
        const ctx = document.getElementById(canvasId).getContext('2d');
        
        const projection = Calculator.calculateStockProjection(product, 8);
        const labels = projection.map(p => `Semana ${p.week}`);
        const stockData = projection.map(p => p.projectedStock);
        
        // Crear colores basados en el estado
        const backgroundColors = projection.map(p => {
            switch(p.status) {
                case 'critical': return 'rgba(231, 76, 60, 0.8)';
                case 'low': return 'rgba(243, 156, 18, 0.8)';
                default: return 'rgba(39, 174, 96, 0.8)';
            }
        });
        
        const config = {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Stock Proyectado',
                    data: stockData,
                    backgroundColor: backgroundColors,
                    borderColor: 'rgba(52, 152, 219, 1)',
                    borderWidth: 1
                }]
            },
            options: {
                ...this.commonOptions,
                plugins: {
                    ...this.commonOptions.plugins,
                    title: {
                        display: true,
                        text: 'Proyección de Stock (8 semanas)',
                        font: {
                            size: 16
                        }
                    },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                const value = context.raw;
                                const status = projection[context.dataIndex].status;
                                const statusText = status === 'critical' ? 'Crítico' : 
                                                  status === 'low' ? 'Bajo' : 'Bueno';
                                return `Stock: ${value} unidades (${statusText})`;
                            }
                        }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        title: {
                            display: true,
                            text: 'Unidades'
                        }
                    },
                    x: {
                        title: {
                            display: true,
                            text: 'Semanas futuras'
                        }
                    }
                }
            }
        };
        
        return new Chart(ctx, config);
    },
    
    // Actualizar gráfico con nuevos datos
    updateChart: function(chart, newData) {
        if (!chart || !newData) return;
        
        chart.data.datasets.forEach((dataset, i) => {
            if (newData.datasets && newData.datasets[i]) {
                dataset.data = newData.datasets[i].data;
            }
        });
        
        if (newData.labels) {
            chart.data.labels = newData.labels;
        }
        
        chart.update();
    },
    
    // Destruir gráfico actual
    destroyCurrentChart: function() {
        if (this.currentChart) {
            this.currentChart.destroy();
            this.currentChart = null;
        }
    },
    
    // Crear gráfico de tendencia de consumo
    createTrendChart: function(canvasId, historyData) {
        const ctx = document.getElementById(canvasId).getContext('2d');
        
        // Ordenar historial por semana
        const sortedHistory = [...historyData]
            .sort((a, b) => this.compareWeekAsc(a, b));
        
        if (sortedHistory.length < 2) {
            // Mostrar mensaje si no hay suficientes datos
            ctx.font = '16px Arial';
            ctx.fillStyle = '#666';
            ctx.textAlign = 'center';
            ctx.fillText('Se necesitan al menos 2 registros para mostrar tendencia', 
                         ctx.canvas.width / 2, ctx.canvas.height / 2);
            return null;
        }
        
        const labels = sortedHistory.map(record => 
            Calculator.formatWeekDisplay(record.weekDate)
        );
        const consumptionData = sortedHistory.map(record => record.consumption);
        
        // Calcular línea de tendencia (regresión lineal simple)
        const trendLine = this.calculateTrendLine(consumptionData);
        
        const config = {
            type: 'line',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: 'Consumo Real',
                        data: consumptionData,
                        borderColor: '#3498db',
                        backgroundColor: 'rgba(52, 152, 219, 0.1)',
                        borderWidth: 3,
                        fill: true,
                        tension: 0.2
                    },
                    {
                        label: 'Tendencia',
                        data: trendLine,
                        borderColor: '#e74c3c',
                        backgroundColor: 'transparent',
                        borderWidth: 2,
                        borderDash: [5, 5],
                        fill: false,
                        tension: 0
                    }
                ]
            },
            options: {
                ...this.commonOptions,
                plugins: {
                    ...this.commonOptions.plugins,
                    title: {
                        display: true,
                        text: 'Tendencia de Consumo',
                        font: {
                            size: 16
                        }
                    }
                }
            }
        };
        
        return new Chart(ctx, config);
    },
    
    // Calcular línea de tendencia (regresión lineal)
    calculateTrendLine: function(data) {
        const n = data.length;
        let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
        
        for (let i = 0; i < n; i++) {
            sumX += i;
            sumY += data[i];
            sumXY += i * data[i];
            sumX2 += i * i;
        }
        
        const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
        const intercept = (sumY - slope * sumX) / n;
        
        // Generar puntos de la línea de tendencia
        const trendLine = [];
        for (let i = 0; i < n; i++) {
            trendLine.push(slope * i + intercept);
        }
        
        return trendLine;
    },

    // Comparar semanas en orden ascendente (ms antigua primero)
    compareWeekAsc: function(a, b) {
        const aKey = this.parseWeekKey(a.weekDate);
        const bKey = this.parseWeekKey(b.weekDate);
        
        if (aKey !== null && bKey !== null) {
            return aKey - bKey;
        }
        
        if (aKey !== null) return -1;
        if (bKey !== null) return 1;
        
        return new Date(a.createdAt) - new Date(b.createdAt);
    },
    
    // Convertir semana ISO YYYY-Www a clave numrica
    parseWeekKey: function(weekStr) {
        if (!weekStr) return null;
        const match = /^(\d{4})-W(\d{2})$/.exec(String(weekStr).trim());
        if (!match) return null;
        const year = parseInt(match[1], 10);
        const week = parseInt(match[2], 10);
        if (Number.isNaN(year) || Number.isNaN(week)) return null;
        return (year * 100) + week;
    }
};