import { evaluateNumericExpression } from '../core/mathExpression.js';
import { searchProducts } from '../catalog/catalogService.js';
import { catalogUnitCode } from '../catalog/catalogUi.js';
import { getPrimaryPresentation, normalizePresentations, quantityFromBase, quantityToBase } from '../catalog/presentationModel.js';
import { STORES, getAll } from '../storage/database.js';
import { buildInventoryReport } from '../reporting/reportingEngine.js';
import { calculatePendingInboundByProduct, changeReplenishmentStatus, REPLENISHMENT_STATUS } from '../replenishment/replenishmentService.js';
import { createProcurementLists, listProcurementLists, procurementDisplayQuantity, updateDraftProcurementLine } from '../replenishment/procurementListService.js';
import { completeProcurementExtra, isProcurementExtra } from '../replenishment/warehouseProcurementService.js';
import { createDocument } from '../documents/documentService.js';
import { DOCUMENT_TYPES } from '../documents/documentTypes.js';
import { getCurrentSession, can } from '../admin/adminClient.js';
import { syncNow } from '../sync/syncEngine.js';
import { renderWorkspace, renderReviewModal, renderManualModal, renderListModal, esc } from './procurementWorkspaceV6Render.js';
import { renderPrintModal } from './procurementWorkspaceV6Print.js';

const BUSINESS_NAME_KEY = 'vigia.procurement.businessName';
const app = document.getElementById('app');
const state = {
  enhancing:false, activeTab:'replenish', query:'', filter:'ALL',
  products:[], productsById:new Map(), categoriesById:new Map(),
  rows:[], rowsById:new Map(), drafts:new Map(), pendingExtras:[],
  lists:[], session:null, manualResults:[], manualProduct:null,
  listModalId:null, printListId:null
};

if (app) {
  const observer = new MutationObserver(() => queueMicrotask(() => enhance().catch(reportError)));
  observer.observe(app,{childList:true,subtree:true});
  document.addEventListener('click',handleClick);
  document.addEventListener('input',handleInput);
  document.addEventListener('change',handleChange);
  document.addEventListener('submit',handleSubmit);
  enhance().catch(reportError);
}

async function enhance() {
  if (state.enhancing || !isTargetView()) return;
  const layout = app.querySelector('.replenish-layout-v2');
  if (!layout) return;
  state.enhancing = true;
  try {
    let root = document.getElementById('v6ProcurementWorkspace');
    if (!root) {
      layout.innerHTML='';
      root=document.createElement('section');
      root.id='v6ProcurementWorkspace';root.className='v6p-workspace';layout.appendChild(root);
      await reload();
      paint();
    }
  } finally { state.enhancing=false; }
}

function isTargetView() {
  const h2=app?.querySelector('h2');
  return Boolean(h2 && String(h2.textContent||'').trim().toLowerCase()==='comprar / pedir');
}

async function reload() {
  const [products,movements,replenishments,categories,session]=await Promise.all([
    getAll(STORES.PRODUCTS),getAll(STORES.MOVEMENTS),getAll(STORES.REPLENISHMENTS),getAll(STORES.CATEGORIES),safeSession()
  ]);
  state.products=products.filter(p=>p.active!==false);
  state.productsById=new Map(state.products.map(p=>[p.id,p]));
  state.categoriesById=new Map(categories.map(c=>[c.id,c]));
  state.session=session;
  const pending=calculatePendingInboundByProduct(replenishments.filter(r=>!isProcurementExtra(r)));
  state.rows=buildInventoryReport(state.products,movements,{now:new Date(),pendingInboundByProduct:pending});
  state.rowsById=new Map(state.rows.map(r=>[r.productId,r]));
  state.lists=(await listProcurementLists({includeTerminal:true})).map(decorateList);
  seedDrafts();
}

function seedDrafts() {
  for (const row of state.rows) {
    if (!(Number(row.suggestedQuantity||0)>0) || state.drafts.has(row.productId)) continue;
    const product=state.productsById.get(row.productId); if (!product) continue;
    state.drafts.set(product.id,makeDraft(product,row,false));
  }
}

function makeDraft(product,row,manual=false) {
  const display=recommendedDisplay(product,Number(row?.suggestedQuantity||0));
  return {
    productId:product.id,selected:false,manual,source:manual?'MANUAL':'VIGIA_SUGGESTION',
    displayQuantity:display.quantity || (manual?1:0),displayUnit:display.unit,displayConversion:display.conversion,
    method:product.replenishmentMethod==='ORDER'?'ORDER':'PURCHASE',note:'',detailsOpen:false,noteOpen:false
  };
}

