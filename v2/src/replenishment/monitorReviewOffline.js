// Cola LOCAL independiente del sync V2: sin escrituras de stock.
// Datos por almacén/usuario/semana, persistidos en SETTINGS de IndexedDB.
import { STORES, get, runTransaction, requestToPromise } from '../storage/database.js';
import { createLocalId } from '../core/ids.js';
import { apiRequest } from '../api/apiClient.js';

const PREFIX = 'vigia.monitor.review.offline.v1';
const inFlight = new Map();
export const REVIEW_LOCAL_STATUS = Object.freeze({
  LOCAL: 'LOCAL',
  SYNCED: 'SYNCED',
  CONFLICT: 'CONFLICT'
});

export function reviewLocalKey({ workspaceId, userId, weekStart }) {
  const a = required(workspaceId,'Almacén');
  const b = required(userId,'Usuario');
  const c = validMonday(weekStart);
  return [PREFIX,encodeURIComponent(a),encodeURIComponent(b),c].join(':');
}

// Lectura sin modificar nada: incorpora operaciones sin sincronizar.
export async function readMonitorReview(options) {
  const key = reviewLocalKey(options);
  const record = (await get(STORES.SETTINGS,key))?.value || blank(key,options);
  return describe(record);
}

export async function queueMonitorReviewChange(options, change) {
  const key = reviewLocalKey(options);
  const prepared = normalizeChange(change);
  const mutationId = createLocalId('monitor');
  return update(key,options,current=>{
    const prior = [...current.queue].reverse().find(
      x => x.change.itemKey === prepared.itemKey
    );
    const baseline = Number(current.remote[prepared.itemKey]?.version || 0);
    const expectedVersion = prior
      ? prior.expectedVersion + 1
      : baseline;
    current.queue.push({
      mutationId,change:prepared,expectedVersion,
      status:'PENDING',createdAt:new Date().toISOString(),
      conflict:null
    });
    return current;
  });
}

// Un cliente puede detenerse aquí si no hay red. Todos los eventos permanecen en IndexedDB.
export async function syncMonitorReview(options,{
  request=apiRequest,
  isOnline=()=>typeof navigator === 'undefined' || navigator.onLine !== false
}={}) {
  const key=reviewLocalKey(options);
  if(inFlight.has(key))return inFlight.get(key);
  const task=runSync(key,options,request,isOnline).finally(()=>inFlight.delete(key));
  inFlight.set(key,task);
  return task;
}

async function runSync(key,options,request,isOnline) {
  if(!isOnline())return { ...(await readMonitorReview(options)), network:'OFFLINE' };
  const week=validMonday(options.weekStart);
  const url='/api/v1/monitor/reviews/'+encodeURIComponent(week);
  const sent=new Set();

  // Se envía siempre en orden; un 409 suspende las ediciones del mismo elemento.
  while(true){
    const state=(await get(STORES.SETTINGS,key))?.value || blank(key,options);
    const next=state.queue.find(item=>item.status==='PENDING' &&
      !sent.has(item.mutationId) &&
      !state.queue.some(other=>other.status==='CONFLICT' &&
        other.change.itemKey===item.change.itemKey));
    if(!next)break;
    const body={
      ...next.change.payload,
      mutationId:next.mutationId,
      expectedVersion:next.expectedVersion
    };
    try {
      const response=await request(url+'/items',{method:'PUT',body});
      sent.add(next.mutationId);
      await update(key,options,current=>{
        const index=current.queue.findIndex(x=>x.mutationId===next.mutationId);
        // Nunca eliminar un evento diferente que fue creado mientras enviábamos.
        if(index>=0){
          current.queue.splice(index,1);
          const row=response.item;
          const currentRemote=current.remote[next.change.itemKey];
          if(row && (!currentRemote || Number(row.version)>=Number(currentRemote.version))) {
            current.remote[next.change.itemKey]=row;
          }
        }
        return current;
      });
    }catch(error){
      if(error?.status===409){
        sent.add(next.mutationId);
        await update(key,options,current=>{
          const found=current.queue.find(x=>x.mutationId===next.mutationId);
          if(found){
            found.status='CONFLICT';
            found.conflict={
              code:error.code||'REVIEW_CONFLICT',
              message:String(error.message||'Conflicto entre dispositivos'),
              remote:error.details?.latest??null
            };
          }
          return current;
        });
        continue;
      }
      // Error de autenticación, servidor, conexión o rate limit: SIN borrar nada.
      return {
        ...(await readMonitorReview(options)),
        network:'RETRY_LATER',
        errorCode:error?.code||'NETWORK_ERROR'
      };
    }
  }
  try {
    const answer=await request(url);
    await update(key,options,current=>{
      const nextRemote={};
      for(const row of answer.items||[]){
        if(row?.itemKey)nextRemote[row.itemKey]=row;
      }
      // Se conserva cada edición local PENDING/CONFLICT aunque el servidor difiera.
      current.remote=nextRemote;
      current.lastFetchedAt=new Date().toISOString();
      return current;
    });
  }catch(error){
    return {
      ...(await readMonitorReview(options)),
      network:'RETRY_LATER',
      errorCode:error?.code||'NETWORK_ERROR'
    };
  }
  return { ...(await readMonitorReview(options)),network:'ONLINE' };
}

