// Pilot isolated from V2 procurement: its launcher never replaces existing forms.
// Requires authenticated V2 app session. NO stock movements or legacy sync writes.
import { getAll, STORES } from '../storage/database.js';
import { resolveMonitorPilotSession } from '../replenishment/monitorPilotSession.js';
import { isMonitorPilotEnabled } from './monitorPilotEnabled.js';
import { createLocalId } from '../core/ids.js';
import { catalogUnitCode } from '../catalog/catalogUi.js';
import { monitorUnitOptions, selectedMonitorUnit } from '../replenishment/monitorUnitOptions.js';
import { renderProcurementTickets } from './procurementWorkspaceV6Print.js';
import { buildMonitorNativeLists } from '../replenishment/monitorNativeTicketAdapter.js';
import { fetchMonitorMirrorForNormal, assertMonitorPrintable } from './monitorNormalMirrorUi.js';
import { printThermalProcurementList } from '../printing/thermalPrinterClient.js';
import {
  readPilotPosition, savePilotPosition, restorePilotPosition
} from './monitorPilotPosition.js';
import {
  readMonitorReview, queueMonitorReviewChange, syncMonitorReview
} from '../replenishment/monitorReviewOffline.js';

const root=document.getElementById('app');
let shell=null,launcher=null;
let pilotEnabled=false;
const state={
  visible:false,loading:false,page:'home',week:weekMonday(),
  currentCategory:null,cursor:0,session:null,options:null,
  products:[],categories:[],local:null,message:'',error:'',
  pendingReviewMode:false,printing:false
};
if(root){
  launcher=document.createElement('button');
  launcher.type='button';launcher.id='vigiaMonitorPilotLauncher';
  launcher.textContent='✦ VIGÍA Monitor (piloto)';
  launcher.hidden=true;document.body.append(launcher);

  shell=document.createElement('section');shell.id='vigiaMonitorPilot';
  shell.hidden=true;shell.setAttribute('aria-label','Piloto VIGÍA Monitor');
  document.body.append(shell);

  const observer=new MutationObserver(updateLauncher);
  observer.observe(root,{childList:true,subtree:true});
  updateLauncher();
  isMonitorPilotEnabled().then(enabled=>{pilotEnabled=enabled;updateLauncher();});

  launcher.addEventListener('click',()=>openPilot().catch(showError));
  shell.addEventListener('click',event=>handleClick(event).catch(showError));
  shell.addEventListener('submit',event=>handleSubmit(event).catch(showError));
  shell.addEventListener('change',event=>handleChange(event).catch(showError));
  shell.addEventListener('input',event=>handleSelectedInput(event));
  shell.addEventListener('focusout',event=>handleSelectedBlur(event));
  shell.addEventListener('keydown',event=>handleSelectedKeydown(event).catch(showError));
  window.addEventListener('online',()=>{if(state.visible)pushAndRefresh().catch(showError);});
  window.addEventListener('beforeprint',()=>{
    if(state.visible && state.page==='lists') document.body.classList.add('vigia-monitor-print-active');
  });
  window.addEventListener('afterprint',()=>document.body.classList.remove('vigia-monitor-print-active'));

}

