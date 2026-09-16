import { STORES, getAll } from '../storage/database.js';
import { buildInventoryReport } from '../reporting/reportingEngine.js';
import { listAreaDeliveries } from '../areas/supplyAreaDeliveryService.js';
import { listAreas } from '../areas/areaService.js';
import { getCurrentSession } from '../admin/adminClient.js';

const root = document.getElementById('app');
const DAY = 86400000;
const BASE_WINDOWS = 3;
const ANOMALY_LIMIT = 30;
const EPS = 0.000001;
let data = null;
let sessionKey = 'local';
let busy = false;
let state = defaults();

if (root) {
  new MutationObserver(() => queueMicrotask(enhance)).observe(root, { childList: true, subtree: true });
  queueMicrotask(enhance);
}

async function enhance() {
  if (busy || !root || root.querySelector('.v8-report-builder')) return;
  const title = [...root.querySelectorAll('h1,h2')].map(n => n.textContent.trim()).find(Boolean);
  if (title !== 'Reportes') return;
  busy = true;
  try {
    const session = await getCurrentSession().catch(() => null);
    sessionKey = `${session?.workspaceId || 'workspace'}::${session?.userId || 'user'}`;
    state = loadState() || defaults();
    data = await loadData();
    draw();
  } catch (error) {
    console.warn('VIGÍA Reportes V8:', error);
  } finally {
    busy = false;
  }
}

function defaults() {
  return {
    days: 30,
    areaId: '',
    categoryId: '',
    risk: '',
    query: '',
    dimension: 'area',
    metric: 'activity',
    productId: '',
    compare: 'previous',
    blocks: { kpis:true, main:true, productArea:true, top:true, trend:true, findings:true, anomalies:true, heatmap:true, table:true }
  };
}

function normalizeState(v = {}) {
  const d = defaults();
  return { ...d, ...v, days:[7,30,90,180].includes(Number(v.days)) ? Number(v.days) : 30, blocks:{ ...d.blocks, ...(v.blocks || {}) } };
}

function stateKey() { return `vigia-report-v8:last:${sessionKey}`; }
function viewsKey() { return `vigia-report-v8:views:${sessionKey}`; }
function loadState() { try { const v = localStorage.getItem(stateKey()); return v ? normalizeState(JSON.parse(v)) : null; } catch (_) { return null; } }
function saveState() { try { localStorage.setItem(stateKey(), JSON.stringify(state)); } catch (_) {} }
function loadViews() { try { const v = JSON.parse(localStorage.getItem(viewsKey()) || '[]'); return Array.isArray(v) ? v : []; } catch (_) { return []; } }
function saveViews(v) { try { localStorage.setItem(viewsKey(), JSON.stringify(v.slice(-20))); } catch (_) {} }

async function loadData() {
  const from = new Date(Date.now() - 540 * DAY);
  const [products,categories,units,movements,areas,deliveries] = await Promise.all([
    getAll(STORES.PRODUCTS), getAll(STORES.CATEGORIES), getAll(STORES.UNITS), getAll(STORES.MOVEMENTS),
    listAreas({ includeInactive:true, refresh:navigator.onLine }).catch(() => getAll(STORES.AREAS)),
    listAreaDeliveries({ from, refresh:navigator.onLine }).catch(() => getAll(STORES.SUPPLY_AREA_DELIVERIES))
  ]);
  const activeProducts = products.filter(p => p.active !== false);
  const reversed = new Set(movements.filter(m => m.type === 'REVERSAL' && m.reversedMovementId).map(m => m.reversedMovementId));
  const validSupplyKeys = new Set(movements.filter(m => m.type === 'SUPPLY' && m.voided !== true && !reversed.has(m.id)).map(m => `${m.documentId}::${m.productId}`));
  return {
    products: activeProducts,
    categories,
    units,
    movements,
    areas: areas.filter(a => a.active !== false),
    deliveries: deliveries.filter(d => d.status === 'CLOSED'),
    inventory: buildInventoryReport(activeProducts, movements),
    reversed,
    validSupplyKeys
  };
}

function model() {
  const now = new Date();
  const from = new Date(now.getTime() - state.days * DAY);
  const prevFrom = new Date(from.getTime() - state.days * DAY);
  const prevTo = new Date(from.getTime() - 1);
  const categoryById = new Map(data.categories.map(x => [x.id,x]));
  const unitById = new Map(data.units.map(x => [x.id,x]));
  const invById = new Map(data.inventory.map(x => [x.productId,x]));
  const productById = new Map(data.products.map(x => [x.id,x]));
  const products = data.products.filter(p => {
    const inv = invById.get(p.id);
    if (state.categoryId && p.categoryId !== state.categoryId) return false;
    if (state.risk && inv?.riskLevel !== state.risk) return false;
    if (state.query) {
      const h = [p.name,p.saintCode,p.sku,p.barcode].filter(Boolean).join(' ').toLowerCase();
      if (!h.includes(state.query.trim().toLowerCase())) return false;
    }
    return true;
  });
  const productIds = new Set(products.map(p => p.id));
  const currentSupply = supplies(from,now).filter(m => productIds.has(m.productId));
  const previousSupply = supplies(prevFrom,prevTo).filter(m => productIds.has(m.productId));
  const currentAreas = areaDeliveries(from,now,productIds,state.areaId);
  const previousAreas = areaDeliveries(prevFrom,prevTo,productIds,state.areaId);
  const productStats = buildProductStats(products,currentSupply,previousSupply,currentAreas,previousAreas,invById,unitById,categoryById);
  const areaStats = buildAreaStats(currentAreas);
  const productArea = buildProductArea(products,currentAreas,previousAreas,unitById,from);
  const anomalies = buildAnomalies(products,unitById,from,productIds);
  const metric = resolveMetric(productStats);
  const grouped = buildGroups(productStats,areaStats,productArea,metric);
  const trend = buildTrend(currentSupply,productStats,unitById,from,now);
  const heatmap = buildHeatmap(currentAreas,productById,categoryById);
  const tracked = currentAreas.reduce((s,d) => s + (d.rows || []).length,0);
  return { now,from,products,productStats,areaStats,productArea,anomalies,metric,grouped,trend,heatmap,tracked,categoryById };
}