function paint() {
  const root=document.getElementById('v6ProcurementWorkspace'); if (!root) return;
  const recommendations=state.rows.filter(r=>Number(r.suggestedQuantity||0)>0);
  const visible=recommendations.filter(row=>matches(row));
  const manualRows=[...state.drafts.values()].filter(d=>d.manual && !(Number(state.rowsById.get(d.productId)?.suggestedQuantity||0)>0)).map(d=>state.rowsById.get(d.productId)||fallbackRow(d.productId));
  const selected=[...state.drafts.values()].filter(d=>d.selected);
  const purchaseCount=selected.filter(d=>d.method==='PURCHASE').length+state.pendingExtras.filter(e=>e.method==='PURCHASE').length;
  const orderCount=selected.filter(d=>d.method==='ORDER').length+state.pendingExtras.filter(e=>e.method==='ORDER').length;

  for (const row of [...visible,...manualRows]) hydrateDraftView(row);
  root.innerHTML=renderWorkspace({
    activeTab:state.activeTab,visibleRows:visible,manualRows,drafts:state.drafts,productsById:state.productsById,
    pendingExtras:state.pendingExtras,lists:state.lists,selectedCount:selected.length+state.pendingExtras.length,
    purchaseCount,orderCount,query:state.query,filter:state.filter
  });
  restoreModal();
}

function hydrateDraftView(row) {
  const product=state.productsById.get(row.productId); const draft=state.drafts.get(row.productId); if(!product||!draft)return;
  const suggested=recommendedDisplay(product,Number(row.suggestedQuantity||0));
  draft.meta=[product.saintCode?`SAINT ${product.saintCode}`:'',product.sku?`SKU ${product.sku}`:'',categoryName(product.categoryId)].filter(Boolean).join(' · ');
  draft.suggestedBaseText=`${formatNumber(row.suggestedQuantity||0)} ${catalogUnitCode(product)}`;
  draft.suggestedHumanText=suggested.conversion>1?`${formatNumber(suggested.quantity)} ${suggested.unit.toLowerCase()} x${formatNumber(suggested.conversion)}`:'Objetivo recomendado';
  draft.unitOptionsHtml=unitOptions(product,draft.displayUnit);
  draft.stockText=`${formatNumber(row.stock||0)} ${catalogUnitCode(product)}`;
  draft.pendingText=formatNumber(row.pendingInbound||0);
  draft.targetText=formatNumber(row.vigiaTargetStock??row.targetStock??0);
  draft.minText=formatNumber(row.minStock??product.minStock??0);
  draft.maxText=formatNumber(row.maxStock??product.maxStock??0);
}

function restoreModal() {
  if (state.manualProduct || state.manualResults.length) openManual(false);
  if (state.listModalId) openList(state.listModalId,false);
  if (state.printListId) openPrint(state.printListId,false);
}

