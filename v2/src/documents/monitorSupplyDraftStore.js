// Borrador de Surtidos Monitor por persona/almacén; no toca documentos ni cola V2.
import {STORES,get,put} from '../storage/database.js';
import {createLocalId} from '../core/ids.js';
import {createMonitorSupplyDraft,recordMonitorSupply} from './monitorSupplyModel.js';
import {getMonitorSupplyOutboxEntry,stageMonitorSupplyDelivery} from './monitorSupplyOutbox.js';

const PREFIX='vigia.monitor.supply.draft.v1:';
export function monitorSupplyDraftKey({workspaceId,userId}){
  if(!workspaceId||!userId)throw new Error('Identidad requerida para surtido');
  return PREFIX+encodeURIComponent(String(workspaceId))+':'+encodeURIComponent(String(userId));
}
export function localOperationalDate(now=new Date()){
  return [now.getFullYear(),String(now.getMonth()+1).padStart(2,'0'),String(now.getDate()).padStart(2,'0')].join('-');
}
export function newMonitorSupplyDraft(identity,{
  destinationAreaId='',operationalDate=localOperationalDate()
}={}){
  // El área se elige antes de la primera escritura. Un borrador nuevo
  // puede empezar sin ella, pero no se puede registrar sin seleccionarla.
  return {
    schemaVersion:1,id:createLocalId('ms'),workspaceId:String(identity.workspaceId),
    actorId:String(identity.userId),operationalDate,
    destinationAreaId,status:'DRAFT',notes:'',
    createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),
    lines:{}
  };
}
export async function saveMonitorSupplyDraft(identity,draft){
  if(!draft||draft.status!=='DRAFT'||draft.schemaVersion!==1||
    draft.workspaceId!==identity.workspaceId||draft.actorId!==identity.userId)
    throw new Error('Borrador de otro usuario, almacén o ya cerrado');
  const key=monitorSupplyDraftKey(identity);
  const value=structuredClone(draft);
  await put(STORES.SETTINGS,{key,value,updatedAt:new Date().toISOString()});
  return value;
}
export async function loadMonitorSupplyDraft(identity){
  const key=monitorSupplyDraftKey(identity);
  const existing=(await get(STORES.SETTINGS,key))?.value;
  if(existing && existing.workspaceId===identity.workspaceId&&existing.actorId===identity.userId &&
     existing.status==='DRAFT'){
    // Si el proceso cerró tras guardar en outbox pero antes de resetear la ficha,
    // el surtido registrado permanece en la cola: no reabrir el mismo borrador.
    if(!(await getMonitorSupplyOutboxEntry(identity,existing.id)))return existing;
  }
  const next=newMonitorSupplyDraft(identity);
  return saveMonitorSupplyDraft(identity,next);
}
export async function commitMonitorSupplyDraft(identity,draft){
  if(!draft?.destinationAreaId)throw new Error('Selecciona el área destinataria antes de registrar');
  const normalized=createMonitorSupplyDraft({
    id:draft.id,workspaceId:identity.workspaceId,
    operationalDate:draft.operationalDate,destinationAreaId:draft.destinationAreaId,
    actorId:identity.userId,notes:draft.notes,createdAt:draft.createdAt
  });
  // El modelo puro valida cada línea, incluso cantidades y unidades.
  const ready={
    ...normalized,
    lines:structuredClone(draft.lines),
    updatedAt:draft.updatedAt
  };
  const recorded=recordMonitorSupply(ready);
  const queued=await stageMonitorSupplyDelivery(identity,recorded);
  // Solo crear un nuevo carrito después del commit DURADERO al outbox.
  const next=newMonitorSupplyDraft(identity,{
    operationalDate:draft.operationalDate,destinationAreaId:draft.destinationAreaId
  });
  await saveMonitorSupplyDraft(identity,next);
  return {queued,next};
}