function supplies(from,to) {
  const a=from.getTime(), b=to.getTime();
  return data.movements.filter(m => {
    if (m.type !== 'SUPPLY' || m.voided === true || data.reversed.has(m.id)) return false;
    const t = new Date(m.effectiveAt || m.createdAt).getTime();
    return Number.isFinite(t) && t >= a && t <= b;
  });
}

function areaDeliveries(from,to,productIds,areaId='') {
  const a=from.getTime(), b=to.getTime();
  return data.deliveries.map(d => {
    const t = new Date(d.closedAt || d.updatedAt || d.createdAt).getTime();
    if (!Number.isFinite(t) || t<a || t>b) return null;
    const rows=(d.rows || []).filter(r => productIds.has(r.productId) && data.validSupplyKeys.has(`${d.deliveryId}::${r.productId}`)).map(r => ({ ...r, allocations:(r.allocations || []).filter(x => !areaId || x.areaId===areaId) })).filter(r => r.allocations.length);
    return rows.length ? { ...d, rows } : null;
  }).filter(Boolean);
}

function supplyMap(rows) {
  const out=new Map();
  for (const m of rows) {
    const x=out.get(m.productId) || { quantity:0, movements:0 };
    x.quantity += pos(m.quantity); x.movements += 1; out.set(m.productId,x);
  }
  return out;
}

function areaProductMap(rows) {
  const out=new Map();
  for (const d of rows) for (const r of d.rows || []) {
    const x=out.get(r.productId) || { quantity:0, movements:0 };
    x.quantity += (r.allocations || []).reduce((s,a) => s + pos(a.quantity),0);
    x.movements += (r.allocations || []).length ? 1 : 0;
    out.set(r.productId,x);
  }
  return out;
}

function buildProductStats(products,currentSupply,previousSupply,currentAreas,previousAreas,invById,unitById,categoryById) {
  const current = state.areaId ? areaProductMap(currentAreas) : supplyMap(currentSupply);
  const previous = state.areaId ? areaProductMap(previousAreas) : supplyMap(previousSupply);
  return products.map(p => {
    const c=current.get(p.id)||{quantity:0,movements:0}, old=previous.get(p.id)||{quantity:0,movements:0}, inv=invById.get(p.id)||{};
    const trend = old.quantity>EPS ? ((c.quantity-old.quantity)/old.quantity)*100 : c.quantity>EPS ? null : 0;
    return {
      product:p, id:p.id, name:p.name, saintCode:p.saintCode||'', sku:p.sku||'', categoryId:p.categoryId||'',
      category:categoryById.get(p.categoryId)?.name || 'Sin categoría', unit:unitById.get(p.inventoryUnitId)?.code || p.inventoryUnitId || 'UND',
      stock:Number(inv.stock||0), risk:inv.riskLevel||'GOOD', quantity:c.quantity, movements:c.movements, previous:old.quantity, trend
    };
  });
}

function buildAreaStats(deliveries) {
  const out=new Map();
  for (const d of deliveries) for (const r of d.rows || []) for (const a of r.allocations || []) {
    const x=out.get(a.areaId)||{ id:a.areaId,name:a.areaName||a.areaId,lines:0,products:new Set() };
    x.lines += 1; x.products.add(r.productId); out.set(a.areaId,x);
  }
  return [...out.values()].sort((a,b)=>b.lines-a.lines || a.name.localeCompare(b.name,'es'));
}

function productAreaTotals(productId,deliveries) {
  const out=new Map();
  for (const d of deliveries) for (const r of d.rows || []) if (r.productId===productId) for (const a of r.allocations || []) out.set(a.areaId,(out.get(a.areaId)||0)+pos(a.quantity));
  return out;
}

function baselineForProduct(productId,from) {
  const width=state.days*DAY, out=new Map(), ids=new Set([productId]);
  for (let i=0;i<BASE_WINDOWS;i++) {
    const to=new Date(from.getTime()-1-i*width), start=new Date(to.getTime()-width+1), totals=productAreaTotals(productId,areaDeliveries(start,to,ids,''));
    for (const area of data.areas) { const arr=out.get(area.id)||[]; arr.push(totals.get(area.id)||0); out.set(area.id,arr); }
  }
  const result=new Map();
  for (const [id,arr] of out) {
    if (arr.filter(v=>v>EPS).length < 2) continue;
    result.set(id,{ average:arr.reduce((s,v)=>s+v,0)/arr.length, windows:arr.length });
  }
  return result;
}

