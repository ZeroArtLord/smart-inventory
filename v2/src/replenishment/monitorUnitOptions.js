// Opciones de presentación para la CAPTURA semanal de Monitor.
// A diferencia del inventario, este módulo NO traduce ni convierte cantidades
// a unidades base. "2 CAJA" significa dos cajas, nunca 2 UND o 48 UND.
import { catalogUnitCode } from '../catalog/catalogUi.js';
import { normalizePresentations } from '../catalog/presentationModel.js';

export const MONITOR_COMMON_UNITS = Object.freeze([
  'UND', 'CAJA', 'CJ', 'BULTO', 'KG', 'G', 'LT', 'ML',
  'PAQ', 'SACO', 'BOLSA', 'CESTA', 'BOTELLA', 'GALÓN',
  'POTE', 'LATA', 'ROLLO', 'DOCENA', 'BANDEJA', 'M'
]);

export function monitorUnitOptions(product = null, savedUnit = '') {
  const codes = [];
  const add = code => {
    const value = String(code || '').trim().toUpperCase().slice(0, 40);
    if (value && !codes.includes(value)) codes.push(value);
  };
  // La unidad del renglón guardado tiene prioridad; puede ser una presentación
  // antigua que aún existe en la semana, pero ya no en el catálogo.
  add(savedUnit);
  if (product) {
    add(catalogUnitCode(product));
    add(product.unitCode || product.unit);
    try {
      const presentations = normalizePresentations(product.presentations, {
        inventoryUnitId: product.inventoryUnitId,
        purchaseUnitId: product.purchaseUnitId,
        purchaseConversion: product.purchaseConversion
      });
      for (const p of presentations) add(p.code || p.name);
    } catch (_) {
      // No impedir editar o imprimir la revisión si el catálogo tiene
      // presentaciones viejas inconsistentes. No inventar conversiones.
    }
  }
  for (const code of MONITOR_COMMON_UNITS) add(code);
  return codes;
}

export function selectedMonitorUnit({ selected, custom = '', current = '' } = {}) {
  const value = String(selected === '__OTHER__' ? custom : selected ?? current)
    .trim().toUpperCase();
  if (!value) throw new Error('Indica la unidad del producto');
  if (value.length > 40) throw new Error('La unidad excede 40 caracteres');
  return value;
}
