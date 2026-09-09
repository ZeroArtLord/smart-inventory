import { listProcurementLists } from '../replenishment/procurementListService.js';
import { printThermalProcurementList } from '../printing/thermalPrinterClient.js';

let printing = false;

document.addEventListener(
  'click',
  event => {
    const button = event.target.closest(
      '[data-v6p-action="direct-print"]'
    );
    if (!button) return;

    event.preventDefault();
    event.stopImmediatePropagation();

    if (printing) return;

    printList(button).catch(error => {
      console.error(error);
      toast(error?.message || String(error));
    });
  },
  true
);

async function printList(button) {
  const listId = String(button.dataset.listId || '').trim();
  if (!listId) {
    throw new Error('No se pudo identificar la lista a imprimir');
  }

  printing = true;
  button.disabled = true;
  const previous = button.textContent;
  button.textContent = 'Enviando a comandera…';

  try {
    const lists = await listProcurementLists({
      includeTerminal: true
    });
    const list = lists.find(item => item.id === listId);
    if (!list) {
      throw new Error('Lista no encontrada en este dispositivo');
    }

    const decorated = {
      ...list,
      code: listCode(list),
      dateLabel: formatDate(list.createdAt)
    };

    const result = await printThermalProcurementList(decorated);
    toast(
      `${result.copies} copia(s) enviadas · ` +
      `${result.itemCount} renglón(es) · ${result.printer.name}`
    );
  } finally {
    printing = false;
    button.disabled = false;
    button.textContent = previous;
  }
}

function listCode(list) {
  const prefix = list.kind === 'ORDER' ? 'PED' : 'COM';
  const raw = String(list.id || '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .slice(-6)
    .toUpperCase() || '000001';

  return `${prefix}-${raw}`;
}

function formatDate(value) {
  const date = new Date(value || Date.now());
  if (Number.isNaN(date.getTime())) return 'Sin fecha';

  return new Intl.DateTimeFormat('es-VE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
}

function toast(message) {
  const save = document.getElementById('saveStatus');
  if (save) save.textContent = String(message || 'Listo');

  const node = document.createElement('div');
  node.className = 'v6p-toast';
  node.textContent = String(message || 'Listo');
  document.body.appendChild(node);
  setTimeout(() => node.remove(), 3200);
}