async function handleClick(event) {
  const button=event.target.closest('[data-v6p-action]'); if(!button) return;
  try {
    const action=button.dataset.v6pAction;
    if(action==='switch-tab'){state.activeTab=button.dataset.tab;state.listModalId=null;state.printListId=null;paint();return;}
    if(action==='prepare-visible'||action==='select-visible'){visibleDrafts().forEach(d=>d.selected=true);paint();toast('Sugerencias visibles preparadas.');return;}
    if(action==='clear-selection'){state.drafts.forEach(d=>d.selected=false);paint();return;}
    if(action==='toggle-details'){const d=draftFromNode(button);if(d){d.detailsOpen=!d.detailsOpen;paint();}return;}
    if(action==='toggle-note'){const d=draftFromNode(button);if(d){d.noteOpen=!d.noteOpen;paint();}return;}
    if(action==='step-qty'){const d=draftFromNode(button);if(d){d.displayQuantity=Math.max(0,Number(d.displayQuantity||0)+Number(button.dataset.step||0));paint();}return;}
    if(action==='open-manual-product'){state.manualResults=[];state.manualProduct=null;openManual();return;}
    if(action==='choose-manual-product'){chooseManual(button.dataset.productId);return;}
    if(action==='confirm-manual-product'){confirmManual();return;}
    if(action==='close-manual'){close('v6pManualModal');state.manualProduct=null;state.manualResults=[];return;}
    if(action==='remove-extra'){const id=button.closest('[data-extra-id]')?.dataset.extraId;state.pendingExtras=state.pendingExtras.filter(e=>e.id!==id);paint();return;}
    if(action==='review-selection'){openReview();return;}
    if(action==='close-review'){close('v6pReviewModal');return;}
    if(action==='confirm-lists'){await confirmLists();return;}
    if(action==='open-list'){openList(button.dataset.listId);return;}
    if(action==='close-list'){close('v6pListModal');state.listModalId=null;return;}
    if(action==='open-print'){openPrint(button.dataset.listId);return;}
    if(action==='close-print'){close('v6pPrintModal');state.printListId=null;return;}
    if(action==='save-business-name'){saveBusinessName();return;}
    if(action==='browser-print'){window.print();return;}
    if(action==='save-list-edits'){await saveListEdits();return;}
    if(action==='cancel-list-line'){await cancelLine(button.closest('[data-line-id]')?.dataset.lineId);return;}
    if(action==='list-ordered'){await transitionList(button.dataset.listId,REPLENISHMENT_STATUS.ORDERED);return;}
    if(action==='list-transit'){await transitionList(button.dataset.listId,REPLENISHMENT_STATUS.IN_TRANSIT);return;}
    if(action==='receive-list-line'){await startReceipt(button.dataset.lineId);return;}
    if(action==='complete-extra-line'){await completeExtra(button.dataset.lineId);return;}
  } catch(error){reportError(error);}
}

async function handleSubmit(event) {
  if(event.target.id!=='v6pExtraForm')return;
  event.preventDefault();
  try{
    const form=new FormData(event.target);const description=String(form.get('description')||'').trim();
    const quantity=evaluateNumericExpression(form.get('quantity'));
    if(!description)throw new Error('Describe el extra');if(!(quantity>0))throw new Error('La cantidad debe ser mayor que cero');
    state.pendingExtras.push({id:crypto?.randomUUID?.()||`extra-${Date.now()}`,description,displayQuantity:quantity,requestedQuantity:quantity,unit:String(form.get('unit')||'UND').toUpperCase(),method:String(form.get('method')||'PURCHASE'),notes:String(form.get('notes')||'').trim().slice(0,180),categoryName:'EXTRAS'});
    paint();toast('Extra agregado a la próxima lista.');
  }catch(error){reportError(error);}
}

async function handleInput(event) {
  if(event.target.id==='v6pSearch'){state.query=event.target.value;paint();document.getElementById('v6pSearch')?.focus();return;}
  if(event.target.id==='v6pManualSearch'){
    const q=String(event.target.value||'').trim();state.manualResults=q.length>=2?(await searchProducts(q,{limit:8})).filter(p=>p.active!==false):[];openManual(false);const input=document.getElementById('v6pManualSearch');if(input){input.value=q;input.focus();}return;
  }
  const field=event.target.dataset.v6pField;if(!field)return;
  const draft=draftFromNode(event.target);if(!draft)return;
  if(field==='displayQuantity'){const n=looseNumber(event.target.value);if(n!==null)draft.displayQuantity=n;}
  if(field==='note')draft.note=String(event.target.value||'').trimStart().slice(0,180);
}

function handleChange(event) {
  if(event.target.id==='v6pFilter'){state.filter=event.target.value;paint();return;}
  const field=event.target.dataset.v6pField;if(!field)return;
  const draft=draftFromNode(event.target);if(!draft)return;
  if(field==='selected')draft.selected=event.target.checked;
  if(field==='method')draft.method=event.target.value;
  if(field==='displayUnit'){
    const product=state.productsById.get(draft.productId);const oldBase=Number(draft.displayQuantity||0)*Number(draft.displayConversion||1);
    const descriptor=presentationDescriptor(product,event.target.value);draft.displayUnit=descriptor.unit;draft.displayConversion=descriptor.conversion;draft.displayQuantity=round(oldBase/descriptor.conversion);
  }
  paint();
}

function openReview() {
  const selected=[...state.drafts.values()].filter(d=>d.selected);
  if(!selected.length&&!state.pendingExtras.length)return toast('Selecciona al menos un producto o extra.');
  const modal=document.getElementById('v6pReviewModal');if(!modal)return;
  modal.innerHTML=renderReviewModal({buyDrafts:selected.filter(d=>d.method==='PURCHASE'),orderDrafts:selected.filter(d=>d.method==='ORDER'),buyExtras:state.pendingExtras.filter(e=>e.method==='PURCHASE'),orderExtras:state.pendingExtras.filter(e=>e.method==='ORDER'),productName:id=>state.productsById.get(id)?.name||'Producto'});modal.classList.add('is-open');
}

