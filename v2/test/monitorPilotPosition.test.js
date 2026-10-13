import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  pilotPositionKey,readPilotPosition,savePilotPosition,restorePilotPosition
} from '../src/ui/monitorPilotPosition.js';

const a={workspaceId:'warehouse-alpha',userId:'member-01',weekStart:'2026-10-12'};
const groups=[{id:'bebidas',products:[{id:'pepsi'},{id:'agua'}]},{id:'alimentos',products:[{id:'arroz'}]}];

test('guarda y recupera exactamente la categoría y producto al recargar',async()=>{
  await savePilotPosition(a,{categoryId:'bebidas',productId:'agua',page:'review'});
  const saved=await readPilotPosition(a);
  assert.equal(saved.productId,'agua');
  assert.deepEqual(restorePilotPosition(saved,groups),{categoryId:'bebidas',cursor:1,page:'review'});
});
test('diferentes usuarios no comparten posición, aunque sí revisión de servidor',async()=>{
  const b={...a,userId:'member-02'};
  assert.notEqual(pilotPositionKey(a),pilotPositionKey(b));
  assert.equal(await readPilotPosition(b),null);
});
test('no recupera una categoría que ya no existe',()=>{
  assert.equal(restorePilotPosition({categoryId:'deleted',productId:'pepsi'},groups),null);
});
test('un artículo retirado vuelve a inicio de categoría y no falla',()=>{
  assert.deepEqual(restorePilotPosition({categoryId:'bebidas',productId:'deleted'},groups),{categoryId:'bebidas',cursor:0,page:'review'});
});
test('rechaza claves para semana inválida',()=>{
  assert.throws(()=>pilotPositionKey({...a,weekStart:'2026-10-11'}),/lunes/);
});