// Conserva la revisión local conflictiva; requiere acto humano para decidir qué hacer.
// No descarta cola ni modifica el servidor.
export async function inspectMonitorReviewConflicts(options) {
  const state=await readMonitorReview(options);
  return state.queue.filter(x=>x.status==='CONFLICT');
}

function describe(value) {
  const remote={...value.remote};
  const queue=value.queue.map(x=>({...x,change:{...x.change,payload:{...x.change.payload}}}));
  for(const event of queue){
    const key=event.change.itemKey;
    remote[key]={
      ...(remote[key]||{}),
      ...event.change.payload,
      itemKey:key,
      kind:event.change.payload.kind,
      productId:event.change.payload.kind==='PRODUCT'?event.change.payload.itemId:null,
      extraId:event.change.payload.kind==='EXTRA'?event.change.payload.itemId:null,
      localOnly:true,
      localStatus:event.status
    };
  }
  const hasConflicts=queue.some(x=>x.status==='CONFLICT');
  return {
    weekStart:value.weekStart,workspaceId:value.workspaceId,
    items:Object.values(remote).sort((a,b)=>a.itemKey.localeCompare(b.itemKey)),
    queue,
    pendingCount:queue.filter(x=>x.status==='PENDING').length,
    conflictCount:queue.filter(x=>x.status==='CONFLICT').length,
    status:hasConflicts?'CONFLICT':queue.length?'LOCAL':'SYNCED',
    lastFetchedAt:value.lastFetchedAt||null
  };
}

function blank(key,options) {
  return {
    key,version:1,workspaceId:String(options.workspaceId),userId:String(options.userId),
    weekStart:validMonday(options.weekStart),remote:{},queue:[],lastFetchedAt:null
  };
}

function update(key,options,mutate) {
  return runTransaction(STORES.SETTINGS,'readwrite',async store=>{
    const record=await requestToPromise(store.get(key));
    const current=record?.value || blank(key,options);
    // Cambios en la misma pestaña o en otra se serializan en una transacción IDB.
    const value=mutate(current);
    await requestToPromise(store.put({key,value,updatedAt:new Date().toISOString()}));
    return describe(value);
  });
}

function normalizeChange(change){
  const kind=String(change?.kind||'');
  if(kind!=='PRODUCT'&&kind!=='EXTRA')throw new Error('Tipo inválido');
  const itemId=required(change.itemId,'ID artículo');
  if(!/^[a-zA-Z0-9_.:-]{1,150}$/.test(itemId))throw new Error('ID de artículo inválido');
  const decision=String(change.decision||'');
  const choices=['UNREVIEWED','BUY','ORDER','NOT_NEEDED','PENDING'];
  if(!choices.includes(decision)||(kind==='EXTRA'&&!['BUY','ORDER'].includes(decision))){
    throw new Error('Decisión inválida');
  }
  const raw=change.quantity;
  const quantity=raw==null||raw===''?null:Number(raw);
  if(quantity!==null&&(!Number.isFinite(quantity)||quantity<=0||quantity>1000000000)){
    throw new Error('Cantidad positiva o en blanco');
  }
  const unit=String(change.unit??'').trim();
  const notes=String(change.notes??'').trim();
  const description=kind==='EXTRA'?required(change.description,'Descripción extra'):undefined;
  if(unit.length>40||notes.length>500||description?.length>180)throw new Error('Texto demasiado largo');
  if(kind==='PRODUCT'&&change.deleted===true)throw new Error('El producto no se elimina desde revisión');
  const payload={
    kind,itemId,decision,quantity,unit,notes,
    deleted:kind==='EXTRA'&&change.deleted===true,
    ...(kind==='EXTRA'?{description}:{})
  };
  return {itemKey:(kind==='PRODUCT'?'product:':'extra:')+itemId,payload};
}
function validMonday(week){
  const value=String(week||'');
  const time=new Date(value+'T00:00:00Z');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||
    !Number.isFinite(time.getTime())||time.toISOString().slice(0,10)!==value||
    time.getUTCDay()!==1)throw new Error('Fecha de inicio semanal debe ser un lunes válido');
  return value;
}
function required(x,label){
  const value=String(x??'').trim();
  if(!value)throw new Error(label+' obligatorio');
  return value;
}