function updateLauncher(){
  // Si VIGÍA bloquea la sesión o cierra la cuenta, ocultar también el piloto.
  if(document.body.classList.contains('auth-locked') && state.visible){
    closePilot();
    return;
  }
  const title=String(root?.querySelector('h2')?.textContent||'').trim().toLowerCase();
  launcher.hidden=!pilotEnabled||state.visible||document.body.classList.contains('auth-locked')||title!=='comprar / pedir';
}
async function openPilot(){
  if(!pilotEnabled)throw new Error('Monitor no está activado en este dispositivo');
  state.visible=true;state.loading=true;state.error='';
  shell.hidden=false;document.body.style.overflow='hidden';updateLauncher();paint();
  try{
    const [session,products,categories]=await Promise.all([
      resolveMonitorPilotSession(),getAll(STORES.PRODUCTS),getAll(STORES.CATEGORIES)
    ]);
    if(!session?.workspaceId || !session?.userId)throw new Error('Sesión válida requerida');
    state.session=session;
    state.options={workspaceId:session.workspaceId,userId:session.userId,weekStart:state.week};
    state.products=products.filter(p=>p&&p.active!==false&&p.id).sort((a,b)=>
      String(a.name).localeCompare(String(b.name),'es'));
    state.categories=categories.filter(c=>c&&c.active!==false&&c.id)
      .sort((a,b)=>String(a.name).localeCompare(String(b.name),'es'));
    state.local=await readMonitorReview(state.options);
    state.pendingReviewMode=false;
    const savedPosition=await readPilotPosition(state.options);
    const position=restorePilotPosition(savedPosition,groups());
    if(position){
      state.currentCategory=position.categoryId;
      state.cursor=position.cursor;
      state.page=position.page;
    }
    state.loading=false;paint();
    await pushAndRefresh();
  }catch(error){
    state.loading=false;showError(error);
  }
}
async function persistPilotCursor(){
  if(!state.options)return;
  const group=groups().find(g=>g.id===state.currentCategory);
  await savePilotPosition(state.options,{
    categoryId:group?.id||'',
    productId:group?.products[state.cursor]?.id||'',
    page:state.page
  });
}
// Impide que una sincronización anterior repinte un valor guardado más tarde.
// El servidor/IndexedDB siguen siendo fuente de verdad; esto solo protege UI.
let latestLocalUiEpoch=0;
function closePilot(){
  latestLocalUiEpoch++;
  state.visible=false;shell.hidden=true;document.body.style.overflow='';updateLauncher();
}
async function pushAndRefresh(){
  if(!state.options)return;
  const epoch=++latestLocalUiEpoch;
  await syncMonitorReview(state.options);
  const latest=await readMonitorReview(state.options);
  if(epoch!==latestLocalUiEpoch || !state.visible)return;
  state.local=latest;
  if(state.local.status==='SYNCED' && state.message.startsWith('Guardado en este dispositivo'))state.message='';
  // No interrumpir cantidad/unidad todavía bajo edición.
  const focus=document.activeElement;
  if(state.page==='selected') {
    // Con decenas de campos, jamás reemplazar sus nodos por una sincronización
    // en segundo plano: se perdería el texto que aún no acabó de escribir.
    const chip=shell.querySelector('.mp-chip');
    if(chip)chip.textContent=state.local.status==='CONFLICT'
      ? '⚠ Conflictos sin resolver: '+state.local.conflictCount
      : state.local.pendingCount?'● Pendiente de sincronizar: '+state.local.pendingCount
      : '✓ Sincronizado';
    return;
  }
  if(shell.contains(focus)&&focus?.matches?.('input,textarea,select'))return;
  paint();
}
async function localChange(change){
  if(!state.options)throw new Error('Se requiere sesión activa');
  const epoch=++latestLocalUiEpoch;
  await queueMonitorReviewChange(state.options,change);
  const latest=await readMonitorReview(state.options);
  // Una edición posterior ya empezó: jamás presentar la foto anterior.
  if(epoch!==latestLocalUiEpoch || !state.visible)return;
  state.local=latest;
  state.message='Guardado en este dispositivo. Se enviará cuando haya conexión.';
  state.error='';
  paint();
  // El envío no bloquea el trabajo: si cae la red, IndexedDB retiene los eventos.
  pushAndRefresh().catch(showError);
}
function findRow(productId){return (state.local?.items||[]).find(x=>x.itemKey==='product:'+productId);}
function groups(){
  const map=new Map(state.categories.map(c=>[String(c.id),{id:String(c.id),name:c.name||'Sin nombre',products:[]}]));
  for(const p of state.products){
    const key=String(p.categoryId||'');
    if(!map.has(key))map.set(key,{id:key,name:'Sin categoría',products:[]});
    map.get(key).products.push(p);
  }
  return [...map.values()].filter(x=>x.products.length>0).sort((a,b)=>
    String(a.name).localeCompare(String(b.name),'es'));
}
function productChoices(){
  const result={BUY:[],ORDER:[],PENDING:[],UNREVIEWED:[],NOT_NEEDED:[]};
  for(const p of state.products){
    const item=findRow(p.id);
    const key=item?.decision||'UNREVIEWED';
    result[key]?.push(p);
  }
  return result;
}
function selectedItems(){
  const rows=[];
  for(const item of state.local?.items||[]){
    if(item.deleted||!['BUY','ORDER'].includes(item.decision))continue;
    const extra=item.kind==='EXTRA';
    const p=extra?null:state.products.find(x=>x.id===item.productId);
    if(!extra&&!p)continue;
    const name=extra?item.description:p.name||p.id;
    const cat=extra?'EXTRAS':state.categories.find(c=>c.id===p.categoryId)?.name||'SIN CATEGORÍA';
    rows.push({...item,name,category:cat,unit:item.unit||p?.unitCode||''});
  }
  return rows.sort((a,b)=>a.category.localeCompare(b.category,'es')||a.name.localeCompare(b.name,'es'));
}
function progress(){
  const all=productChoices();
  return {
    total:state.products.length,
    reviewed:all.BUY.length+all.ORDER.length+all.NOT_NEEDED.length,
    pending:all.PENDING.length,
    buying:all.BUY.length,ordering:all.ORDER.length,
    remaining:all.UNREVIEWED.length,
    incomplete:selectedItems().filter(x=>x.quantity==null).length
  };
}
function esc(x){
  return String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function panel(title,content){return '<section class="mp-card"><h2>'+esc(title)+'</h2>'+content+'</section>';}
function button(label,action,options={}) {
  const cls=options.cls||'mp-button';
  const attrs=options.attrs||'';
  return '<button class="'+cls+'" type="button" data-mp-action="'+esc(action)+'" '+attrs+'>'+label+'</button>';
}
function info(){
  const label=state.local?.status==='CONFLICT'?'⚠ Conflictos sin resolver: '+state.local.conflictCount
    :state.local?.network==='OFFLINE'?'● Sin Internet · datos de este dispositivo'
    :state.local?.network==='RETRY_LATER'?'● Servidor no disponible; datos locales intactos'
    :state.local?.status==='LOCAL'?'● Pendiente de sincronizar: '+state.local.pendingCount
    :state.local?'✓ Sincronizado':'Sin iniciar';
  return '<span class="mp-chip">'+esc(label)+'</span>';
}
function paint(){
  if(!state.visible)return;
  const tabs=[
    ['home','Inicio'],['review','Revisar'],['pending','Pendientes'],
    ['selected','Seleccionados'],['extras','Extras'],['lists','Mis listas']
  ];
  const nav=tabs.map(([id,label])=>'<button type="button" data-mp-action="page" data-mp-page="'+id+
    '" '+(state.page===id?'aria-current="page"':'')+'>'+label+'</button>').join('');
  let content='<p class="mp-muted">Preparando revisión semanal…</p>';
  if(state.error)content='<div class="mp-error">'+esc(state.error)+'</div>';
  if(!state.loading&&state.local){
    if(state.page==='home')content=renderHome();
    if(state.page==='review')content=renderReview();
    if(state.page==='pending')content=renderPending();
    if(state.page==='selected')content=renderSelected();
    if(state.page==='extras')content=renderExtras();
    if(state.page==='lists')content=renderLists();
  }
  shell.innerHTML='<div class="mp-shell"><header class="mp-head"><div><small>PILOTO AISLADO · SIN MOVIMIENTOS DE STOCK</small>'+
    '<h1>VIGÍA Monitor</h1><p>Revisión semanal '+esc(state.week)+' · '+
    esc(state.products.length)+' productos del catálogo</p></div>'+
    button('Cerrar ✕','close',{cls:'mp-close'})+'</header>'+
    '<nav class="mp-nav mp-no-print" aria-label="Secciones del piloto">'+nav+'</nav>'+
    '<div class="mp-inline mp-no-print">'+info()+
    button('↻ Sincronizar','sync')+'</div>'+
    (state.message?'<div class="mp-warning mp-no-print">'+esc(state.message)+'</div>':'')+
    (state.error?'<div class="mp-error mp-no-print">'+esc(state.error)+'</div>':'')+
    content+'</div>';
}
function renderHome(){
  const p=progress();
  const cards=[['Revisados',p.reviewed],['Pendientes',p.pending],['Comprar',p.buying],['Pedir',p.ordering]];
  const stats='<div class="mp-kpis">'+cards.map(([k,v])=>
    '<div class="mp-kpi"><span class="mp-muted">'+k+'</span><b>'+v+'</b></div>').join('')+'</div>';
  const sections=groups().map(group=>{
    const done=group.products.filter(p=>['BUY','ORDER','NOT_NEEDED'].includes(findRow(p.id)?.decision)).length;
    const pending=group.products.filter(p=>findRow(p.id)?.decision==='PENDING').length;
    return '<button class="mp-tile" data-mp-action="category" data-mp-category="'+esc(group.id)+
      '"><span class="mp-muted">Categoría</span><strong>'+esc(group.name)+'</strong>'+
      '<span>'+done+' / '+group.products.length+' revisados · '+pending+' pendientes</span>'+
      '<div class="mp-progress"><div style="width:'+(group.products.length?Math.round(done*100/group.products.length):0)+'%"></div></div></button>';
  }).join('');
  return panel('Tu semana de trabajo',stats+
    '<p class="mp-muted">Puedes revisar todo el catálogo. Las recomendaciones de stock no ocultan ningún producto.</p>'+
    '<h3>Categorías</h3><div class="mp-grid">'+sections+'</div>');
}
function renderReview(){
  const cats=groups();
  if(!cats.length)return panel('Revisar','<p>No hay productos activos cargados en este dispositivo.</p>');
  const group=cats.find(x=>x.id===state.currentCategory)||cats[0];
  state.currentCategory=group.id;
  state.cursor=Math.min(Math.max(0,state.cursor),group.products.length-1);
  const p=group.products[state.cursor], row=findRow(p.id);
  const option=cats.map(c=>'<option value="'+esc(c.id)+'" '+(c.id===group.id?'selected':'')+'>'+esc(c.name)+'</option>').join('');
  const categorySelector='<label>Categoría <select id="mpCategoryPicker" data-mp-category-picker>'+option+'</select></label>';
  const unit=esc(row?.unit||p.unitCode||'');
  const qty=row?.quantity==null?'':row.quantity;
  const note=esc(row?.notes||'');
  const pendingIndicator=state.pendingReviewMode
    ? '<div class="mp-warning">Modo Pendientes · '+pendingProducts().length+
      ' por revisar. Al decidir pasarás al siguiente pendiente, incluso de otra categoría. '+
      button('← Volver a Pendientes','back-pending')+'</div>'
    : '';
  return panel('Revisión por categoría',pendingIndicator+
    '<div class="mp-form">'+categorySelector+'<div><span class="mp-muted">Avance en categoría</span>'+
    '<h3>'+esc(state.cursor+1)+' de '+group.products.length+'</h3></div></div>'+
    '<div class="mp-card"><span class="mp-chip">'+esc(group.name)+'</span>'+
    '<h2 style="margin:12px 0 0">'+esc(p.name||p.id)+'</h2>'+
    '<p class="mp-muted">Código: '+esc(p.saintCode||p.sku||p.id)+'</p>'+
    '<div class="mp-warning">VIGÍA puede sugerir reposiciones, pero aquí siempre decides tú.</div>'+
    '<div class="mp-form"><label>Cantidad (opcional)<input id="mpQuantity" inputmode="decimal" type="number" step="any" min="0.001" placeholder="Por definir" value="'+esc(qty)+'"></label>'+
    '<label>Unidad <input id="mpUnit" value="'+unit+'" placeholder="UND / KG / CJ"></label></div>'+
    '<label>Observación (opcional)<textarea id="mpNotes" rows="2">'+note+'</textarea></label>'+
    '<p class="mp-muted">Decisión guardada: '+esc(decisionLabel(row?.decision||'UNREVIEWED'))+'</p>'+
    '<div class="mp-actions">'+[
      ['Comprar','BUY','mp-buy'],['Pedir','ORDER','mp-order'],
      ['No hace falta','NOT_NEEDED','mp-none'],['Pendiente / Saltar','PENDING','mp-pending']
    ].map(([label,choice,cls])=>button(label,'choose',{cls:'mp-action '+cls,attrs:'data-mp-choice="'+choice+'"'})).join('')+'</div>'+
    '<div class="mp-inline">'+button('← Anterior','previous')+button('Siguiente →','next')+'</div></div>'
  );
}
// Cola global de pendientes (cruza categorías); mantiene orden del catálogo.
function pendingProducts(){return productChoices().PENDING;}
function showPendingProduct(product){
  if(!product)return false;
  const group=groups().find(x=>x.products.some(p=>p.id===product.id));
  if(!group)return false;
  state.currentCategory=group.id;
  state.cursor=group.products.findIndex(x=>x.id===product.id);
  state.page='review';
  state.pendingReviewMode=true;
  return true;
}
function advancePendingReview(currentId,direction=1){
  const pending=pendingProducts();
  if(!pending.length){
    state.pendingReviewMode=false;
    state.page='pending';
    state.message='¡Listo! No quedan productos pendientes.';
    return;
  }
  const from=state.products.findIndex(x=>x.id===currentId);
  // Tras resolver el actual, el siguiente puede estar en OTRA categoría.
  const ordered=direction>=0
    ? pending.find(x=>state.products.findIndex(p=>p.id===x.id)>from)||pending[0]
    : [...pending].reverse().find(x=>state.products.findIndex(p=>p.id===x.id)<from)||pending[pending.length-1];
  if(ordered.id===currentId&&pending.length===1){
    state.page='pending';
    state.pendingReviewMode=false;
    state.message='Este producto continúa pendiente.';
    return;
  }
  showPendingProduct(ordered);
}

function renderPending(){
  const all=productChoices().PENDING;
  if(!all.length)return panel('Pendientes','<p>No tienes productos pendientes. Puedes seguir con otra categoría.</p>');
  return panel('Pendientes ('+all.length+')',
    '<p class="mp-muted">Saltados para revisarlos más tarde. No cuentan como revisados ni como compras.</p>'+
    all.map(p=>'<div class="mp-row"><div><strong>'+esc(p.name)+'</strong><div class="mp-muted">'+
      esc(state.categories.find(c=>c.id===p.categoryId)?.name||'Sin categoría')+
      '</div></div>'+button('Revisar ahora','jump',{attrs:'data-mp-id="'+esc(p.id)+'"'})+'</div>').join(''));
}
function renderSelected(){
  const items=selectedItems();
  if(!items.length)return panel('Seleccionados','<p>Todavía no has marcado productos para Comprar o Pedir.</p>'+
    button('+ Agregar un extra','page',{attrs:'data-mp-page="extras"'}));
  return panel('Seleccionados ('+items.length+')',
    '<p class="mp-muted">Cantidades opcionales: '+items.filter(x=>x.quantity==null).length+
    ' por completar. Cantidad, unidad, tipo y observación se guardan automáticamente. Enter avanza a la siguiente fila.</p>'+
    '<div class="mp-muted" style="margin-bottom:8px">La unidad elegida se imprimirá tal cual (ej. 2 CAJA). Monitor no convierte cantidades ni altera existencias.</div>'+
    items.map((item,i)=>{
      const product=item.kind==='PRODUCT'?state.products.find(p=>p.id===item.productId):null;
      const currentUnit=String(item.unit|| (product ? catalogUnitCode(product):'UND')).trim().toUpperCase();
      const options=monitorUnitOptions(product,currentUnit).map(code=>
        '<option value="'+esc(code)+'" '+(code===currentUnit?'selected':'')+'>'+esc(code)+'</option>'
      ).join('');
      return '<div class="mp-row mp-selected-row" data-mp-edit-row="'+i+'" data-mp-item="'+esc(item.itemKey)+'">'+
        '<div class="mp-selected-description"><strong>'+esc(item.name)+'</strong>'+
        '<div class="mp-muted">'+esc(item.category)+' · '+esc(decisionLabel(item.decision))+'</div>'+ 
        (item.notes?'<small class="mp-selected-note">('+esc(item.notes)+')</small>':'')+'</div>'+
        '<div class="mp-selected-edit">'+
        '<label>Cantidad<input class="mp-edit-quantity" inputmode="decimal" type="number" min="0.001" step="any" placeholder="Vacío" value="'+esc(item.quantity??'')+'"></label>'+
        '<label>Unidad<select class="mp-edit-unit-select" aria-label="Unidad de '+esc(item.name)+'">'+options+
        '<option value="__OTHER__">OTRA…</option></select>'+
        '<input class="mp-edit-unit-other" type="text" maxlength="40" placeholder="Escribe la unidad" aria-label="Otra unidad" hidden></label>'+
        '<label>Tipo<select class="mp-edit-decision"><option value="BUY" '+(item.decision==='BUY'?'selected':'')+'>Comprar</option>'+
        '<option value="ORDER" '+(item.decision==='ORDER'?'selected':'')+'>Pedir</option></select></label>'+
        '<label class="mp-edit-note-label">Observación<input class="mp-edit-note" type="text" maxlength="180" autocomplete="off" placeholder="Ej. rebanadas" value="'+esc(item.notes||'')+'" aria-label="Observación de '+esc(item.name)+'"></label>'+
        '<small class="mp-save-status" role="status" aria-live="polite">Guardado automático</small>'+
        '</div></div>';
    }).join('')+
    '<p>'+button('+ Agregar extra','page',{attrs:'data-mp-page="extras"'})+'</p>');
}

// Autosave: las ediciones se escriben primero en IndexedDB y luego se
// sincronizan con PostgreSQL. Debounce solo en texto/números, nunca en select.
const selectedDrafts=new Map();
const selectedCommitted=new Map();
const SELECTED_DELAY_MS=420;

function selectedRowChange(row){
  const key=row?.dataset.mpItem;
  const item=selectedItems().find(x=>x.itemKey===key);
  if(!item)return null;
  const quantity=row.querySelector('.mp-edit-quantity')?.value??'';
  const choice=row.querySelector('.mp-edit-decision')?.value||item.decision;
  // Igual que VIGÍA normal: observación por renglón, hasta 180 caracteres.
  const notes=String(row.querySelector('.mp-edit-note')?.value??item.notes??'').trim().slice(0,180);
  const unit=selectedMonitorUnit({
    selected:row.querySelector('.mp-edit-unit-select')?.value,
    custom:row.querySelector('.mp-edit-unit-other')?.value,
    current:item.unit
  });
  return {
    kind:item.kind,
    itemId:item.kind==='EXTRA'?item.itemKey.slice(6):item.productId,
    description:item.kind==='EXTRA'?item.name:undefined,
    decision:choice,quantity,unit,notes
  };
}

function showSelectedStatus(row,value,type=''){
  const label=row?.querySelector('.mp-save-status');
  if(label){label.textContent=value;label.dataset.status=type;}
}
function selectedRecord(row){
  const key=row?.dataset.mpItem;
  if(!key)return null;
  let rec=selectedDrafts.get(key);
  if(!rec){
    rec={key,row,revision:0,doneRevision:0,change:null,timer:null,task:null};
    selectedDrafts.set(key,rec);
  }
  rec.row=row;
  return rec;
}
function scheduleSelectedSave(row,delay=SELECTED_DELAY_MS){
  const rec=selectedRecord(row);
  if(!rec)return;
  if(rec.timer)clearTimeout(rec.timer);
  try{
    const change=selectedRowChange(row);
    if(!change)return;
    rec.change=change;
    rec.revision++;
    showSelectedStatus(row,'● Guardando…','saving');
    rec.timer=setTimeout(()=>{
      rec.timer=null;
      flushSelectedRecord(rec).catch(error=>{
        showSelectedStatus(rec.row,'⚠ '+String(error.message||error),'error');
      });
    },delay);
  }catch(error){
    // "OTRA…" sin escribir aún su nombre no borra la unidad anterior.
    showSelectedStatus(row,'⚠ '+String(error.message||error),'error');
  }
}
async function flushSelectedRecord(rec){
  if(!rec)return;
  if(rec.timer){clearTimeout(rec.timer);rec.timer=null;}
  if(rec.task)return rec.task;
  rec.task=(async()=>{
    while(rec.doneRevision<rec.revision){
      const revision=rec.revision, change=rec.change;
      const fingerprint=JSON.stringify(change);
      if(fingerprint!==selectedCommitted.get(rec.key)){
        if(!state.options)throw new Error('Sesión Monitor no disponible');
        // Mantener el orden de cambios del mismo producto incluso al tocar
        // cantidad, unidad y tipo en rápida sucesión.
        ++latestLocalUiEpoch;
        await queueMonitorReviewChange(state.options,change);
        state.local=await readMonitorReview(state.options);
        selectedCommitted.set(rec.key,fingerprint);
      }
      rec.doneRevision=revision;
      showSelectedStatus(rec.row,'✓ Guardado local','saved');
      // La red es posterior, sin bloquear la captura.
      pushAndRefresh().catch(error=>{
        showSelectedStatus(rec.row,'✓ Local · pendiente de sincronizar','saved');
        console.warn('Monitor sync pendiente',error);
      });
    }
  })();
  try{return await rec.task;}
  finally{rec.task=null;}
}
async function flushAllSelected(){
  if(state.page==='selected'){
    for(const row of shell.querySelectorAll('.mp-selected-row')){
      try{selectedRowChange(row);}catch(error){
        showSelectedStatus(row,'⚠ '+String(error.message||error),'error');
        throw error; // No cerrar ni navegar con una unidad OTRA sin definir.
      }
    }
  }
  for(const rec of selectedDrafts.values()){
    if(rec.timer||rec.doneRevision<rec.revision)await flushSelectedRecord(rec);
  }
}
function clearSelectedRecords(){
  for(const rec of selectedDrafts.values())if(rec.timer)clearTimeout(rec.timer);
  selectedDrafts.clear();
  selectedCommitted.clear();
}
function handleSelectedInput(event){
  if(!event.target.matches('.mp-edit-quantity,.mp-edit-unit-other,.mp-edit-note'))return;
  const row=event.target.closest('[data-mp-edit-row]');
  if(row)scheduleSelectedSave(row);
}
function handleSelectedBlur(event){
  if(!event.target.matches('.mp-edit-quantity,.mp-edit-unit-other,.mp-edit-note'))return;
  const row=event.target.closest('[data-mp-edit-row]');
  if(row){
    const rec=selectedRecord(row);
    if(rec?.timer)flushSelectedRecord(rec).catch(error=>
      showSelectedStatus(row,'⚠ '+String(error.message||error),'error'));
  }
}
async function handleSelectedKeydown(event){
  if(event.key!=='Enter'||!event.target.matches('.mp-edit-quantity,.mp-edit-unit-other,.mp-edit-note'))return;
  const row=event.target.closest('[data-mp-edit-row]');
  if(!row)return;
  event.preventDefault();
  // Enter no es necesario para guardar, solo sirve como acelerador de avance.
  scheduleSelectedSave(row,0);
  const rec=selectedRecord(row);
  await flushSelectedRecord(rec);
  const rows=[...shell.querySelectorAll('[data-mp-edit-row]')];
  rows[rows.indexOf(row)+1]?.querySelector('.mp-edit-quantity')?.focus();
}
function renderExtras(){
  return panel('Compra o pedido extra',
    '<p class="mp-muted">Anota cualquier cosa que no exista en VIGÍA: cinta métrica, guantes, bolsas, herramientas… Sin crear productos de inventario.</p>'+
    '<form id="mpExtraForm"><div class="mp-form">'+
    '<label>Nombre o descripción *<input name="description" maxlength="180" required placeholder="Ej. Cinta métrica"></label>'+
    '<label>Tipo<select name="decision"><option value="BUY">Comprar</option><option value="ORDER">Pedir</option></select></label>'+
    '<label>Cantidad (opcional)<input name="quantity" type="number" step="any" min="0.001" placeholder="Por definir"></label>'+
    '<label>Unidad (opcional)<input name="unit" maxlength="40" placeholder="UND"></label></div>'+
    '<label>Nota (opcional)<textarea name="notes" maxlength="500" rows="2"></textarea></label>'+
    '<button class="mp-button mp-primary" style="margin-top:15px" type="submit">+ Guardar extra</button></form>');
}
function renderLists(){
  const rows=selectedItems();
  const snapshot={
    source:'monitor-weekly-review',weekStart:state.week,
    lists:{
      PURCHASE:rows.filter(x=>x.decision==='BUY').map(x=>({
        itemKey:x.itemKey,kind:x.kind,productId:x.productId,
        description:x.name,category:x.category,quantity:x.quantity,
        unit:x.unit,notes:x.notes
      })),
      ORDER:rows.filter(x=>x.decision==='ORDER').map(x=>({
        itemKey:x.itemKey,kind:x.kind,productId:x.productId,
        description:x.name,category:x.category,quantity:x.quantity,
        unit:x.unit,notes:x.notes
      }))
    }
  };
  const lists=buildMonitorNativeLists(snapshot,{ownerLabel:pilotOwnerLabel()});
  const preview=lists.map(list=>renderProcurementTickets({
    list,businessName:pilotBusinessName()
  })).join('');
  const warning=(state.local?.pendingCount||state.local?.conflictCount)
    ? '<p class="mp-warning">Hay cambios por sincronizar o conflictos. Antes de imprimir se verificará la lista directamente con el servidor.</p>'
    : '<p class="mp-muted">Mismo formato VIGÍA normal (80 mm). Imprimir no cierra ni altera la semana.</p>';
  const buttons=state.printing?'<p>Enviando a impresora…</p>':
    button('🖨 Imprimir compras','monitor-print',{cls:'mp-button mp-primary',attrs:'data-mp-kind="PURCHASE"'})+
    button('🖨 Imprimir pedidos','monitor-print',{cls:'mp-button mp-primary',attrs:'data-mp-kind="ORDER"'});
  return panel('Mis listas semanales',
    '<div class="mp-no-print">'+warning+'<div class="mp-inline">'+buttons+'</div></div>'+
    '<div class="v6p-ticket-preview mp-ticket-grid">'+preview+'</div>');
}

function pilotBusinessName(){
  try{return localStorage.getItem('vigia.procurement.businessName') || 'NOMBRE DEL NEGOCIO';}
  catch{return 'NOMBRE DEL NEGOCIO';}
}
function pilotOwnerLabel(){
  const user=state.session||{};
  return String(user.email||'').split('@')[0] || (user.userId?'Usuario '+String(user.userId).slice(0,8):'Usuario VIGÍA');
}
async function pilotDirectPrint(kind){
  if(state.printing)return;
  if(!['PURCHASE','ORDER'].includes(kind))throw new Error('Tipo de lista inválido');
  if(!state.options||!state.session)throw new Error('No hay sesión de Monitor');
  state.printing=true;state.error='';paint();
  try {
    // Traer una copia FRESCA; jamás imprimir del estado local anterior.
    const snapshot=await fetchMonitorMirrorForNormal({
      session:state.session,products:state.products,categories:state.categories,
      weekStart:state.week,syncBeforeFetch:true
    });
    assertMonitorPrintable(snapshot);
    const list=buildMonitorNativeLists(snapshot,{ownerLabel:pilotOwnerLabel()})
      .find(x=>x.kind===kind);
    if(!list?.items.length)throw new Error('Lista sin artículos');
    const result=await printThermalProcurementList(list);
    state.message=result.copies+' copias enviadas a '+result.printer.name+
      ' · '+result.itemCount+' productos. No se cerró la revisión.';
  }finally{
    state.printing=false;paint();
  }
}
function decisionLabel(d){return ({
  BUY:'Comprar',ORDER:'Pedir',PENDING:'Pendiente',NOT_NEEDED:'No hace falta',UNREVIEWED:'Sin revisar'
})[d]||d;}
function weekMonday(){
  const d=new Date();const weekday=(d.getDay()+6)%7;d.setDate(d.getDate()-weekday);
  return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');
}
function moveToNextUndecided(){
  const group=groups().find(x=>x.id===state.currentCategory);
  if(!group)return;
  const remaining=group.products.findIndex((p,i)=>i>state.cursor&&!findRow(p.id));
  const previous=group.products.findIndex((p,i)=>i<=state.cursor&&!findRow(p.id));
  const next=remaining>=0?remaining:previous;
  if(next>=0)state.cursor=next;
  else {state.page='home';state.message='Categoría recorrida. Puedes abrir otra o revisar tus pendientes.';}
}
async function handleClick(event){
  const node=event.target.closest('[data-mp-action]');
  if(!node)return;
  event.preventDefault();
  const action=node.dataset.mpAction;
  if(action==='close'){
    try{await flushAllSelected();}catch(error){
      showSelectedStatus(shell.querySelector('.mp-selected-row'),'⚠ No se pudo guardar: '+error.message,'error');return;
    }
    clearSelectedRecords();return closePilot();
  }
  if(action==='sync'){
    try{await flushAllSelected();}catch(error){state.error=String(error.message||error);return;}
    await pushAndRefresh();return;
  }
  if(action==='page'){
    try{await flushAllSelected();}catch(error){
      showSelectedStatus(shell.querySelector('.mp-selected-row'),'⚠ No se pudo guardar: '+error.message,'error');return;
    }
    clearSelectedRecords();
    state.page=node.dataset.mpPage;
    state.pendingReviewMode=false;
    state.message='';paint();return;
  }
  if(action==='category'){
    state.pendingReviewMode=false;
    state.currentCategory=node.dataset.mpCategory;
    const group=groups().find(x=>x.id===state.currentCategory);
    state.cursor=Math.max(0,group?.products.findIndex(p=>!findRow(p.id))??0);
    state.page='review';state.message='';await persistPilotCursor();paint();return;
  }
  if(action==='jump'){
    const id=node.dataset.mpId;
    const p=state.products.find(x=>x.id===id);
    if(!p)return;
    const group=groups().find(x=>x.products.some(x=>x.id===id));
    state.currentCategory=group.id;
    state.cursor=group.products.findIndex(x=>x.id===id);
    state.page='review';state.pendingReviewMode=true;
    state.message='';await persistPilotCursor();paint();return;
  }
  if(action==='back-pending'){
    state.page='pending';state.pendingReviewMode=false;state.message='';paint();return;
  }
  if(action==='monitor-print'){await pilotDirectPrint(node.dataset.mpKind);return;}
  if(action==='previous'||action==='next'){
    if(state.pendingReviewMode){
      const group=groups().find(x=>x.id===state.currentCategory);
      const current=group?.products[state.cursor];
      if(current)advancePendingReview(current.id,action==='previous'?-1:1);
      await persistPilotCursor();paint();return;
    }
    const group=groups().find(x=>x.id===state.currentCategory);
    if(group){
      state.cursor=Math.max(0,Math.min(group.products.length-1,state.cursor+(action==='previous'?-1:1)));
    }
    await persistPilotCursor();paint();return;
  }
  if(action==='choose'){
    const group=groups().find(x=>x.id===state.currentCategory);
    const p=group?.products[state.cursor];if(!p)return;
    const quantity=shell.querySelector('#mpQuantity')?.value||null;
    const unit=shell.querySelector('#mpUnit')?.value||'';
    const notes=shell.querySelector('#mpNotes')?.value||'';
    await localChange({
      kind:'PRODUCT',itemId:p.id,decision:node.dataset.mpChoice,
      quantity,unit,notes
    });
    if(state.pendingReviewMode)advancePendingReview(p.id);
    else moveToNextUndecided();
    await persistPilotCursor();paint();return;
  }
  if(action==='print'){window.print();}
}
async function handleChange(event){
  const unitPicker=event.target.closest('.mp-edit-unit-select');
  if(unitPicker){
    const custom=unitPicker.closest('label')?.querySelector('.mp-edit-unit-other');
    if(custom){
      custom.hidden=unitPicker.value!=='__OTHER__';
      if(!custom.hidden){
        showSelectedStatus(unitPicker.closest('[data-mp-edit-row]'),'Escribe tu unidad…','editing');
        custom.focus();
        return;
      }
    }
    scheduleSelectedSave(unitPicker.closest('[data-mp-edit-row]'),0);
    return;
  }
  const decisionPicker=event.target.closest('.mp-edit-decision');
  if(decisionPicker){scheduleSelectedSave(decisionPicker.closest('[data-mp-edit-row]'),0);return;}
  const qtyPicker=event.target.closest('.mp-edit-quantity');
  if(qtyPicker){scheduleSelectedSave(qtyPicker.closest('[data-mp-edit-row]'),0);return;}
  const picker=event.target.closest('[data-mp-category-picker]');
  if(!picker)return;
  const chosen=groups().find(group=>group.id===picker.value);
  if(!chosen)return;
  state.pendingReviewMode=false;
  state.currentCategory=chosen.id;
  state.cursor=Math.max(0,chosen.products.findIndex(product=>!findRow(product.id)));
  await persistPilotCursor();paint();
}
async function handleSubmit(event){
  if(event.target?.id!=='mpExtraForm')return;
  event.preventDefault();
  const data=new FormData(event.target);
  await localChange({
    kind:'EXTRA',itemId:createLocalId('extra'),
    description:data.get('description'),decision:data.get('decision'),
    quantity:data.get('quantity'),unit:data.get('unit'),notes:data.get('notes')
  });
  state.page='selected';paint();
}
function showError(error){
  state.error=String(error?.message||error||'Error al abrir piloto');
  console.error('VIGÍA Monitor piloto:',error);paint();
}