function openManual(reset=true) {
  if(reset){state.manualResults=[];state.manualProduct=null;}
  const modal=document.getElementById('v6pManualModal');if(!modal)return;
  let selectedDraft=null;
  if(state.manualProduct){selectedDraft=state.drafts.get(state.manualProduct.id);hydrateDraftView(state.rowsById.get(state.manualProduct.id)||fallbackRow(state.manualProduct.id));}
  modal.innerHTML=renderManualModal({selected:state.manualProduct,results:state.manualResults,selectedDraft});modal.classList.add('is-open');
}

function chooseManual(id) {
  const product=state.productsById.get(id);if(!product)return;
  const row=state.rowsById.get(id)||fallbackRow(id);let draft=state.drafts.get(id);
  if(!draft){draft=makeDraft(product,row,true);state.drafts.set(id,draft);}draft.manual=true;draft.source='MANUAL';if(!(draft.displayQuantity>0))draft.displayQuantity=1;
  state.manualProduct=product;hydrateDraftView(row);openManual(false);
}

function confirmManual() {
  const product=state.manualProduct;if(!product)throw new Error('Selecciona un producto');const draft=state.drafts.get(product.id);if(!draft)throw new Error('Producto manual no preparado');
  const qty=evaluateNumericExpression(document.getElementById('v6pManualQty')?.value||'');if(!(qty>0))throw new Error('La cantidad debe ser mayor que cero');
  const descriptor=presentationDescriptor(product,document.getElementById('v6pManualUnit')?.value);draft.displayQuantity=qty;draft.displayUnit=descriptor.unit;draft.displayConversion=descriptor.conversion;draft.method=document.getElementById('v6pManualMethod')?.value||'PURCHASE';draft.note=String(document.getElementById('v6pManualNote')?.value||'').trim().slice(0,180);draft.manual=true;draft.source='MANUAL';draft.selected=true;
  close('v6pManualModal');state.manualProduct=null;state.manualResults=[];paint();toast(`${product.name} agregado manualmente.`);
}

async function confirmLists() {
  const selected=[...state.drafts.values()].filter(d=>d.selected);
  const lines=selected.map(d=>{
    const product=state.productsById.get(d.productId);const row=state.rowsById.get(d.productId)||fallbackRow(d.productId);
    const requested=quantityToBase(Number(d.displayQuantity||0),{conversion:Number(d.displayConversion||1)});if(!(requested>0))throw new Error(`Cantidad inválida: ${product?.name||'producto'}`);
    return {productId:d.productId,method:d.method,requestedQuantity:requested,displayQuantity:Number(d.displayQuantity),displayUnit:d.displayUnit,displayConversion:Number(d.displayConversion||1),notes:d.note,reason:d.note,source:d.source,categoryName:categoryName(product?.categoryId),vigiaSuggestedQuantity:Number(row.suggestedQuantity||0),stockAtDecision:Number(row.stock||0),pendingInboundAtDecision:Number(row.pendingInbound||0)};
  });
  const result=await createProcurementLists({lines,extras:state.pendingExtras.map(e=>({...e})),ownerId:state.session?.userId||null,ownerLabel:actorLabel()});
  close('v6pReviewModal');selected.forEach(d=>{d.selected=false;});state.pendingExtras=[];await attemptSync();await reload();state.activeTab='lists';paint();toast(`${[result.purchaseListId,result.orderListId].filter(Boolean).length} lista(s) creada(s).`);
}

function openList(id,remember=true) {
  const list=state.lists.find(l=>l.id===id);if(!list)return;if(remember)state.listModalId=id;
  const modal=document.getElementById('v6pListModal');if(!modal)return;modal.innerHTML=renderListModal({list});modal.classList.add('is-open');
}

function openPrint(id,remember=true) {
  const list=state.lists.find(l=>l.id===id);if(!list)return;if(remember)state.printListId=id;
  close('v6pListModal');const modal=document.getElementById('v6pPrintModal');if(!modal)return;modal.innerHTML=renderPrintModal({list,businessName:businessName()});modal.classList.add('is-open');
}

