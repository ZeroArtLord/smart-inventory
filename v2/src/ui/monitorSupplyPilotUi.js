// Piloto opcional para Surtidos y Reportes; no sustituye Surtidos V2.
// Nunca usa el libro de stock. Se abre sólo con sesión y permiso existente.
import {STORES,getAll} from '../storage/database.js';
import {listAreas} from '../areas/areaService.js';
import {listAreaDeliveries} from '../areas/supplyAreaDeliveryService.js';
import {resolveMonitorPilotSession} from '../replenishment/monitorPilotSession.js';
import {
  addMonitorSupplyLine,updateMonitorSupplyLine,removeMonitorSupplyLine
} from '../documents/monitorSupplyModel.js';
import {
  loadMonitorSupplyDraft,saveMonitorSupplyDraft,commitMonitorSupplyDraft
} from '../documents/monitorSupplyDraftStore.js';
import {
  listMonitorSupplyOutbox,flushPendingMonitorSupplies,
  getMonitorRecordedSupplies,getMonitorSupplyConsumption
} from '../documents/monitorSupplyOutbox.js';

const root=document.getElementById('app');
let dialog=null,supplyButton=null,reportButton=null;
const state={
  mode:'supply',visible:false,busy:false,session:null,identity:null,
  draft:null,products:[],areas:[],pending:[],history:[],consumption:[],
  legacy:[],reportFrom:monthAgo(),network:'unknown',message:'',error:'',
  reportHasMore:false
};
if(root){
  supplyButton=launcher('vsSupplyLauncher','✦ Surtidos Monitor (piloto)');
  reportButton=launcher('vsReportLauncher','✦ Reportes Monitor (piloto)');
  dialog=document.createElement('section');
  dialog.id='vigiaMonitorSupplyPilot';dialog.hidden=true;
  dialog.setAttribute('aria-label','Piloto de Surtidos y Reportes VIGÍA Monitor');
  document.body.append(dialog);
  new MutationObserver(checkLauncher).observe(root,{childList:true,subtree:true});
  checkLauncher();
  supplyButton.addEventListener('click',()=>open('supply').catch(fail));
  reportButton.addEventListener('click',()=>open('reports').catch(fail));
  dialog.addEventListener('click',event=>handleClick(event).catch(fail));
  dialog.addEventListener('submit',event=>handleSubmit(event).catch(fail));
  dialog.addEventListener('change',event=>handleChange(event).catch(fail));
  window.addEventListener('online',()=>{
    if(state.visible&&!document.body.classList.contains('auth-locked')){
      retryPending().catch(fail);
      if(state.mode==='reports')loadReports().catch(fail);
    }
  });
}
function launcher(id,label){
  const b=document.createElement('button');
  b.id=id;b.type='button';b.hidden=true;b.textContent=label;
  b.className='vs-launcher';document.body.append(b);return b;
}
function hasAnyPermission(session,permissions){
  const list=Array.isArray(session?.permissions)?session.permissions:[];
  return list.includes('*')||permissions.some(p=>list.includes(p));
}
function checkLauncher(){
  if(document.body.classList.contains('auth-locked')){
    if(state.visible)close();supplyButton.hidden=true;reportButton.hidden=true;return;
  }
  const title=String(root?.querySelector('h2')?.textContent||'').trim().toLowerCase();
  supplyButton.hidden=state.visible||!title.startsWith('surtidos');
  reportButton.hidden=state.visible||title!=='reportes';
}
async function open(mode){
  state.mode=mode;state.visible=true;state.busy=true;
  state.error='';state.message='';
  dialog.hidden=false;document.body.style.overflow='hidden';checkLauncher();paint();
  try{
    const permissions=mode==='supply'?['supply.write']:['reports.view','supply.write'];
    const session=await resolveMonitorPilotSession({requiredAnyPermissions:permissions});
    if(!hasAnyPermission(session,permissions))throw new Error('Sin permisos para este módulo');
    state.session=session;
    state.identity={workspaceId:session.workspaceId,userId:session.userId};
    if(mode==='supply'){
      const [products,areas,draft]=await Promise.all([
        getAll(STORES.PRODUCTS),listAreas({refresh:false}),loadMonitorSupplyDraft(state.identity)
      ]);
      state.products=products.filter(p=>p?.id && p.active!==false)
        .sort((a,b)=>String(a.name||'').localeCompare(String(b.name||''),'es'));
      state.areas=areas.filter(a=>a?.id&&a.active!==false);
      state.draft=draft;
      state.pending=await listMonitorSupplyOutbox(state.identity);
    }else{
      await loadReports();
    }
    state.busy=false;paint();
    await retryPending();
  }catch(error){
    state.busy=false;fail(error);
  }
}
function close(){
  state.visible=false;dialog.hidden=true;document.body.style.overflow='';
  state.session=null;state.identity=null;state.draft=null;
  state.history=[];state.consumption=[];state.legacy=[];
  checkLauncher();
}
async function retryPending(){
  if(!state.identity||state.session?.cachedOffline||
    typeof navigator!=='undefined'&&navigator.onLine===false)return;
  const result=await flushPendingMonitorSupplies(state.identity);
  if(!state.visible)return;
  state.pending=await listMonitorSupplyOutbox(state.identity);
  if(result.synchronized>0){
    state.message=result.synchronized+' entrega(s) confirmadas en el servidor';
    if(state.mode==='reports')await loadReports();
  }
  paint();
}
async function loadReports(){
  const canGet=typeof navigator==='undefined'||navigator.onLine!==false;
  const from=state.reportFrom||null;
  // Historial antiguo V2 se presenta POR SEPARADO; no sumar inventario,
  // movimientos ni entregas V2 con los nuevos surtidos Monitor.
  state.legacy=await listAreaDeliveries({from,refresh:false}).catch(()=>[]);
  if(!canGet||state.session?.cachedOffline){
    state.network='OFFLINE';state.history=[];state.consumption=[];
    state.pending=state.identity?await listMonitorSupplyOutbox(state.identity):[];
    return;
  }
  try{
    const [history,summary,pending]=await Promise.all([
      getMonitorRecordedSupplies({from,limit:100}),
      getMonitorSupplyConsumption({from}),
      listMonitorSupplyOutbox(state.identity)
    ]);
    state.history=history.deliveries||[];
    state.reportHasMore=history.nextOffset!==null;
    state.consumption=summary.lines||[];
    state.pending=pending;
    state.network='ONLINE';
  }catch(error){
    // No simular "0 entregas" si falló el servidor.
    state.history=[];state.consumption=[];
    state.network='ERROR';state.error='No fue posible consultar los reportes nuevos: '+error.message;
  }
}
function escape(value){
  return String(value??'').replace(/[&<>"']/g,ch=>({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  })[ch]);
}
function btn(label,action,extra=''){
  return '<button class="vs-btn" type="button" data-vs-action="'+escape(action)+'" '+extra+'>'+label+'</button>';
}
function paint(){
  if(!state.visible)return;
  const isReport=state.mode==='reports';
  const header='<header class="vs-header"><div><small>VIGÍA MONITOR · PILOTO SEPARADO</small>'+
    '<h1>'+(isReport?'Reportes de entregas':'Surtidos a las áreas')+'</h1>'+
    '<p>'+ (isReport?'Reportes de entregas reales; no son existencias':'Registrar lo que realmente salió, sin bloquear por stock')+
    '</p></div>'+btn('Cerrar ✕','close')+'</header>';
  dialog.innerHTML='<div class="vs-wrapper">'+header+
    '<div class="vs-toolbar">'+(isReport?btn('Actualizar','refresh'):btn('↻ Reintentar pendientes','retry'))+
    '<span class="vs-muted">Versión de pruebas · sin afectar inventario</span></div>'+
    (state.busy?'<article class="vs-card">Cargando datos…</article>':'')+
    (state.error?'<div class="vs-error">'+escape(state.error)+'</div>':'')+
    (state.message?'<div class="vs-message">'+escape(state.message)+'</div>':'')+
    (!state.busy?(isReport?renderReports():renderSupply()):'')+'</div>';
}
function renderSupply(){
  if(!state.draft)return '<article class="vs-card">No se pudo recuperar el carrito.</article>';
  const d=state.draft;
  const options=state.products.map(p=>'<option value="'+escape(p.id)+'">'+
    escape(p.name||p.id)+'</option>').join('');
  const areas=state.areas.map(a=>'<option value="'+escape(a.id)+'" '+
    (a.id===d.destinationAreaId?'selected':'')+'>'+escape(a.name)+'</option>').join('');
  const lines=Object.values(d.lines||{});
  const display=lines.map(row=>'<div class="vs-line"><div><strong>'+escape(row.productName)+
    '</strong><small>'+escape(row.quantity)+' '+escape(row.unit)+
    (row.note?' · '+escape(row.note):'')+'</small></div>'+
    btn('Quitar','remove','data-vs-id="'+escape(row.productId)+'" data-vs-unit="'+escape(row.unit)+'"')+
    '</div>').join('');
  const pending=state.pending.filter(p=>p.status==='PENDING').length;
  const conflicts=state.pending.filter(p=>p.status==='CONFLICT').length;
  return '<div class="vs-stats"><div><b>'+lines.length+'</b><small>Líneas en el carrito</small></div>'+
    '<div><b>'+pending+'</b><small>Entregas por enviar</small></div>'+
    '<div><b>'+conflicts+'</b><small>Conflictos por resolver</small></div></div>'+
    '<article class="vs-card"><h2>Destino y fecha</h2>'+
    '<div class="vs-fields"><label>Área a la que se entregó *<select id="vsArea" data-vs-field="area">'+
    '<option value="">Selecciona un área</option>'+areas+'</select></label>'+
    '<label>Fecha real de entrega *<input id="vsDate" type="date" data-vs-field="date" value="'+
    escape(d.operationalDate)+'"></label></div>'+
    '<label>Observación del surtido<textarea id="vsNotes" data-vs-field="notes" maxlength="500" rows="2">'+
    escape(d.notes||'')+'</textarea></label></article>'+
    '<article class="vs-card"><h2>Agregar producto</h2>'+
    '<form id="vsAddForm"><div class="vs-fields">'+
    '<label>Producto del catálogo<select name="productId" required>'+options+'</select></label>'+
    '<label>Cantidad entregada<input name="quantity" required min="0.000001" step="any" inputmode="decimal" type="number" placeholder="Ej. 3"></label>'+
    '<label>Unidad / presentación<input name="unit" maxlength="40" required value="UND" placeholder="UND, KG, CAJA"></label>'+
    '<label>Detalle opcional<input name="note" maxlength="250" placeholder="Observación"></label></div>'+
    '<button class="vs-primary" type="submit">+ Agregar al carrito</button></form></article>'+
    '<article class="vs-card"><h2>Carrito de entrega</h2>'+
    (display||'<p class="vs-muted">Todavía no hay productos en esta entrega.</p>')+
    '<div class="vs-actions">'+btn('Registrar entrega','confirm','class="vs-btn vs-primary"')+'</div>'+
    '<p class="vs-muted">Al confirmar se guarda primero en este dispositivo y luego se intenta enviar. Imprimir y registrar no modifican stock.</p></article>'+
    '<article class="vs-card"><h2>Entregas pendientes de enviar</h2>'+
    (state.pending.length?state.pending.map(p=>'<div class="vs-line"><div><strong>'+
      escape(p.delivery.id)+'</strong><small>'+escape(p.status)+
      ' · '+escape(p.delivery.operationalDate)+' · '+escape(p.delivery.lines.length)+' productos</small></div>'+
      '</div>').join(''):'<p class="vs-muted">No hay entregas pendientes ni conflictos locales.</p>')+
    '</article>';
}
function renderReports(){
  const pending=state.pending.filter(x=>x.status==='PENDING').length;
  const isOnline=state.network==='ONLINE';
  const summary=state.consumption.map(item=>'<tr><td>'+escape(item.areaName)+
    '</td><td>'+escape(item.productName)+'</td><td>'+escape(item.quantity)+
    '</td><td>'+escape(item.unit)+'</td></tr>').join('');
  const history=state.history.map(item=>'<div class="vs-line"><div><strong>'+
    escape(item.destinationAreaName||item.destinationAreaId)+'</strong><small>'+
    escape(item.operationalDate)+' · '+escape(item.lines?.length||0)+' líneas · '+
    escape(item.id)+'</small></div><small>'+escape(item.recordedBy||'')+'</small></div>').join('');
  return '<article class="vs-card"><h2>Consulta por fecha</h2>'+
    '<div class="vs-fields"><label>Desde<input id="vsReportFrom" data-vs-field="from" type="date" value="'+escape(state.reportFrom)+'"></label>'+
    '<div><p class="vs-muted">Solo entregas registradas, no existencias ni gastos.</p>'+
    btn('Aplicar filtro','refresh')+'</div></div></article>'+
    '<article class="vs-card"><h2>Surtidos Monitor registrados</h2>'+
    '<p class="vs-muted">'+(isOnline?'Datos confirmados desde el servidor.':
      'No hay conexión con el servidor. No mostramos un falso resultado de cero.')+
    '</p>'+
    (isOnline?'<div class="vs-stats"><div><b>'+state.history.length+
      (state.reportHasMore?'+':'')+'</b><small>Últimos documentos mostrados (máx. 100)</small></div>'+
      '<div><b>'+state.consumption.length+'</b><small>Grupos por área, producto y unidad</small></div>'+
      '<div><b>'+pending+'</b><small>Pendientes locales, fuera del total</small></div></div>'+
      '<div class="vs-lines">'+(history||'<p class="vs-muted">Sin entregas registradas en este período.</p>')+'</div>'+
      '<h3>Consumo por área</h3><div class="vs-table-wrap"><table><thead><tr>'+
      '<th>Área</th><th>Producto</th><th>Cantidad</th><th>Unidad</th></tr></thead>'+
      '<tbody>'+(summary||'<tr><td colspan="4">Sin datos de entregas</td></tr>')+'</tbody></table></div>':'')+
    '</article><article class="vs-card"><h2>Historial anterior de VIGÍA V2 (separado)</h2>'+
    '<p>En este navegador existen <b>'+state.legacy.length+
    '</b> distribuciones antiguas cerradas dentro del filtro. El análisis histórico completo sigue en Reportes V8.</p>'+
    '<p class="vs-muted">No se suman los movimientos antiguos con los nuevos: pueden representar el mismo surtido y tener presentaciones diferentes. El dato anterior es solo el caché local disponible, no un total oficial del servidor.</p>'+
    btn('Volver a Reportes V8','close')+'</article>';
}
async function persistDraft(updated){
  state.draft=await saveMonitorSupplyDraft(state.identity,updated);
  state.error='';state.message='Borrador guardado en este dispositivo';
}
async function handleChange(event){
  const field=event.target.dataset.vsField;
  if(field==='from'){state.reportFrom=event.target.value;return;}
  if(!field||!state.draft)return;
  const d={...state.draft};
  if(field==='area')d.destinationAreaId=event.target.value;
  if(field==='date')d.operationalDate=event.target.value;
  if(field==='notes')d.notes=event.target.value;
  d.updatedAt=new Date().toISOString();
  await persistDraft(d);
  // No re-render mientras haya formulario enfocado.
}
async function handleSubmit(event){
  if(event.target.id!=='vsAddForm')return;
  event.preventDefault();
  if(!state.identity)throw new Error('Sesión no válida');
  const data=new FormData(event.target);
  const product=state.products.find(p=>p.id===data.get('productId'));
  if(!product)throw new Error('Producto no encontrado en el catálogo local');
  const updated=addMonitorSupplyLine(state.draft,{
    productId:product.id,productName:product.name,
    quantity:data.get('quantity'),unit:data.get('unit'),note:data.get('note')
  });
  await persistDraft(updated);paint();
}
async function handleClick(event){
  const node=event.target.closest('[data-vs-action]');
  if(!node)return;
  event.preventDefault();
  const action=node.dataset.vsAction;
  if(action==='close')return close();
  if(action==='retry'){
    await retryPending();
    state.message='Se revisaron las entregas pendientes';
    paint();return;
  }
  if(action==='refresh'){
    state.busy=true;state.error='';paint();
    try{await loadReports();}
    finally{state.busy=false;paint();}
    return;
  }
  if(action==='remove'){
    const next=removeMonitorSupplyLine(state.draft,{
      productId:node.dataset.vsId,unit:node.dataset.vsUnit
    });
    await persistDraft(next);paint();return;
  }
  if(action==='confirm'){
    if(state.busy)return;
    state.busy=true;state.error='';
    try{
      const result=await commitMonitorSupplyDraft(state.identity,state.draft);
      state.draft=result.next;
      state.message='Entrega '+result.queued.delivery.id+' guardada. Se enviará sin duplicarse.';
      state.pending=await listMonitorSupplyOutbox(state.identity);
      await retryPending();
    }finally{state.busy=false;paint();}
  }
}
function fail(error){
  console.error('VIGÍA Monitor Surtidos piloto:',error);
  state.error=String(error?.message||error||'No se pudo completar la operación');
  state.busy=false;paint();
}
function monthAgo(){
  const d=new Date();d.setDate(d.getDate()-30);
  return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),
    String(d.getDate()).padStart(2,'0')].join('-');
}
