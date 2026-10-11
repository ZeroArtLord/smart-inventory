// Posición del recorrido Monitor; aislada de borradores/colas V2.
// No contiene inventario y no otorga acceso sin sesión autenticada.
import { STORES, get, put } from '../storage/database.js';
import { reviewLocalKey } from '../replenishment/monitorReviewOffline.js';

const PREFIX='vigia.monitor.pilot.position.v1:';

export function pilotPositionKey(identity) {
  return PREFIX+reviewLocalKey(identity);
}

export async function readPilotPosition(identity) {
  const record=await get(STORES.SETTINGS,pilotPositionKey(identity));
  const data=record?.value;
  if(!data || data.version!==1)return null;
  return {
    categoryId:String(data.categoryId||''),
    productId:String(data.productId||''),
    page:['home','review','pending','selected','extras','lists'].includes(data.page)
      ?data.page:'home',
    updatedAt:data.updatedAt||null
  };
}

export async function savePilotPosition(identity,{
  categoryId='',productId='',page='review'
}={}) {
  const value={
    version:1,
    categoryId:String(categoryId||''),
    productId:String(productId||''),
    page:['home','review','pending','selected','extras','lists'].includes(page)?page:'home',
    updatedAt:new Date().toISOString()
  };
  await put(STORES.SETTINGS,{
    key:pilotPositionKey(identity),value,updatedAt:value.updatedAt
  });
  return value;
}

export function restorePilotPosition(position,groups) {
  const category=Array.isArray(groups)?groups.find(c=>c.id===position?.categoryId):null;
  if(!category || !category.products.length)return null;
  const idx=category.products.findIndex(p=>String(p.id)===position.productId);
  return {categoryId:category.id,cursor:Math.max(0,idx),page:'review'};
}