function buildProductArea(products,current,previous,unitById,from) {
  let p=products.find(x=>x.id===state.productId);
  if (!p) {
    p=products.find(x=>current.some(d=>(d.rows||[]).some(r=>r.productId===x.id))) || products[0] || null;
    if (p) state.productId=p.id;
  }
  if (!p) return null;
  const c=productAreaTotals(p.id,current), old=productAreaTotals(p.id,previous), base=baselineForProduct(p.id,from), names=new Map(data.areas.map(a=>[a.id,a.name]));
  const ids=new Set([...c.keys(),...old.keys(),...base.keys()]);
  const rows=[...ids].filter(id=>!state.areaId||id===state.areaId).map(id=>{
    const currentQty=c.get(id)||0, previousQty=old.get(id)||0, br=base.get(id)||null, compare=state.compare==='normal' ? br?.average ?? null : previousQty;
    return { id,name:names.get(id)||id,current:currentQty,previous:previousQty,base:br?.average??null,windows:br?.windows||0,compare,delta:compare!==null&&compare>EPS?((currentQty-compare)/compare)*100:(compare===0&&currentQty===0?0:null) };
  }).sort((a,b)=>b.current-a.current||a.name.localeCompare(b.name,'es'));
  return { product:p,unit:unitById.get(p.inventoryUnitId)?.code||p.inventoryUnitId||'UND',rows,total:rows.reduce((s,r)=>s+r.current,0) };
}

function buildAnomalies(products,unitById,from,productIds) {
  const width=state.days*DAY, current=new Map(), history=new Map(), start=from.getTime();
  for (const d of data.deliveries) {
    if (d.status!=='CLOSED') continue;
    const t=new Date(d.closedAt||d.updatedAt||d.createdAt).getTime();
    if (!Number.isFinite(t)) continue;
    let bucket=null;
    if (t>=start && t<=Date.now()) bucket=-1;
    else if (t<start) { const i=Math.floor((start-1-t)/width); if (i>=0&&i<BASE_WINDOWS) bucket=i; }
    if (bucket===null) continue;
    for (const r of d.rows||[]) {
      if (!productIds.has(r.productId) || !data.validSupplyKeys.has(`${d.deliveryId}::${r.productId}`)) continue;
      for (const a of r.allocations||[]) {
        if (state.areaId && a.areaId!==state.areaId) continue;
        const key=`${r.productId}::${a.areaId}`, q=pos(a.quantity);
        if (bucket===-1) current.set(key,(current.get(key)||0)+q);
        else { const arr=history.get(key)||Array(BASE_WINDOWS).fill(0); arr[bucket]+=q; history.set(key,arr); }
      }
    }
  }
  const pmap=new Map(products.map(p=>[p.id,p])), amap=new Map(data.areas.map(a=>[a.id,a]));
  const out=[];
  for (const [key,arr] of history) {
    if (arr.filter(v=>v>EPS).length<2) continue;
    const [pid,aid]=key.split('::'), p=pmap.get(pid); if (!p) continue;
    const avg=arr.reduce((s,v)=>s+v,0)/arr.length; if (avg<=EPS) continue;
    const q=current.get(key)||0, delta=((q-avg)/avg)*100; if (Math.abs(delta)<ANOMALY_LIMIT) continue;
    out.push({ product:p,area:amap.get(aid)?.name||aid,current:q,avg,delta,unit:unitById.get(p.inventoryUnitId)?.code||p.inventoryUnitId||'UND' });
  }
  return out.sort((a,b)=>Math.abs(b.delta)-Math.abs(a.delta)).slice(0,12);
}

function resolveMetric(stats) {
  const units=new Set(stats.filter(x=>x.quantity>EPS||x.stock>EPS).map(x=>x.unit));
  if ((state.metric==='quantity'||state.metric==='stock') && units.size>1 && stats.length>1) return { requested:state.metric,actual:state.metric==='stock'?'products':'activity',warning:'La selección mezcla unidades incompatibles. VIGÍA evita sumarlas y usa una métrica comparable.' };
  return { requested:state.metric,actual:state.metric,warning:'' };
}

function statValue(x,m) { return m==='quantity'?x.quantity:m==='movements'?x.movements:m==='stock'?x.stock:m==='trend'?Math.abs(Number(x.trend||0)):m==='products'?(x.quantity>EPS||x.movements?1:0):x.movements; }
function metricUnit(m) { return m==='trend'?'%':m==='products'?'productos':m==='activity'?'líneas':'mov.'; }

function buildGroups(stats,areas,productArea,metric) {
  const m=metric.actual;
  if (state.dimension==='area') return areas.map(a=>({ label:a.name,value:m==='quantity'&&state.productId?(productArea?.rows.find(r=>r.id===a.id)?.current||0):a.lines,unit:m==='quantity'&&state.productId?(productArea?.unit||'UND'):'líneas' })).sort((a,b)=>b.value-a.value).slice(0,10);
  if (state.dimension==='category') {
    const map=new Map(); for (const x of stats) map.set(x.category,(map.get(x.category)||0)+statValue(x,m));
    return [...map].map(([label,value])=>({label,value,unit:metricUnit(m)})).sort((a,b)=>b.value-a.value).slice(0,10);
  }
  return stats.map(x=>({label:x.name,value:statValue(x,m),unit:(m==='quantity'||m==='stock')?x.unit:metricUnit(m)})).sort((a,b)=>b.value-a.value).slice(0,10);
}

function buildTrend(currentSupply,stats,unitById,from,now) {
  const buckets=10, span=Math.max(DAY,now.getTime()-from.getTime()), width=span/buckets, rows=Array.from({length:buckets},()=>0), p=stats.find(x=>x.id===state.productId);
  const useQuantity=Boolean(p);
  for (const m of currentSupply) {
    if (useQuantity && m.productId!==p.id) continue;
    const t=new Date(m.effectiveAt||m.createdAt).getTime(), i=Math.min(buckets-1,Math.max(0,Math.floor((t-from.getTime())/width)));
    rows[i]+=useQuantity?pos(m.quantity):1;
  }
  return { rows,label:useQuantity?`Cantidad de ${p.name}`:'Movimientos de surtido',unit:useQuantity?p.unit:'mov.' };
}