async function saveListEdits() {
  const list=state.lists.find(l=>l.id===state.listModalId);if(!list||list.status!=='DRAFT')return;
  for(const node of document.querySelectorAll('#v6pListModal [data-line-id]')){
    const item=list.items.find(x=>x.id===node.dataset.lineId);if(!item||item.status!=='DRAFT')continue;
    const display=procurementDisplayQuantity(item);const qty=evaluateNumericExpression(node.querySelector('[data-list-field="quantity"]')?.value||'');if(!(qty>0))throw new Error(`Cantidad inválida: ${item.productName}`);
    const conversion=Number(item.sourceSuggestion?.displayConversion||1);const notes=String(node.querySelector('[data-list-field="note"]')?.value||'').trim().slice(0,180);
    await updateDraftProcurementLine(item.id,{requestedQuantity:qty*conversion,displayQuantity:qty,displayUnit:display.unit,displayConversion:conversion,notes,userId:state.session?.userId||null});
  }
  await attemptSync();await reload();paint();openList(list.id);toast('Borrador actualizado.');
}

async function cancelLine(id) {
  if(!id||!confirm('¿Quitar este renglón? Quedará CANCELADO en auditoría.'))return;
  await changeReplenishmentStatus(id,REPLENISHMENT_STATUS.CANCELLED,{userId:state.session?.userId||null});await attemptSync();await reload();paint();if(state.listModalId)openList(state.listModalId,false);
}

async function transitionList(id,status) {
  const list=state.lists.find(l=>l.id===id);if(!list)throw new Error('Lista no encontrada');
  for(const item of list.items.filter(x=>x.status!=='CANCELLED')){
    if(status===REPLENISHMENT_STATUS.ORDERED&&item.status!=='DRAFT')continue;
    if(status===REPLENISHMENT_STATUS.IN_TRANSIT&&item.status!=='ORDERED')continue;
    await changeReplenishmentStatus(item.id,status,{userId:state.session?.userId||null});
  }
  await attemptSync();await reload();paint();toast(status===REPLENISHMENT_STATUS.ORDERED?'Lista marcada como realizada.':'Lista marcada en camino.');
}

async function startReceipt(id) {
  const item=state.lists.flatMap(l=>l.items).find(x=>x.id===id);if(!item)throw new Error('Renglón no encontrado');if(isProcurementExtra(item))throw new Error('Los extras no generan entrada');
  if(!can(state.session,'entry.write'))throw new Error('Necesitas permiso de Entradas');if(!(Number(item.pendingQuantity||0)>0))throw new Error('No queda mercancía pendiente');
  const doc=await createDocument({type:DOCUMENT_TYPES.ENTRY,ownerId:state.session?.userId||null,supplierId:item.supplierId||null,metadata:{replenishmentId:item.id,replenishmentProductId:item.productId}});
  await attemptSync();close('v6pListModal');state.listModalId=null;
  const nav=document.querySelector('.app-nav [data-view="entry"]');if(!nav)return toast(`Entrada ${doc.id} creada.`);nav.click();await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
  const open=document.querySelector(`[data-action="open-document"][data-id="${cssEscape(doc.id)}"]`);if(open)open.click();else toast(`Entrada ${doc.id} creada. Ábrela desde Entradas.`);
}

async function completeExtra(id) {
  await completeProcurementExtra(id,{userId:state.session?.userId||null});await attemptSync();await reload();paint();if(state.listModalId)openList(state.listModalId,false);toast('Extra marcado como listo sin modificar inventario.');
}

function decorateList(list) { return {...list,code:listCode(list),statusLabel:statusLabel(list.status),dateLabel:formatDate(list.createdAt)}; }
function matches(row) { if(state.filter!=='ALL'&&String(row.riskLevel||'').toUpperCase()!==state.filter)return false;const q=norm(state.query);if(!q)return true;const p=state.productsById.get(row.productId);return norm([p?.name,p?.saintCode,p?.sku,categoryName(p?.categoryId)].filter(Boolean).join(' ')).includes(q); }
function visibleDrafts(){return state.rows.filter(r=>Number(r.suggestedQuantity||0)>0&&matches(r)).map(r=>state.drafts.get(r.productId)).filter(Boolean);}
function fallbackRow(id){const p=state.productsById.get(id);return {productId:id,suggestedQuantity:0,stock:0,pendingInbound:0,vigiaTargetStock:0,minStock:p?.minStock||0,maxStock:p?.maxStock||0,riskLevel:'LOW',consumptionConfidence:'NONE'};}
function draftFromNode(node){const id=node.closest('.v6p-product')?.dataset.productId;return id?state.drafts.get(id):null;}

