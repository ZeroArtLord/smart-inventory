import {apiRequest} from '../api/apiClient.js';
import {get,put,STORES} from '../storage/database.js';
function key(context){return 'vigia.monitor.supplier.draft:'+JSON.stringify([context.workspaceId,context.userId,context.weekStart,context.round||1]);}
export async function readSupplierDraft(context){return (await get(STORES.SETTINGS,key(context)))?.value||{};}
export async function writeSupplierDraft(context,value){await put(STORES.SETTINGS,{key:key(context),value});}
export const supplierApi={
 load:context=>apiRequest('/api/v1/monitor/reviews/'+context.weekStart+'/supplier-orders'),
 saveSupplier:(id,body)=>apiRequest('/api/v1/monitor/suppliers/'+encodeURIComponent(id),{method:'PUT',body}),
 assign:(context,itemKey,body)=>apiRequest('/api/v1/monitor/reviews/'+context.weekStart+'/supplier-assignments/'+encodeURIComponent(itemKey),{method:'PUT',body:{round:context.round,...body}}),
 finalize:(context,fingerprint)=>apiRequest('/api/v1/monitor/reviews/'+context.weekStart+'/supplier-orders',{method:'POST',body:{round:context.round,fingerprint}}),
 sent:id=>apiRequest('/api/v1/monitor/supplier-orders/'+encodeURIComponent(id)+'/sent',{method:'POST',body:{}})
};