function buildHeatmap(deliveries,productById,categoryById) {
  const areas=new Map(data.areas.map(a=>[a.id,a.name])), categories=new Map();
  for (const d of deliveries) for (const r of d.rows||[]) {
    const p=productById.get(r.productId), cat=categoryById.get(p?.categoryId)?.name||'Sin categoría';
    if (!categories.has(cat)) categories.set(cat,new Map()); const row=categories.get(cat);
    for (const a of r.allocations||[]) { row.set(a.areaId,(row.get(a.areaId)||0)+1); if (!areas.has(a.areaId)) areas.set(a.areaId,a.areaName||a.areaId); }
  }
  return { areaIds:[...areas.keys()],areaNames:areas,rows:[...categories].map(([name,values])=>({name,values})).sort((a,b)=>sumMap(b.values)-sumMap(a.values)).slice(0,10) };
}

function draw() {
  const m=model(), categories=data.categories.filter(x=>x.active!==false).sort(byName), products=data.products.slice().sort(byName), areas=data.areas.slice().sort((a,b)=>Number(a.sortOrder||0)-Number(b.sortOrder||0)||byName(a,b)), views=loadViews();
  root.innerHTML=`
  <span class="v7-area-report" hidden></span>
  <section class="v8-report-builder">
    <section class="hero dashboard-hero v8-report-hero"><div><div class="v8-report-eyebrow">V8 · ANÁLISIS OPERATIVO</div><h2>Reportes</h2><p>Tú decides qué quieres ver. VIGÍA cruza stock, surtidos, áreas y tendencias sin usar precios ni dinero.</p></div><div class="v8-report-hero-actions"><select data-v8-view><option value="">Mis vistas guardadas</option>${views.map(v=>opt(v.id,v.name,'')).join('')}</select><button class="secondary" data-v8-export>↓ Exportar CSV</button><button class="primary" data-v8-save>Guardar vista</button></div></section>
    <div class="v8-report-layout">
      <aside class="card v8-builder-panel">
        <div class="v8-builder-head"><strong>⚙ Constructor de reporte</strong><small>Cada usuario arma su propia vista.</small></div>
        <div class="v8-builder-section"><span class="v8-builder-label">Vista rápida</span><div class="v8-presets">${preset('general','General')}${preset('areas','Áreas')}${preset('productArea','Producto ↔ Área')}${preset('stock','Stock')}${preset('movements','Movimientos')}</div></div>
        <div class="v8-builder-section v8-filter-grid">
          <label>Periodo<select data-v8-filter="days">${opt(7,'7 días',state.days)}${opt(30,'30 días',state.days)}${opt(90,'90 días',state.days)}${opt(180,'180 días',state.days)}</select></label>
          <label>Área<select data-v8-filter="areaId"><option value="">Todas</option>${areas.map(a=>opt(a.id,a.name,state.areaId)).join('')}</select></label>
          <label>Categoría<select data-v8-filter="categoryId"><option value="">Todas</option>${categories.map(c=>opt(c.id,c.name,state.categoryId)).join('')}</select></label>
          <label>Estado stock<select data-v8-filter="risk">${opt('','Todos',state.risk)}${opt('CRITICAL','Crítico',state.risk)}${opt('LOW','Bajo',state.risk)}${opt('GOOD','OK',state.risk)}</select></label>
          <label class="v8-filter-wide">Producto<input data-v8-filter="query" value="${esc(state.query)}" placeholder="Nombre, código SAINT o SKU..."></label>
        </div>
        <div class="v8-builder-section"><span class="v8-builder-label">Qué quiero ver</span><div class="v8-block-checks">${Object.entries({kpis:'Indicadores',main:'Gráfico principal',productArea:'Producto ↔ Área',top:'Top productos',trend:'Tendencia',findings:'Hallazgos',anomalies:'Desviaciones',heatmap:'Mapa actividad',table:'Tabla detalle'}).map(([k,v])=>check(k,v)).join('')}</div></div>
        <div class="v8-builder-section v8-filter-grid"><label>Agrupar<select data-v8-filter="dimension">${opt('area','Área',state.dimension)}${opt('category','Categoría',state.dimension)}${opt('product','Producto',state.dimension)}</select></label><label>Métrica<select data-v8-filter="metric">${opt('activity','Actividad / líneas',state.metric)}${opt('quantity','Cantidad surtida',state.metric)}${opt('movements','Movimientos',state.metric)}${opt('stock','Stock actual',state.metric)}${opt('trend','Tendencia',state.metric)}</select></label></div>
        <div class="v8-builder-section"><div class="v8-builder-note"><strong>Sin sumas absurdas.</strong> Si mezclas KG, L, UND u otras unidades, VIGÍA no suma cantidades incompatibles: cambia a actividad o movimientos y te avisa.</div></div>
      </aside>
      <section class="v8-report-canvas">
        ${askCard()}${activeFilters(m)}${state.blocks.kpis?kpis(m):''}${state.blocks.productArea?productAreaCard(m,products):''}
        ${(state.blocks.main||state.blocks.top)?`<div class="v8-grid-2">${state.blocks.main?mainChart(m):''}${state.blocks.top?topProducts(m):''}</div>`:''}
        ${(state.blocks.trend||state.blocks.findings)?`<div class="v8-grid-2">${state.blocks.trend?trendCard(m):''}${state.blocks.findings?findings(m):''}</div>`:''}
        ${state.blocks.anomalies?anomalyCard(m):''}${state.blocks.heatmap?heatmapCard(m):''}${state.blocks.table?tableCard(m):''}
      </section>
    </div>
    <dialog class="v8-save-dialog" data-v8-dialog><form method="dialog" class="v8-save-dialog-card"><h3>Guardar esta vista</h3><p>Solo guarda filtros y diseño de tu reporte; no modifica inventario.</p><label>Nombre<input data-v8-name maxlength="80" placeholder="Ej. Reporte semanal de áreas"></label><div class="v8-dialog-actions"><button class="secondary" value="cancel">Cancelar</button><button class="primary" data-v8-save-confirm>Guardar</button></div></form></dialog>
  </section>`;
  bind();
}