function recommendedDisplay(product,base){const p=getPrimaryPresentation(product);if(p&&Number(p.conversion||1)>1){const q=quantityFromBase(base,p);if(q>=1)return {quantity:round(q),unit:p.code||p.name||catalogUnitCode(product),conversion:Number(p.conversion||1)};}return {quantity:round(base),unit:catalogUnitCode(product),conversion:1};}
function unitOptions(product,current){const base={unit:catalogUnitCode(product),conversion:1};const options=[base];for(const p of normalizePresentations(product.presentations,{inventoryUnitId:product.inventoryUnitId,purchaseUnitId:product.purchaseUnitId,purchaseConversion:product.purchaseConversion})){const unit=p.code||p.name;if(unit&&!options.some(x=>x.unit===unit))options.push({unit,conversion:Number(p.conversion||1)});}return options.map(x=>`<option value="${esc(x.unit)}" ${x.unit===current?'selected':''}>${esc(x.unit)}</option>`).join('');}
function presentationDescriptor(product,unit){const base=catalogUnitCode(product);if(unit===base)return {unit:base,conversion:1};const p=normalizePresentations(product.presentations,{inventoryUnitId:product.inventoryUnitId,purchaseUnitId:product.purchaseUnitId,purchaseConversion:product.purchaseConversion}).find(x=>(x.code||x.name)===unit);return p?{unit,conversion:Number(p.conversion||1)}:{unit:base,conversion:1};}
function categoryName(id){return state.categoriesById.get(id)?.name||'SIN CATEGORÍA';}
function listCode(list){const prefix=list.kind==='ORDER'?'PED':'COM';const raw=String(list.id||'').replace(/[^a-zA-Z0-9]/g,'').slice(-6).toUpperCase()||'000001';return `${prefix}-${raw}`;}
function statusLabel(s){return ({DRAFT:'BORRADOR',ORDERED:'REALIZADO',IN_TRANSIT:'EN CAMINO',PARTIALLY_RECEIVED:'RECIBIDO PARCIAL',RECEIVED:'RECIBIDO',CANCELLED:'CANCELADO'})[s]||s;}
function actorLabel(){const email=String(state.session?.email||'').trim();return email?email.split('@')[0]:(state.session?.userId?`Usuario ${String(state.session.userId).slice(0,8)}`:'Usuario VIGÍA');}
function businessName(){try{return localStorage.getItem(BUSINESS_NAME_KEY)||'NOMBRE DEL NEGOCIO';}catch{return 'NOMBRE DEL NEGOCIO';}}
function saveBusinessName(){const name=String(document.getElementById('v6pBusinessName')?.value||'').trim();try{localStorage.setItem(BUSINESS_NAME_KEY,name);}catch{}if(state.printListId)openPrint(state.printListId,false);toast('Nombre guardado para tickets.');}
function close(id){const n=document.getElementById(id);if(n){n.classList.remove('is-open');n.innerHTML='';}}
async function safeSession(){try{return await getCurrentSession();}catch{return null;}}
async function attemptSync(){try{await syncNow({localUserId:state.session?.userId||undefined,displayName:actorLabel()});}catch(error){console.warn('Procurement sync pendiente en outbox',error);}}
function formatNumber(v){const n=Number(v||0);return new Intl.NumberFormat('es-VE',{maximumFractionDigits:3}).format(Number.isFinite(n)?n:0);}
function formatDate(v){const d=new Date(v||Date.now());return Number.isNaN(d.getTime())?'Sin fecha':new Intl.DateTimeFormat('es-VE',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}).format(d);}
function looseNumber(v){const n=Number(String(v||'').trim().replace(',','.'));return Number.isFinite(n)&&n>=0?n:null;}
function round(v){return Math.round((Number(v||0)+Number.EPSILON)*1000)/1000;}
function norm(v){return String(v||'').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');}
function cssEscape(v){if(globalThis.CSS?.escape)return CSS.escape(String(v));return String(v).replace(/["\\]/g,'\\$&');}
function toast(message){const save=document.getElementById('saveStatus');if(save)save.textContent=String(message||'Listo');const n=document.createElement('div');n.className='v6p-toast';n.textContent=String(message||'Listo');document.body.appendChild(n);setTimeout(()=>n.remove(),2600);}
function reportError(error){console.error(error);toast(error?.message||String(error));}
