// Mantiene la UI del surtido alineada con un ADJUSTMENT rápido sin forzar
// recarga ni reconstruir el carrito. El módulo principal ya escucha `input`
// en cada cantidad y recalcula stock/insuficiencia desde movimientos locales.
document.addEventListener('vigia:quick-stock-corrected', event => {
  if (String(event.detail?.context?.source || '').toUpperCase() !== 'SUPPLY') {
    return;
  }

  setTimeout(() => {
    document.querySelectorAll('[data-live-qty]')
      .forEach(input => {
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
  }, 0);
});