function askCard(){return `<article class="v8-ask-card"><div class="v8-ask-head"><span class="v8-ask-orb">V</span><div><strong>Pregúntale a VIGÍA</strong><small>Interpreta consultas operativas y acomoda el reporte.</small></div></div><div class="v8-ask-row"><input data-v8-question placeholder="Ej. ¿Qué área consumió más jabón en los últimos 30 días?"><button data-v8-ask>Analizar</button></div><div class="v8-ask-suggestions"><button data-q="Qué área consumió más jabón">Qué área consumió más jabón</button><button data-q="Muéstrame solo stock crítico">Solo stock crítico</button><button data-q="Qué productos subieron más">Qué productos subieron más</button><button data-q="Qué se movió más esta semana">Qué se movió más</button></div><div class="v8-smart-answer" data-v8-answer hidden></div></article>`;}
function activeFilters(m){const area=data.areas.find(a=>a.id===state.areaId)?.name||'Todas',cat=m.categoryById.get(state.categoryId)?.name||'Todas';return `<div class="v8-active-filters"><strong>Vista actual:</strong>${chip('Periodo',`${state.days} días`)}${chip('Área',area)}${chip('Categoría',cat)}${chip('Stock',riskLabel(state.risk))}${state.query?chip('Producto',state.query):''}${m.metric.warning?`<span class="v8-metric-warning">⚠ ${esc(m.metric.warning)}</span>`:''}</div>`;}
function kpis(m){const withSupply=m.productStats.filter(x=>x.movements>0).length,top=m.areaStats[0],crit=m.productStats.filter(x=>x.risk==='CRITICAL').length;return `<div class="v8-kpis">${kpi('Productos con surtido',withSupply,`${m.productStats.reduce((s,x)=>s+x.movements,0)} movimientos`)}${kpi('Surtidos registrados',m.productStats.reduce((s,x)=>s+x.movements,0),`${state.days} días`)}${kpi('Área más activa',top?.name||'Sin datos',top?`${top.lines} líneas asignadas`:'Aún sin datos V7')}${kpi('Productos críticos',crit,'Según stock y política VIGÍA')}</div>`;}
function productAreaCard(m,products){const pa=m.productArea;return `<article class="card v8-product-area-card"><div class="section-head"><div><div class="v8-report-eyebrow">PRODUCTO ↔ ÁREA</div><h3>¿Qué área está consumiendo este producto?</h3><p>Distribuciones reales guardadas desde Surtido.</p></div><span class="badge">Drill-down</span></div><div class="v8-product-area-toolbar"><label>Producto<select data-v8-product>${products.map(p=>opt(p.id,`${p.name}${p.saintCode?` · SAINT ${p.saintCode}`:''}`,state.productId)).join('')}</select></label><label>Comparar contra<select data-v8-compare>${opt('previous','Período anterior',state.compare)}${opt('normal','Patrón normal',state.compare)}</select></label></div>${pa&&pa.rows.length?`<div class="v8-pa-kpis">${kpi('Área que más consume',pa.rows[0].name,'')}${kpi('Cantidad en esa área',`${fmt(pa.rows[0].current)} ${pa.unit}`,'')}${kpi('Participación',pa.total>EPS?`${fmt(pa.rows[0].current/pa.total*100)}%`:'—','')}${kpi('Cambio',delta(pa.rows[0].delta),state.compare==='normal'?`${pa.rows[0].windows} ventanas de referencia`:'vs período anterior')}</div><div class="v8-pa-layout"><div>${bars(pa.rows.map(r=>({label:r.name,value:r.current,unit:pa.unit})))}</div><div class="v8-pa-table-wrap"><table class="v8-mini-table"><thead><tr><th>Área</th><th>Actual</th><th>Comparación</th><th>Cambio</th><th>% total</th></tr></thead><tbody>${pa.rows.map(r=>`<tr><td><strong>${esc(r.name)}</strong></td><td>${fmt(r.current)} ${esc(pa.unit)}</td><td>${r.compare===null?'Sin base':`${fmt(r.compare)} ${esc(pa.unit)}`}</td><td class="${deltaClass(r.delta)}">${delta(r.delta)}</td><td>${pa.total>EPS?fmt(r.current/pa.total*100):'0'}%</td></tr>`).join('')}</tbody></table></div></div><div class="v8-pa-insight">${paInsight(pa)}</div>`:`<div class="empty compact-empty">Este producto todavía no tiene distribución por áreas en el período seleccionado. Los surtidos anteriores a V7 no se inventan retroactivamente.</div>`}</article>`;}
function mainChart(m){return `<article class="card"><div class="section-head"><div><h3>${esc(metricTitle(m.metric.actual))} por ${{area:'área',category:'categoría',product:'producto'}[state.dimension]}</h3><p>${esc(m.metric.warning||'Comparación según tus filtros actuales.')}</p></div><span class="badge">${esc(metricTitle(m.metric.actual))}</span></div>${bars(m.grouped)}</article>`;}
function topProducts(m){const rows=m.productStats.slice().sort((a,b)=>b.movements-a.movements||b.quantity-a.quantity).slice(0,7);return `<article class="card"><div class="section-head"><div><h3>Top productos</h3><p>Ordenados por actividad de surtido, sin mezclar unidades.</p></div><span class="badge">Dinámico</span></div><div class="v8-smart-list">${rows.length?rows.map((x,i)=>smart(i+1,x.name,`${x.category} · ${fmt(x.quantity)} ${x.unit}`,`${x.movements} mov.`)).join(''):'<div class="empty compact-empty">Sin surtidos.</div>'}</div></article>`;}
function trendCard(m){const max=Math.max(1,...m.trend.rows);return `<article class="card"><div class="section-head"><div><h3>Tendencia</h3><p>${esc(m.trend.label)}</p></div><span class="badge">${state.days} días</span></div><div class="v8-trend-chart">${m.trend.rows.map((v,i)=>`<span class="v8-trend-bar" title="${fmt(v)} ${esc(m.trend.unit)}"><i style="height:${Math.max(4,v/max*100)}%"></i><small>${i+1}</small></span>`).join('')}</div></article>`;}
function findings(m){const top=m.areaStats[0],rise=m.productStats.filter(x=>x.trend!==null&&x.trend>20&&x.quantity>EPS).sort((a,b)=>b.trend-a.trend)[0];return `<article class="card"><div class="section-head"><div><h3>Hallazgos inteligentes</h3><p>VIGÍA señala; el humano decide.</p></div><span class="badge">Reglas</span></div><div class="v8-smart-list">${smart('!',`${m.productStats.filter(x=>x.risk==='CRITICAL').length} productos críticos`,'Según stock y política actual','Revisar')}${smart('↗',rise?.name||'Sin aumento fuerte',rise?`Subió ${fmt(rise.trend)}% vs período anterior`:'Sin base suficiente',rise?'Subiendo':'OK')}${smart('A',top?.name||'Sin actividad por áreas',top?`${top.lines} asignaciones`:'Aún sin datos V7',top?'Área #1':'—')}${smart('✓',`${m.tracked} líneas con área`,'Solo distribuciones realmente registradas','Trazable')}</div></article>`;}
function anomalyCard(m){return `<article class="card"><div class="section-head"><div><div class="v8-report-eyebrow">DETECTOR</div><h3>Desviaciones contra el consumo normal</h3><p>Producto + área comparados con ventanas históricas equivalentes.</p></div><span class="badge">±${ANOMALY_LIMIT}%</span></div>${m.anomalies.length?`<div class="v8-anomaly-list">${m.anomalies.map(x=>`<div class="v8-anomaly-row"><span class="v8-anomaly-icon ${x.delta>0?'high':'low'}">${x.delta>0?'↑':'↓'}</span><div><strong>${esc(x.product.name)} · ${esc(x.area)}</strong><small>${fmt(x.current)} ${esc(x.unit)} actual · patrón ${fmt(x.avg)} ${esc(x.unit)}</small></div><strong class="${deltaClass(x.delta)}">${delta(x.delta)}</strong></div>`).join('')}</div>`:`<div class="v8-baseline-empty"><strong>Sin base suficiente para declarar anomalías.</strong><span>VIGÍA necesita historial válido de surtidos por área en varias ventanas equivalentes. No inventa un patrón normal.</span></div>`}</article>`;}
function heatmapCard(m){const h=m.heatmap;if(!h.rows.length||!h.areaIds.length)return `<article class="card"><div class="section-head"><div><h3>Mapa de actividad</h3><p>Área × categoría.</p></div></div><div class="empty compact-empty">Todavía no hay suficientes distribuciones por áreas.</div></article>`;const max=Math.max(1,...h.rows.flatMap(r=>h.areaIds.map(id=>r.values.get(id)||0)));return `<article class="card"><div class="section-head"><div><h3>Mapa de actividad</h3><p>Área × categoría. Más intensidad = más líneas registradas.</p></div><span class="badge">Operativo</span></div><div class="v8-heatmap" style="--v8-area-count:${h.areaIds.length}"><span></span>${h.areaIds.map(id=>`<strong>${esc(h.areaNames.get(id)||id)}</strong>`).join('')}${h.rows.map(r=>`<span class="v8-heat-row-name">${esc(r.name)}</span>${h.areaIds.map(id=>{const v=r.values.get(id)||0,a=.08+.58*v/max;return `<span class="v8-heat-cell" style="background:rgba(47,111,237,${a.toFixed(2)})">${v}</span>`}).join('')}`).join('')}</div></article>`;}
function tableCard(m){const rows=m.productStats.slice().sort((a,b)=>b.movements-a.movements||b.quantity-a.quantity||a.name.localeCompare(b.name,'es'));return `<article class="card v8-table-card"><div class="section-head"><div><h3>Detalle de productos</h3><p>Todos los productos que coinciden con tus filtros.</p></div><span class="badge">${rows.length}</span></div><div class="v8-table-scroll"><table class="v8-report-table"><thead><tr><th>Producto</th><th>Categoría</th><th>Stock actual</th><th>Surtido</th><th>Movimientos</th><th>Tendencia</th><th>Estado</th></tr></thead><tbody>${rows.map(x=>`<tr><td><strong>${esc(x.name)}</strong><small>${esc([x.saintCode?`SAINT ${x.saintCode}`:'',x.sku?`SKU ${x.sku}`:''].filter(Boolean).join(' · '))}</small></td><td>${esc(x.category)}</td><td>${fmt(x.stock)} ${esc(x.unit)}</td><td>${fmt(x.quantity)} ${esc(x.unit)}</td><td>${x.movements}</td><td class="${deltaClass(x.trend)}">${delta(x.trend)}</td><td><span class="badge ${riskClass(x.risk)}">${riskLabel(x.risk)}</span></td></tr>`).join('')}</tbody></table></div></article>`;}
function bars(rows){if(!rows.length)return '<div class="empty compact-empty">Sin datos para esta vista.</div>';const max=Math.max(1,...rows.map(x=>Number(x.value||0)));return `<div class="v8-bar-list">${rows.map((x,i)=>`<div class="v8-bar-row"><span class="v8-rank">${i+1}</span><div><strong>${esc(x.label)}</strong><span class="v8-bar-track"><i style="width:${Math.max(2,Number(x.value||0)/max*100)}%"></i></span></div><strong>${fmt(x.value)} ${esc(x.unit||'')}</strong></div>`).join('')}</div>`;}
function paInsight(pa){const x=pa.rows[0],share=pa.total>EPS?x.current/pa.total*100:0,base=state.compare==='normal'?'su patrón normal':'el período anterior',d=x.delta===null?'No hay base suficiente para comparar todavía.':`Está ${fmt(Math.abs(x.delta))}% ${x.delta>=0?'por encima':'por debajo'} de ${base}.`;return `<strong>${esc(x.name)}</strong> concentra ${fmt(share)}% del consumo registrado de <strong>${esc(pa.product.name)}</strong>. ${d}`;}

