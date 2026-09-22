import {
  resolveProductByBarcode
} from '../scanner/barcodeScanner.js';
import {
  addProductBarcode
} from '../catalog/barcodeModel.js';
import {
  updateProduct
} from '../catalog/catalogService.js';
import {
  openBarcodeAssociationDialog
} from './barcodeAssociationUi.js';

export async function resolveOrAssociateBarcode({
  code,
  products = [],
  allowAssociate = false,
  onAssociated = null
} = {}) {
  const scannedCode = String(code || '').trim();
  if (!scannedCode) {
    return {
      status: 'empty',
      product: null,
      barcode: null
    };
  }

  const known = resolveProductByBarcode(
    products,
    scannedCode
  );

  if (known) {
    return {
      status: 'known',
      ...known
    };
  }

  if (!allowAssociate) {
    return {
      status: 'unknown',
      product: null,
      barcode: null,
      code: scannedCode
    };
  }

  const associated = await openBarcodeAssociationDialog({
    code: scannedCode,
    products,
    onAssociate: async ({
      productId,
      code: nextCode,
      label,
      conversion
    }) => {
      const product = products.find(
        item => item.id === productId
      );

      if (!product) {
        throw new Error('Producto no encontrado');
      }

      const barcodes = addProductBarcode(product, {
        code: nextCode,
        label,
        conversion
      });

      const updated = await updateProduct(
        product.id,
        { barcodes }
      );

      await onAssociated?.(updated);

      return {
        product: updated,
        barcode: updated.barcodes.find(
          item => item.code === nextCode
        ) || {
          code: nextCode,
          label,
          conversion
        }
      };
    }
  });

  if (!associated?.product) {
    return {
      status: 'cancelled',
      product: null,
      barcode: null,
      code: scannedCode
    };
  }

  return {
    status: 'associated',
    product: associated.product,
    barcode: associated.barcode,
    code: scannedCode
  };
}
