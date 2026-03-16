"# Smart Inventory - ByteMind Solutions

Sistema de gestión de inventario inteligente con importación/exportación Excel, análisis de consumo y recomendaciones de compra.

## Características

### 📊 Dashboard Inteligente
- Resumen visual del inventario
- Tarjetas de estado: Total productos, Bueno, Bajo, Crítico
- Tabla interactiva con todos los productos
- Filtro de búsqueda en tiempo real

### 📦 Gestión de Productos
- Agregar productos manualmente
- Editar stock actual y mínimo
- Eliminar productos con confirmación
- Estado automático: 🟢 Bueno, 🟡 Bajo, 🔴 Crítico

### 📝 Registro Semanal
- Registrar consumo semanal por producto
- Cálculo automático de consumo
- Historial de registros
- Fecha de semana automática

### 📈 Análisis y Reportes
- Gráficos de consumo histórico
- Cálculo de consumo promedio (últimas 4 semanas)
- Recomendaciones de compra inteligentes
- Proyección de stock

### 📁 Importación/Exportación Excel
- **Importar desde Excel**: .xlsx, .xls, .csv
- Formato compatible: Producto | Stock Actual | Stock Mínimo
- Detección automática de productos nuevos
- Actualización de productos existentes
- **Exportar a Excel**: Todos los productos con historial
- Plantilla de importación disponible

## Tecnologías Utilizadas

- **HTML5** - Estructura semántica
- **CSS3** - Flexbox/Grid, diseño responsive
- **JavaScript Vanilla** - Lógica de aplicación
- **SheetJS (XLSX)** - Manipulación de archivos Excel
- **Chart.js** - Gráficos interactivos
- **Font Awesome** - Íconos
- **localStorage** - Persistencia de datos

## Instalación y Uso

1. **Clonar/Descargar** el proyecto
2. **Abrir** `index.html` en cualquier navegador moderno
3. **No se requiere** servidor, base de datos o instalación adicional

## Estructura de Archivos

```
SmartInventory/
├── index.html          # Página principal
├── css/
│   └── styles.css      # Estilos principales
├── js/
│   ├── app.js          # Lógica principal de la aplicación
│   ├── database.js     # Manejo de localStorage y CRUD
│   ├── calculator.js   # Cálculos de consumo y predicciones
│   ├── excelHandler.js # Importación/exportación Excel
│   └── charts.js       # Gráficos con Chart.js
└── README.md           # Documentación
```

## Funcionalidades Detalladas

### Cálculos Automáticos

#### Consumo Semanal
```
consumo = stock_inicial + compra - stock_final
```

#### Consumo Promedio (últimas 4 semanas)
```
promedio = (suma últimos 4 consumos) / (cantidad semanas)
```

#### Recomendación de Compra
```
faltante = (promedio + stock_mínimo) - stock_actual
si faltante > 0: COMPRAR faltante
si no: NO COMPRAR
```

#### Estado del Producto
- **🟢 Bueno**: stock_actual >= (promedio * 1.5)
- **🟡 Bajo**: stock_actual < (promedio * 1.5) y stock_actual > stock_mínimo
- **🔴 Crítico**: stock_actual <= stock_mínimo

### Formato de Excel Compatible

| Producto       | Stock Actual | Stock Mínimo |
|----------------|--------------|--------------|
| Aceite 24und   | 18           | 5            |
| Harina PAN     | 32           | 10           |
| Azúcar 1kg     | 7            | 8            |

## Uso

### 1. Dashboard Principal
- Ver resumen del inventario
- Buscar productos
- Ver estado de cada producto
- Importar/Exportar Excel

### 2. Gestión de Productos
- Agregar nuevos productos
- Editar stock mínimo
- Eliminar productos

### 3. Registro Semanal
- Seleccionar producto
- Ingresar stock inicial, compras y stock final
- Sistema calcula consumo automáticamente

### 4. Historial
- Ver gráfico de consumo por producto
- Consultar registros históricos
- Editar/eliminar registros

## Datos de Ejemplo

La aplicación incluye datos de ejemplo para pruebas:
- 3 productos predefinidos
- Historial de consumo de ejemplo

## Compatibilidad

- **Navegadores**: Chrome, Firefox, Safari, Edge (versiones modernas)
- **Dispositivos**: Desktop, Tablet, Mobile (responsive)
- **Sistemas Operativos**: Windows, macOS, Linux, Android, iOS

## Limitaciones

- **localStorage**: Límite de ~5-10MB dependiendo del navegador
- **Excel**: Archivos hasta 5MB
- **Sin conexión**: Funciona completamente offline

## Contribución

1. Fork el proyecto
2. Crear rama de características (`git checkout -b feature/AmazingFeature`)
3. Commit cambios (`git commit -m 'Add AmazingFeature'`)
4. Push a la rama (`git push origin feature/AmazingFeature`)
5. Abrir Pull Request

## Licencia

Este proyecto está bajo la Licencia MIT.

## Contacto

ByteMind Solutions - [contacto@bytemind.solutions](mailto:contacto@bytemind.solutions)

---

**Nota**: Esta aplicación funciona completamente en el navegador. Todos los datos se guardan localmente en el dispositivo."