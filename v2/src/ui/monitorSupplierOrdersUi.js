import {createLocalId} from '../core/ids.js';
import {buildSupplierOrderGroups,supplierOrderFingerprint,buildSupplierMessage,supplierWhatsAppUrl} from '../replenishment/monitorSupplierOrders.js';
import {supplierApi,readSupplierDraft,writeSupplierDraft} from '../replenishment/monitorSupplierClient.js';
const pages=new Set(['suppliers','supplier-assign','supplier-final']);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const button=(text,action,attrs='')=>'<button type="button" class="mp-button" data-ms-action="'+action+'" '+attrs+'>'+text+'</button>';
const emptySupplier=()=>({id:'',name:'',phone:'',active:true,version:0});
export function createMonitorSupplierPanel({host,getContext,repaint,notify}){
 let data=null,scope='',draft={},busy=false,error='',loading=false,loadEpoch=0,form=emptySupplier();
 function context(){return {...getContext()};}
 function currentKey(){return JSON.stringify(context());}
 function selections(){return Object.fromEntries((data?.items||[]).map(i=>[i.itemKey,
   draft[i.itemKey]?draft[i.itemKey].supplierId:(data.assignments.find(a=>a.itemKey===i.itemKey)?.supplierId||data.preferences[i.productId]||'')]));}
 async function load(){
   const ctx=context(),key=currentKey(),epoch=++loadEpoch;
   loading=true;error='';repaint();
   try{
     const [fresh,pending]=await Promise.all([supplierApi.load(ctx),readSupplierDraft(ctx)]);
     if(epoch!==loadEpoch||currentKey()!==key)return;
     if(fresh.round!==ctx.round)throw Error('La revisión cambió de ciclo. Cierra y vuelve a abrir Monitor.');
     data=fresh;scope=key;draft=Object.fromEntries(Object.entries(pending).filter(([itemKey])=>fresh.items.some(i=>i.itemKey===itemKey)));
     await writeSupplierDraft(ctx,draft);
   }catch(e){if(epoch===loadEpoch)error=e.message;}
   finally{if(epoch===loadEpoch){loading=false;repaint();}}
 }
 function reset(){++loadEpoch;data=null;scope='';draft={};error='';loading=false;form=emptySupplier();}
 function render(page){
   if(!pages.has(page))return '';
   if(scope!==currentKey()&&!loading&&!error)return '<div class="mp-card"><p>Preparando proveedores…</p>'+button('Cargar proveedores','refresh')+'</div>';
   const controls='<div class="mp-inline">'+button('↻ Actualizar','refresh')+'</div>';
   if(loading)return '<div class="mp-card"><p>Cargando proveedores y pedidos…</p></div>';
   let html='<div class="mp-card mp-suppliers">'+controls+(error?'<p class="mp-error" role="alert">'+esc(error)+'</p>':'');
   if(!data||scope!==currentKey())return html+'<p>Conecta con el servidor de VIGÍA y vuelve a actualizar.</p></div>';
   if(page==='suppliers'){
     html+='<h2>Proveedores</h2><form id="mpSupplierForm"><div class="mp-form">'+
       '<label>Nombre<input name="name" maxlength="160" required value="'+esc(form.name)+'"></label>'+
       '<label>WhatsApp / teléfono<input name="phone" type="tel" required placeholder="0414 1234567 o +código de país" value="'+esc(form.phone)+'"></label></div>'+
       '<label class="mp-supplier-active"><input type="checkbox" name="active" '+(form.active?'checked':'')+'> Proveedor activo</label>'+
       '<div class="mp-inline"><button class="mp-button mp-primary" type="submit" '+(busy?'disabled':'')+'>'+ (form.id?'Guardar proveedor':'Agregar proveedor')+'</button>'+button('Nuevo','new')+'</div></form>'+
       '<label>Buscar proveedor<input id="mpSupplierSearch" type="search" placeholder="Nombre o teléfono"></label>'+
       '<div id="mpSupplierRows">'+data.suppliers.map(s=>'<div class="mp-row" data-ms-search="'+esc((s.name+' '+s.phone).toLowerCase())+'"><div><strong>'+esc(s.name)+'</strong><div>'+esc(s.phone)+(s.active?'':' · Inactivo')+'</div></div>'+button('Editar','edit','data-ms-id="'+esc(s.id)+'"')+'</div>').join('')+'</div>';
   }
   if(page==='supplier-assign'){
     html+='<h2>Asignar pedidos</h2><p>Solo productos marcados como Pedir. Las sugerencias vienen de pedidos que confirmaste como enviados.</p>'+
       '<label>Buscar producto<input id="mpSupplierProductSearch" type="search" placeholder="Nombre del producto"></label>';
     const selected=selections();
     html+=data.items.map(i=>{
       const suggestion=!draft[i.itemKey]&&!data.assignments.some(a=>a.itemKey===i.itemKey)&&data.preferences[i.productId];
       return '<div class="mp-row mp-supplier-assignment" data-ms-search="'+esc(i.name.toLowerCase())+'"><div><strong>'+esc(i.name)+'</strong><div>'+esc(i.quantity??'Falta cantidad')+' '+esc(i.unit||'Falta empaque')+'</div>'+
       (suggestion?'<small>Sugerido según tu último pedido enviado</small>':'')+(draft[i.itemKey]?'<small>Asignación pendiente de guardar</small>':'')+'</div>'+
       '<div class="mp-supplier-picker"><input type="search" data-ms-filter="'+esc(i.itemKey)+'" placeholder="Buscar proveedor" aria-label="Buscar proveedor para '+esc(i.name)+'">'+
       '<select data-ms-assignment="'+esc(i.itemKey)+'" aria-label="Proveedor de '+esc(i.name)+'" '+(busy?'disabled':'')+'><option value="">Selecciona proveedor</option>'+
       data.suppliers.filter(s=>s.active||s.id===selected[i.itemKey]).map(s=>'<option value="'+esc(s.id)+'" '+(s.id===selected[i.itemKey]?'selected':'')+' '+(!s.active?'disabled':'')+'>'+esc(s.name)+(s.active?'':' · Inactivo')+'</option>').join('')+'</select></div></div>';
     }).join('')||'<p>No hay productos marcados como Pedir en este ciclo.</p>';
     html+='<p>Corrige la cantidad o el empaque en Seleccionados.</p><div class="mp-inline">'+button('Guardar asignaciones pendientes','retry',busy?'disabled':'')+button('Revisar y finalizar pedidos','review',busy?'disabled':'')+'</div>';
   }
   if(page==='supplier-final'){
     html+='<h2>Finalizar pedidos</h2><p>Cantidad, empaque y proveedor son obligatorios. Revisa el mensaje antes de abrir WhatsApp.</p>';
     try{
       const groups=buildSupplierOrderGroups({...data,selections:selections()});
       html+=groups.map(g=>'<div class="mp-card"><h3>Pedido para '+esc(g.supplier.name)+'</h3>'+g.items.map(i=>'<p>'+esc(i.quantity)+' '+esc(i.unit)+' — '+esc(i.name)+(i.notes?' ('+esc(i.notes)+')':'')+'</p>').join('')+'</div>').join('');
       html+=button('Finalizar y preparar mensajes','finalize',busy?'disabled':'');
     }catch(e){html+='<p class="mp-warning">'+esc(e.message)+'</p><p>Completa los datos en Seleccionados y Asignar pedidos.</p>';}
     html+='<h3>Pedidos preparados y enviados · recientes</h3>'+(data.orders.filter(o=>o.status!=='REPLACED').map(o=>{
       const editable=o.status==='FINALIZED';
       return '<div class="mp-card"><h3>Pedido para '+esc(o.supplier.name)+'</h3><p>'+esc(o.supplier.phone)+' · Semana '+esc(o.weekStart)+' · Ciclo '+esc(o.round)+' · '+(editable?'Pendiente de enviar':'Enviado · confirmado manualmente')+(o.replacesOrderId?' · Actualización de un pedido anterior':'')+'</p>'+
         '<pre class="mp-supplier-message">'+esc(buildSupplierMessage(o))+'</pre>'+ (editable?'<div class="mp-inline">'+
         button('Abrir en WhatsApp','whatsapp','data-ms-id="'+esc(o.id)+'"')+button('Copiar mensaje','copy','data-ms-id="'+esc(o.id)+'"')+
         button('Marcar como enviado','sent','data-ms-id="'+esc(o.id)+'" '+(busy?'disabled':''))+'</div>':'')+'</div>';
     }).join('')||'<p>Todavía no has finalizado pedidos en este ciclo.</p>');
   }
   return html+'</div>';
 }
 async function flush(){
   const ctx=context();
   for(const [itemKey,change] of Object.entries(draft)){
     if(!change.supplierId)throw Error('Selecciona proveedor para todos los productos pendientes');
     const r=await supplierApi.assign(ctx,itemKey,change);
     data.assignments=data.assignments.filter(a=>a.itemKey!==itemKey).concat(r.assignment);
     delete draft[itemKey];await writeSupplierDraft(ctx,draft);
   }
 }
 async function handleChange(event){
   const key=event.target.dataset.msAssignment;if(!key)return false;
   if(busy)return true;
   busy=true;error='';
   draft[key]={supplierId:event.target.value,expectedVersion:data.assignments.find(a=>a.itemKey===key)?.version||0};
   repaint();
   try{await writeSupplierDraft(context(),draft);await flush();}catch(e){error=e.message;}
   finally{busy=false;repaint();}return true;
 }
 function handleInput(event){
   if(event.target.closest('#mpSupplierForm')){
     const f=event.target.closest('form');form={...form,name:f.elements.name.value,phone:f.elements.phone.value,active:f.elements.active.checked};return;
   }
   const filter=event.target.dataset.msFilter;
   if(filter){
     const select=event.target.parentElement.querySelector('select');
     const query=event.target.value.toLocaleLowerCase('es');
     for(const option of select.options)option.hidden=!!option.value&&option.value!==select.value&&!option.textContent.toLocaleLowerCase('es').includes(query);
   }
   if(['mpSupplierSearch','mpSupplierProductSearch'].includes(event.target.id)){
     const query=event.target.value.toLocaleLowerCase('es');
     for(const row of host.querySelectorAll('[data-ms-search]'))row.hidden=!row.dataset.msSearch.includes(query);
   }
 }
 async function handleSubmit(event){
   if(event.target.id!=='mpSupplierForm')return false;event.preventDefault();if(busy)return true;
   const f=new FormData(event.target);form={...form,name:f.get('name'),phone:f.get('phone'),active:f.get('active')==='on'};
   form.id ||= createLocalId('supplier');
   busy=true;error='';repaint();
   try{await supplierApi.saveSupplier(form.id,{...form,expectedVersion:form.version});form=emptySupplier();await load();notify('Proveedor guardado.');}
   catch(e){error=e.message;}finally{busy=false;repaint();}return true;
 }
 async function handleClick(event){
   const node=event.target.closest('[data-ms-action]');if(!node)return false;
   const action=node.dataset.msAction;
   if(action==='whatsapp'||action==='copy'){
     const o=data.orders.find(o=>o.id===node.dataset.msId);if(!o||o.status!=='FINALIZED')return true;
     if(action==='whatsapp'){
       const popup=window.open(supplierWhatsAppUrl(o),'_blank','noopener,noreferrer');
       // window.open devuelve null también con noopener; no inferir envío ni bloqueo.
       void popup;notify('Mensaje preparado. Revisa y envíalo en WhatsApp; después marca Enviado.');
     }else{
       try{await navigator.clipboard.writeText(buildSupplierMessage(o));notify('Mensaje copiado.');}
       catch{error='No se pudo copiar automáticamente. Selecciona y copia el mensaje que aparece arriba.';}
     }repaint();return true;
   }
   if(busy)return true;error='';
   if(action==='new'){form=emptySupplier();repaint();return true;}
   if(action==='edit'){form={...data.suppliers.find(s=>s.id===node.dataset.msId)};repaint();return true;}
   if(action==='review'){host.querySelector('[data-mp-page="supplier-final"]')?.click();return true;}
   busy=true;repaint();
   try{
     if(action==='refresh')await load();
     if(action==='retry')await flush();
     if(action==='finalize'){
       await flush();
       const fingerprint=supplierOrderFingerprint(buildSupplierOrderGroups({...data,selections:selections()}));
       await supplierApi.finalize(context(),fingerprint);await load();notify('Pedidos preparados. Abre cada mensaje y envíalo por WhatsApp.');
     }
     if(action==='sent'){
       if(!window.confirm('¿Ya enviaste este pedido por WhatsApp? Esta confirmación se guardará y se usará para sugerir el proveedor.'))return true;
       await supplierApi.sent(node.dataset.msId);await load();notify('Pedido marcado como enviado. Proveedor recordado para próximas revisiones.');
     }
   }catch(e){error=e.message;}finally{busy=false;repaint();}return true;
 }
 return {isBusy:()=>busy,hasPage:page=>pages.has(page),render,load,reset,handleClick,handleChange,handleInput,handleSubmit};
}