function bind(){
  root.querySelectorAll('[data-v8-filter]').forEach(el=>el.addEventListener(el.tagName==='INPUT'?'input':'change',()=>{const k=el.dataset.v8Filter;state[k]=k==='days'?Number(el.value):el.value;saveState();draw()}));
  root.querySelectorAll('[data-v8-block]').forEach(el=>el.addEventListener('change',()=>{state.blocks[el.dataset.v8Block]=el.checked;saveState();draw()}));
  root.querySelectorAll('[data-v8-preset]').forEach(el=>el.addEventListener('click',()=>applyPreset(el.dataset.v8Preset)));
  root.querySelector('[data-v8-product]')?.addEventListener('change',e=>{state.productId=e.target.value;state.dimension='area';state.metric='quantity';saveState();draw()});
  root.querySelector('[data-v8-compare]')?.addEventListener('change',e=>{state.compare=e.target.value;saveState();draw()});
  root.querySelector('[data-v8-ask]')?.addEventListener('click',ask);
  root.querySelector('[data-v8-question]')?.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();ask()}});
  root.querySelectorAll('[data-q]').forEach(b=>b.addEventListener('click',()=>{root.querySelector('[data-v8-question]').value=b.dataset.q;ask()}));
  root.querySelector('[data-v8-save]')?.addEventListener('click',()=>root.querySelector('[data-v8-dialog]')?.showModal());
  root.querySelector('[data-v8-save-confirm]')?.addEventListener('click',e=>{e.preventDefault();saveView()});
  root.querySelector('[data-v8-view]')?.addEventListener('change',e=>loadView(e.target.value));
  root.querySelector('[data-v8-export]')?.addEventListener('click',exportCsv);
}

