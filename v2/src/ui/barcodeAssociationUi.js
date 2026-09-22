export function openBarcodeAssociationDialog({
  code,
  products = [],
  onAssociate
} = {}) {
  const scannedCode = String(code ?? '').trim();
  if (!scannedCode) {
    throw new Error('Código escaneado requerido');
  }

  document.querySelector('.v89-barcode-association-overlay')?.remove();

  return new Promise((resolve, reject) => {
    let selectedProductId = '';

    const overlay = document.createElement('div');
    overlay.className = 'v89-barcode-association-overlay';
    overlay.innerHTML = `
      <section class="v89-barcode-association-dialog" role="dialog" aria-modal="true" aria-label="Código no reconocido">
        <header>
          <div>
            <div class="v89-barcode-kicker">Código no reconocido</div>
            <h2>Asociar código</h2>
            <p>
              <strong>${escapeHtml(scannedCode)}</strong> todavía no está asociado a ningún producto VIGÍA.
            </p>
          </div>
          <button class="danger" data-barcode-association-close type="button">Cerrar</button>
        </header>

        <label class="v89-barcode-search">
          Buscar producto
          <input
            data-barcode-association-search
            autocomplete="off"
            placeholder="Nombre, SAINT o SKU"
          >
        </label>

        <div class="v89-barcode-results" data-barcode-association-results></div>

        <section class="v89-barcode-selected" data-barcode-association-selected hidden>
          <div>
            <small>Producto VIGÍA seleccionado</small>
            <strong data-barcode-association-selected-name>—</strong>
          </div>

          <label>
            Etiqueta física
            <input
              data-barcode-association-label
              autocomplete="off"
              value="Código ${escapeHtml(scannedCode)}"
              placeholder="Ej. Mavesa 1L"
            >
          </label>

          <label>
            Conversión a unidad base
            <input
              data-barcode-association-conversion
              inputmode="decimal"
              autocomplete="off"
              value="1"
              placeholder="1"
            >
            <small>
              Ejemplo: si el producto VIGÍA está en LT y esta botella trae 900 ml, usa 0,9.
            </small>
          </label>

          <button class="primary" data-barcode-association-save type="button">
            Asociar código
          </button>
        </section>
      </section>
    `;

    document.body.appendChild(overlay);

    const searchInput = overlay.querySelector('[data-barcode-association-search]');
    const results = overlay.querySelector('[data-barcode-association-results]');
    const selected = overlay.querySelector('[data-barcode-association-selected]');
    const selectedName = overlay.querySelector('[data-barcode-association-selected-name]');
    const labelInput = overlay.querySelector('[data-barcode-association-label]');
    const conversionInput = overlay.querySelector('[data-barcode-association-conversion]');

    const cleanup = value => {
      document.removeEventListener('keydown', onKeydown);
      overlay.remove();
      resolve(value);
    };

    const renderResults = query => {
      const term = normalize(query);
      const filtered = (Array.isArray(products) ? products : [])
        .filter(product => product?.active !== false)
        .filter(product => {
          if (!term) return true;
          return normalize([
            product.name,
            product.saintCode,
            product.sku,
            ...(product.aliases || [])
          ].filter(Boolean).join(' ')).includes(term);
        })
        .slice(0, 12);

      results.innerHTML = filtered.length
        ? filtered.map(product => `
            <button
              class="v89-barcode-product-option"
              data-barcode-association-product
              data-product-id="${escapeHtml(product.id)}"
              type="button"
            >
              <strong>${escapeHtml(product.name)}</strong>
              <small>
                ${escapeHtml(
                  [
                    product.saintCode ? 'SAINT ' + product.saintCode : '',
                    product.sku ? 'SKU ' + product.sku : ''
                  ].filter(Boolean).join(' · ') || 'Producto VIGÍA'
                )}
              </small>
            </button>
          `).join('')
        : '<div class="empty compact-empty">No hay coincidencias.</div>';
    };

    const onKeydown = event => {
      if (event.key === 'Escape') {
        cleanup(null);
      }
    };

    overlay.addEventListener('click', event => {
      if (
        event.target === overlay ||
        event.target.closest('[data-barcode-association-close]')
      ) {
        cleanup(null);
        return;
      }

      const option = event.target.closest('[data-barcode-association-product]');
      if (option) {
        selectedProductId = option.dataset.productId || '';
        const product = products.find(item => item.id === selectedProductId);
        if (!product) return;

        selected.hidden = false;
        selectedName.textContent = product.name || product.id;
        labelInput.value = product.name
          ? `${product.name} · ${scannedCode}`
          : `Código ${scannedCode}`;
        conversionInput.focus();
        conversionInput.select();
        return;
      }

      if (event.target.closest('[data-barcode-association-save]')) {
        save().catch(error => {
          reject(error);
          document.removeEventListener('keydown', onKeydown);
          overlay.remove();
        });
      }
    });

    searchInput.addEventListener('input', event => {
      renderResults(event.target.value);
    });

    async function save() {
      if (!selectedProductId) {
        throw new Error('Selecciona primero el producto VIGÍA');
      }

      const conversion = Number(
        String(conversionInput.value || '').trim().replace(',', '.')
      );

      if (!Number.isFinite(conversion) || conversion <= 0) {
        throw new Error('La conversión debe ser mayor que cero');
      }

      const payload = {
        productId: selectedProductId,
        code: scannedCode,
        label: String(labelInput.value || '').trim() || scannedCode,
        conversion
      };

      const result = await onAssociate?.(payload);
      cleanup(result || payload);
    }

    document.addEventListener('keydown', onKeydown);
    renderResults('');
    searchInput.focus();
  });
}

function normalize(value) {
  return String(value ?? '')
    .trim()
    .toLocaleLowerCase('es');
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
