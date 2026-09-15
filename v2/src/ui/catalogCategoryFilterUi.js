import { listProducts } from '../catalog/catalogService.js';
import { STORES, getAll } from '../storage/database.js';

const app = document.getElementById('app');
const FILTER_ID = 'catalogCategoryFilter';
const EMPTY_ID = 'catalogCategoryFilterEmpty';
const STORAGE_KEY = 'vigia.catalog.categoryFilter';
const ALL = '__ALL__';
const UNCATEGORIZED = '__UNCATEGORIZED__';

let timer = null;
let enhancing = false;

if (app) {
  const observer = new MutationObserver(scheduleEnhance);
  observer.observe(app, { childList: true, subtree: true });

  document.addEventListener('input', event => {
    if (event.target?.id === 'catalogLocalSearch') {
      applyCatalogFilters();
    }
  });

  document.addEventListener('change', event => {
    if (event.target?.id !== FILTER_ID) return;
    writeSessionSelection(event.target.value);
    applyCatalogFilters();
  });

  scheduleEnhance();
}

function scheduleEnhance() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    enhanceCatalogCategoryFilter().catch(error => {
      console.error('No se pudo preparar el filtro por categoría', error);
    });
  }, 45);
}

async function enhanceCatalogCategoryFilter() {
  if (enhancing) return;

  const toolbar = app?.querySelector('.catalog-toolbar-v2');
  const tableBody = app?.querySelector('#catalogRows');
  const mobileList = app?.querySelector('#catalogMobileList');

  if (!toolbar || !tableBody || !mobileList) return;

  if (
    tableBody.dataset.vigiaCategoryFilterReady === 'true' &&
    document.getElementById(FILTER_ID)
  ) {
    applyCatalogFilters();
    return;
  }

  enhancing = true;

  try {
    const [products, categories] = await Promise.all([
      listProducts(),
      getAll(STORES.CATEGORIES)
    ]);

    if (
      !document.body.contains(tableBody) ||
      !document.body.contains(mobileList)
    ) {
      return;
    }

    tagRenderedProducts(tableBody, mobileList, products);
    installCategorySelect(toolbar, products, categories);
    installEmptyMessage(toolbar);
    tableBody.dataset.vigiaCategoryFilterReady = 'true';
    applyCatalogFilters();
  } finally {
    enhancing = false;
  }
}

function tagRenderedProducts(tableBody, mobileList, products) {
  const rows = [
    ...tableBody.querySelectorAll('tr[data-catalog-filter]')
  ];
  const cards = [
    ...mobileList.querySelectorAll('.catalog-mobile-card[data-catalog-filter]')
  ];

  rows.forEach((row, index) => tagNode(row, products[index]));
  cards.forEach((card, index) => tagNode(card, products[index]));
}

function tagNode(node, product) {
  if (!node || !product) return;

  node.dataset.catalogProductId = String(product.id || '');
  node.dataset.catalogCategoryId = product.categoryId
    ? String(product.categoryId)
    : UNCATEGORIZED;
}

function installCategorySelect(toolbar, products, categories) {
  document.getElementById(FILTER_ID)
    ?.closest('.v6-catalog-category-filter')
    ?.remove();

  const counts = new Map();
  for (const product of products) {
    const key = product.categoryId
      ? String(product.categoryId)
      : UNCATEGORIZED;
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  const categoryById = new Map(
    categories.map(category => [String(category.id), category])
  );

  const options = [...counts.entries()]
    .filter(([id]) => id !== UNCATEGORIZED)
    .map(([id, count]) => ({
      id,
      count,
      name: String(
        categoryById.get(id)?.name || 'Categoría desconocida'
      ).trim() || 'Categoría desconocida'
    }))
    .sort((a, b) => a.name.localeCompare(
      b.name,
      'es',
      { sensitivity: 'base' }
    ));

  const label = document.createElement('label');
  label.className = 'v6-catalog-category-filter';

  const caption = document.createElement('span');
  caption.textContent = 'Categoría';

  const select = document.createElement('select');
  select.id = FILTER_ID;
  select.setAttribute('aria-label', 'Filtrar catálogo por categoría');

  addOption(
    select,
    ALL,
    `Todas las categorías (${products.length})`
  );

  for (const option of options) {
    addOption(
      select,
      option.id,
      `${option.name} (${option.count})`
    );
  }

  if (counts.has(UNCATEGORIZED)) {
    addOption(
      select,
      UNCATEGORIZED,
      `Sin categoría (${counts.get(UNCATEGORIZED)})`
    );
  }

  const allowed = new Set(
    [...select.options].map(option => option.value)
  );
  const stored = readSessionSelection();
  select.value = allowed.has(stored) ? stored : ALL;

  if (select.value !== stored) {
    writeSessionSelection(select.value);
  }

  label.append(caption, select);

  const badge = toolbar.querySelector('.badge');
  if (badge) toolbar.insertBefore(label, badge);
  else toolbar.appendChild(label);
}

function addOption(select, value, text) {
  const option = document.createElement('option');
  option.value = value;
  option.textContent = text;
  select.appendChild(option);
}

function installEmptyMessage(toolbar) {
  document.getElementById(EMPTY_ID)?.remove();

  const empty = document.createElement('div');
  empty.id = EMPTY_ID;
  empty.className = 'v6-catalog-category-empty';
  empty.hidden = true;
  empty.textContent = 'No hay productos que coincidan con esta categoría y búsqueda.';

  toolbar.insertAdjacentElement('afterend', empty);
}

function applyCatalogFilters() {
  const select = document.getElementById(FILTER_ID);
  const tableBody = document.getElementById('catalogRows');
  const mobileList = document.getElementById('catalogMobileList');

  if (!select || !tableBody || !mobileList) return;

  const query = String(
    document.getElementById('catalogLocalSearch')?.value || ''
  )
    .trim()
    .toLowerCase();

  const categoryId = select.value || ALL;
  const rows = [
    ...tableBody.querySelectorAll('tr[data-catalog-filter]')
  ];
  const cards = [
    ...mobileList.querySelectorAll('.catalog-mobile-card[data-catalog-filter]')
  ];

  for (const node of [...rows, ...cards]) {
    const haystack = String(node.dataset.catalogFilter || '');
    const nodeCategory = String(
      node.dataset.catalogCategoryId || UNCATEGORIZED
    );

    const matchesSearch = !query || haystack.includes(query);
    const matchesCategory =
      categoryId === ALL || nodeCategory === categoryId;

    node.hidden = !(matchesSearch && matchesCategory);
  }

  const visible = rows.filter(row => !row.hidden).length;
  const total = rows.length || cards.length;
  const badge = app
    ?.querySelector('.catalog-toolbar-v2 .badge');

  if (badge) {
    badge.textContent =
      visible === total && categoryId === ALL && !query
        ? String(total)
        : `${visible} de ${total}`;
    badge.title = 'Productos visibles / total del catálogo';
  }

  const empty = document.getElementById(EMPTY_ID);
  if (empty) {
    empty.hidden = total === 0 || visible > 0;
  }
}

function readSessionSelection() {
  try {
    return sessionStorage.getItem(STORAGE_KEY) || ALL;
  } catch {
    return ALL;
  }
}

function writeSessionSelection(value) {
  try {
    sessionStorage.setItem(STORAGE_KEY, String(value || ALL));
  } catch {
    // El filtro sigue funcionando aunque el navegador bloquee sessionStorage.
  }
}