function applyPreset(name){const off=Object.fromEntries(Object.keys(state.blocks).map(k=>[k,false]));if(name==='areas')state={...state,dimension:'area',metric:'activity',blocks:{...off,kpis:true,main:true,productArea:true,anomalies:true,heatmap:true,findings:true}};else if(name==='productArea')state={...state,dimension:'area',metric:'quantity',blocks:{...off,kpis:true,productArea:true,anomalies:true,trend:true,table:true,findings:true}};else if(name==='stock')state={...state,dimension:'category',metric:'stock',blocks:{...off,kpis:true,main:true,table:true,findings:true}};else if(name==='movements')state={...state,dimension:'category',metric:'movements',blocks:{...off,kpis:true,main:true,top:true,trend:true,table:true}};else state={...state,dimension:'area',metric:'activity',blocks:Object.fromEntries(Object.keys(state.blocks).map(k=>[k,true]))};saveState();draw();}

function ask(){const input=root.querySelector('[data-v8-question]'),raw=input?.value.trim();if(!raw)return;const text=norm(raw),matches=findProducts(text),p=matches.length===1?matches[0]:null;if(p)state.productId=p.id;if(/7 dias|semana/.test(text))state.days=7;if(/90 dias|trimestre/.test(text))state.days=90;if(/180 dias|6 meses/.test(text))state.days=180;if(/30 dias|mes/.test(text))state.days=30;if(text.includes('stock')&&text.includes('critic')){state.risk='CRITICAL';state.dimension='category';state.metric='stock'}else if(text.includes('area')&&p){state.dimension='area';state.metric='quantity'}else if(text.includes('mov'))state.metric='movements';else if(text.includes('sub')||text.includes('aument')){state.dimension='product';state.metric='trend'}saveState();const m=model(),answer=answerQuestion(text,p,m,matches);draw();const box=root.querySelector('[data-v8-answer]'),next=root.querySelector('[data-v8-question]');if(next)next.value=raw;if(box){box.innerHTML=answer;box.hidden=false}}
function answerQuestion(text,p,m,matches){if(text.includes('area')&&matches.length>1&&!p)return `Encontré <strong>${matches.length} productos</strong> que coinciden con tu consulta. Elige el producto exacto en <strong>Producto ↔ Área</strong> para no adivinar.`;if(text.includes('area')&&p){const pa=m.productArea;if(!pa?.rows.length)return `No hay distribución por áreas registrada para <strong>${esc(p.name)}</strong> en este período.`;const x=pa.rows[0];return `<strong>${esc(x.name)}</strong> es el área con mayor consumo registrado de <strong>${esc(p.name)}</strong>: ${fmt(x.current)} ${esc(pa.unit)}.`}if(text.includes('stock')&&text.includes('critic'))return `La vista quedó filtrada a <strong>${m.productStats.filter(x=>x.risk==='CRITICAL').length} productos críticos</strong>.`;if(text.includes('sub')||text.includes('aument')){const x=m.productStats.filter(x=>x.trend!==null).sort((a,b)=>Number(b.trend||0)-Number(a.trend||0))[0];return x?`<strong>${esc(x.name)}</strong> muestra el mayor aumento medible: ${delta(x.trend)}.`:'No hay base suficiente para comparar tendencias.'}return `Encontré <strong>${m.products.length}</strong> productos con los filtros actuales.`}
function findProducts(text){const exact=data.products.filter(p=>{const n=norm(p.name);return n.length>=5&&text.includes(n)});if(exact.length)return exact;const words=new Set(text.split(/\s+/).filter(w=>w.length>=4));return data.products.filter(p=>norm(p.name).split(/\s+/).some(w=>w.length>=4&&words.has(w))).slice(0,12)}

