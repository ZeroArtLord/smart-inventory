// VIGÍA Monitor: outbox separado de los movimientos y cola de sync V2.
// Usa el MISMO id al reintentar, incluso después de reiniciar el navegador.
import { STORES,get,getAll,runTransaction,requestToPromise } from '../storage/database.js';
import { apiRequest } from '../api/apiClient.js';

const PREFIX='vigia.monitor.supply.outbox.v1:';
const sending=new Map();

export function monitorSupplyOutboxKey({workspaceId,userId},deliveryId){
  const workspace=required(workspaceId,'Almacén');
  const user=required(userId,'Usuario');
  const id=required(deliveryId,'Identificador del surtido');
  return [PREFIX,encodeURIComponent(workspace),encodeURIComponent(user),encodeURIComponent(id)].join(':');
}

export async function stageMonitorSupplyDelivery(identity,document){
  const body=normalizeRecorded(document);
  const key=monitorSupplyOutboxKey(identity,body.id);
  return runTransaction(STORES.SETTINGS,'readwrite',async store=>{
    const previous=(await requestToPromise(store.get(key)))?.value;
    if(previous){
      if(JSON.stringify(previous.delivery)!==JSON.stringify(body))
        throw new Error('No se permite cambiar un surtido ya preparado para registrar');
      return previous;
    }
    const value={
      version:1,status:'PENDING',delivery:body,
      createdAt:new Date().toISOString(),recordedAt:null,conflict:null
    };
    await requestToPromise(store.put({key,value,updatedAt:value.createdAt}));
    return value;
  });
}

export async function getMonitorSupplyOutboxEntry(identity,id){
  const key=monitorSupplyOutboxKey(identity,id);
  return (await get(STORES.SETTINGS,key))?.value||null;
}

export async function listMonitorSupplyOutbox(identity,{includeSynced=false}={}){
  const prefix=monitorSupplyOutboxKey(identity,'_').slice(0,-1);
  const all=await getAll(STORES.SETTINGS);
  return all.filter(record=>String(record.key||'').startsWith(prefix))
    .map(record=>record.value)
    .filter(value=>value?.version===1 && value.delivery && (includeSynced||value.status!=='SYNCED'))
    .sort((a,b)=>String(a.createdAt).localeCompare(String(b.createdAt)));
}

export async function flushPendingMonitorSupplies(identity,{
  request=apiRequest,isOnline=()=>typeof navigator==='undefined'||navigator.onLine!==false,
  max=50
}={}){
  if(!Number.isInteger(max)||max<1||max>100)throw new Error('Límite de reintentos inválido');
  const pending=(await listMonitorSupplyOutbox(identity)).filter(x=>x.status==='PENDING').slice(0,max);
  const results=[];
  for(const row of pending){
    if(!isOnline())break;
    results.push(await flushMonitorSupplyDelivery(identity,row.delivery.id,{request,isOnline}));
  }
  return {
    attempted:results.length,
    synchronized:results.filter(x=>x.status==='SYNCED').length,
    conflicts:results.filter(x=>x.status==='CONFLICT').length,
    pending:(await listMonitorSupplyOutbox(identity)).filter(x=>x.status==='PENDING').length
  };
}

export async function flushMonitorSupplyDelivery(identity,id,{
  request=apiRequest,isOnline=()=>typeof navigator==='undefined'||navigator.onLine!==false
}={}){
  const key=monitorSupplyOutboxKey(identity,id);
  if(sending.has(key))return sending.get(key);
  const operation=performFlush(key,{request,isOnline})
    .finally(()=>sending.delete(key));
  sending.set(key,operation);
  return operation;
}

async function performFlush(key,{request,isOnline}){
  const old=(await get(STORES.SETTINGS,key))?.value;
  if(!old)throw new Error('No hay un surtido pendiente con ese identificador');
  if(old.status==='SYNCED'||old.status==='CONFLICT')return old;
  if(!isOnline())return old;

  try{
    const result=await request('/api/v1/monitor/supplies',{
      method:'POST',body:old.delivery
    });
    return transition(key,'PENDING',row=>({
      ...row,status:'SYNCED',recordedAt:result.delivery?.recordedAt||new Date().toISOString()
    }));
  }catch(error){
    if(error?.status===409){
      return transition(key,'PENDING',row=>({
        ...row,status:'CONFLICT',conflict:{
          code:error?.code||'MONITOR_SUPPLY_ID_CONFLICT',
          message:String(error.message||'Ese identificador ya pertenece a otra entrega')
        }
      }));
    }
    // Auth, desconexión o fallos de servidor: no borrar el borrador.
    return (await get(STORES.SETTINGS,key))?.value||old;
  }
}

export async function getMonitorRecordedSupplies({
  from=null,to=null,areaId=null,limit=100,offset=0
}={},request=apiRequest){
  const params=new URLSearchParams();
  if(from)params.set('from',from);
  if(to)params.set('to',to);
  if(areaId)params.set('areaId',areaId);
  params.set('limit',String(limit));
  params.set('offset',String(offset));
  return request('/api/v1/monitor/supplies?'+params.toString());
}

export async function getMonitorSupplyConsumption({
  from=null,to=null,areaId=null
}={},request=apiRequest){
  const params=new URLSearchParams();
  if(from)params.set('from',from);
  if(to)params.set('to',to);
  if(areaId)params.set('areaId',areaId);
  const suffix=params.toString();
  return request('/api/v1/monitor/supplies/consumption'+(suffix?'?'+suffix:''));
}

async function transition(key,expected,callback){
  return runTransaction(STORES.SETTINGS,'readwrite',async store=>{
    const record=await requestToPromise(store.get(key));
    if(!record)throw new Error('Surtido pendiente no encontrado');
    const current=record.value;
    if(current.status!==expected)return current;
    const updated=callback(current);
    await requestToPromise(store.put({key,value:updated,updatedAt:new Date().toISOString()}));
    return updated;
  });
}
function normalizeRecorded(document){
  if(!document||document.status!=='RECORDED'||!Array.isArray(document.lines)
    ||document.lines.length===0||document.lines.length>250){
    throw new Error('Solo se preparan surtidos cerrados con productos entregados');
  }
  const input={
    id:required(document.id,'Identificador'),
    operationalDate:required(document.operationalDate,'Fecha'),
    destinationAreaId:required(document.destinationAreaId,'Área'),
    notes:String(document.notes||'').trim(),
    lines:document.lines.map(line=>({
      productId:required(line.productId,'Producto'),
      quantity:Number(line.quantity),
      unit:required(line.unit,'Unidad'),
      note:String(line.note||'').trim()
    }))
  };
  if(!input.lines.every(line=>Number.isFinite(line.quantity)&&line.quantity>0))
    throw new Error('Una cantidad del surtido no es válida');
  return input;
}
function required(value,label){
  const text=String(value??'').trim();
  if(!text)throw new Error(label+' obligatorio');
  return text;
}
