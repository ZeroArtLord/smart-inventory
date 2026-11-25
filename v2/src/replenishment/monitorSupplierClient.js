import {syncMonitorReview} from './monitorReviewOffline.js';
import {apiRequest} from '../api/apiClient.js';
import {get,put,STORES} from '../storage/database.js';
function key(context){return 'vigia.monitor.supplier.draft:'+JSON.stringify([context.workspaceId,context.userId,context.weekStart,context.round||1]);}
export async function readSupplierDraft(context){return (await get(STORES.SETTINGS,key(context)))?.value||{};}
export async function writeSupplierDraft(context,value){await put(STORES.SETTINGS,{key:key(context),value});}
async function requireSyncedReview(context){
  const state=await syncMonitorReview(context);
  if(state.network!=='ONLINE'||state.pendingCount||state.conflictCount)
    throw Error('Hay cambios de revisión sin sincronizar o en conflicto. Sincroniza antes de preparar pedidos.');
}
export const supplierApi={
 load:async context=>{await requireSyncedReview(context);return apiRequest('/api/v1/monitor/reviews/'+context.weekStart+'/supplier-orders');},
 saveSupplier:(id,body)=>apiRequest('/api/v1/monitor/suppliers/'+encodeURIComponent(id),{method:'PUT',body}),
 assign:(context,itemKey,body)=>apiRequest('/api/v1/monitor/reviews/'+context.weekStart+'/supplier-assignments/'+encodeURIComponent(itemKey),{method:'PUT',body:{round:context.round,...body}}),
 finalize:async(context,fingerprint)=>{await requireSyncedReview(context);return apiRequest('/api/v1/monitor/reviews/'+context.weekStart+'/supplier-orders',{method:'POST',body:{round:context.round,fingerprint}});},
 sent:id=>apiRequest('/api/v1/monitor/supplier-orders/'+encodeURIComponent(id)+'/sent',{method:'POST',body:{}})
};
export function reconcileSupplierDraft(draft,data){
  return Object.fromEntries(Object.entries(draft).filter(([key,change])=>
    data.items.some(i=>i.itemKey===key)&&
    !data.assignments.some(a=>a.itemKey===key&&a.supplierId===change.supplierId)));
}