function saveView(){const input=root.querySelector('[data-v8-name]'),name=input?.value.trim();if(!name){input?.focus();return}const views=loadViews();views.push({id:`view_${Date.now()}`,name,state:JSON.parse(JSON.stringify(state)),createdAt:new Date().toISOString()});saveViews(views);root.querySelector('[data-v8-dialog]')?.close();toast(`Vista “${name}” guardada`);draw()}
function loadView(id){if(!id)return;const v=loadViews().find(x=>x.id===id);if(!v)return;state=normalizeState(v.state);saveState();draw()}
function exportCsv(){const m=model(),rows=[['Producto','Código SAINT','SKU','Categoría','Stock','Unidad','Cantidad surtida','Movimientos SUPPLY','Tendencia %','Estado'],...m.productStats.map(x=>[x.name,x.saintCode,x.sku,x.category,x.stock,x.unit,x.quantity,x.movements,x.trend??'',riskLabel(x.risk)])],csv=rows.map(r=>r.map(csvCell).join(',')).join('\r\n'),url=URL.createObjectURL(new Blob(['\ufeff',csv],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download=`VIGIA_reporte_${new Date().toISOString().slice(0,10)}.csv`;document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url)}

function preset(k,v){return `<button class="ghost-button" data-v8-preset="${k}" type="button">${v}</button>`}function check(k,v){return `<label><input type="checkbox" data-v8-block="${k}" ${state.blocks[k]?'checked':''}> ${v}</label>`}function opt(v,l,s){return `<option value="${esc(String(v))}" ${String(v)===String(s??'')?'selected':''}>${esc(l)}</option>`}function chip(k,v){return `<span class="v8-filter-chip">${esc(k)}: <strong>${esc(v)}</strong></span>`}function kpi(k,v,n){return `<div class="v8-kpi"><small>${esc(k)}</small><strong>${esc(String(v??'—'))}</strong>${n?`<span>${esc(n)}</span>`:''}</div>`}function smart(i,t,n,v){return `<div class="v8-smart-row"><span class="v8-rank">${esc(i)}</span><div><strong>${esc(t)}</strong><small>${esc(n)}</small></div><strong>${esc(v)}</strong></div>`}
function metricTitle(m){return {activity:'Actividad',quantity:'Cantidad surtida',movements:'Movimientos',stock:'Stock actual',trend:'Tendencia',products:'Productos con actividad'}[m]||'Actividad'}function riskLabel(v){return {CRITICAL:'Crítico',LOW:'Bajo',GOOD:'OK'}[v]||v||'Todos'}function riskClass(v){return v==='CRITICAL'?'status-danger':v==='LOW'?'status-warning':'status-good'}function delta(v){if(v===null||v===undefined||!Number.isFinite(Number(v)))return'Sin base';const n=Number(v);if(Math.abs(n)<.05)return'0%';return`${n>0?'▲':'▼'} ${fmt(Math.abs(n))}%`}function deltaClass(v){const n=Number(v);return!Number.isFinite(n)?'':n>0?'v8-delta-up':n<0?'v8-delta-down':''}function fmt(v){return new Intl.NumberFormat('es-VE',{maximumFractionDigits:2}).format(Number(v||0))}function pos(v){const n=Number(v||0);return Number.isFinite(n)&&n>0?n:0}function norm(v){return String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()}function sumMap(m){return[...m.values()].reduce((s,v)=>s+Number(v||0),0)}function byName(a,b){return String(a.name||'').localeCompare(String(b.name||''),'es')}function csvCell(v){return`"${String(v??'').replaceAll('"','""')}"`}function esc(v){return String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;')}
function toast(message){let t=document.getElementById('toast');if(!t){t=document.createElement('div');t.id='toast';t.className='toast';document.body.appendChild(t)}t.textContent=message;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2200)}
