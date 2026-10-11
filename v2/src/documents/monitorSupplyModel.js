// VIGÍA Monitor — surtidos informativos (NO escritura de inventario).
// Este módulo puro prepara documentos y resúmenes sin invocar movimientos V2.
export const MONITOR_SUPPLY_STATUS = Object.freeze({
  DRAFT: 'DRAFT',
  RECORDED: 'RECORDED'
});

export function createMonitorSupplyDraft({
  id,
  workspaceId,
  operationalDate,
  destinationAreaId,
  actorId,
  notes = '',
  createdAt = new Date().toISOString()
}) {
  const work = required(workspaceId,'Almacén');
  const actor = required(actorId,'Usuario');
  const draftId = required(id,'Identificador del surtido');
  const date = dateOnly(operationalDate);
  return {
    schemaVersion:1,
    id:draftId,
    workspaceId:work,
    operationalDate:date,
    destinationAreaId:required(destinationAreaId,'Área de destino'),
    actorId:actor,
    status:MONITOR_SUPPLY_STATUS.DRAFT,
    createdAt,
    updatedAt:createdAt,
    notes:short(notes,500,'Observaciones'),
    lines:{}
  };
}

// Cada artículo se identifica por producto y presentación/unidad.
// Repetirlo en el carrito acumula la cantidad; NO impone límites de stock.
export function addMonitorSupplyLine(draft,{
  productId,
  productName,
  quantity,
  unit,
  note = '',
  at = new Date().toISOString()
}) {
  assertDraft(draft);
  const pid=required(productId,'Producto');
  const name=required(productName,'Nombre');
  const itemUnit=required(unit,'Unidad');
  const amount=positive(quantity);
  const key=JSON.stringify([pid,itemUnit]);
  const old=draft.lines[key] || null;
  const row={
    key,
    productId:pid,
    productName:name,
    quantity:roundPrecision((old?.quantity||0)+amount),
    unit:itemUnit,
    note:short(note||old?.note||'',250,'Nota')
  };
  return {
    ...draft,
    updatedAt:at,
    lines:{...draft.lines,[key]:row}
  };
}

export function updateMonitorSupplyLine(draft,{
  productId,unit,quantity,note,at=new Date().toISOString()
}) {
  assertDraft(draft);
  const key=JSON.stringify([required(productId,'Producto'),required(unit,'Unidad')]);
  const row=draft.lines[key];
  if(!row)throw new Error('Artículo no encontrado');
  return {
    ...draft,
    updatedAt:at,
    lines:{...draft.lines,[key]:{
      ...row,
      quantity:quantity===undefined?row.quantity:positive(quantity),
      note:note===undefined?row.note:short(note,250,'Nota')
    }}
  };
}

export function removeMonitorSupplyLine(draft,{productId,unit,at=new Date().toISOString()}) {
  assertDraft(draft);
  const key=JSON.stringify([required(productId,'Producto'),required(unit,'Unidad')]);
  if(!draft.lines[key])return draft;
  const next={...draft.lines};
  delete next[key];
  return {...draft,lines:next,updatedAt:at};
}

// Cerrar equivale a ANOTAR ENTREGADO, NO a descontar stock.
export function recordMonitorSupply(draft,{at=new Date().toISOString()}={}) {
  assertDraft(draft);
  const lines=Object.values(draft.lines);
  if(!lines.length)throw new Error('El surtido debe tener productos entregados');
  if(!lines.every(x=>x.quantity>0))throw new Error('Hay cantidades inválidas');
  return {
    ...draft,
    status:MONITOR_SUPPLY_STATUS.RECORDED,
    recordedAt:at,
    updatedAt:at,
    lines:lines.map(x=>({...x}))
  };
}

// Agrupa sólo cantidades de la misma unidad. No suma KG con cajas o unidades.
export function summarizeMonitorSupplies(documents=[],{
  from=null,to=null,areaId=null
}={}) {
  const start=from==null?null:dateOnly(from);
  const end=to==null?null:dateOnly(to);
  const report=[];
  const totals=new Map();
  for(const doc of documents){
    if(!doc||doc.status!==MONITOR_SUPPLY_STATUS.RECORDED)continue;
    if(start&&doc.operationalDate<start)continue;
    if(end&&doc.operationalDate>end)continue;
    if(areaId&&doc.destinationAreaId!==areaId)continue;
    report.push(doc);
    for(const line of Array.isArray(doc.lines)?doc.lines:[]){
      const key=JSON.stringify([doc.destinationAreaId,line.productId,line.unit]);
      const current=totals.get(key)||{
        areaId:doc.destinationAreaId,productId:line.productId,
        productName:line.productName,unit:line.unit,
        quantity:0,deliveries:0
      };
      current.quantity=roundPrecision(current.quantity+line.quantity);
      current.deliveries+=1;
      totals.set(key,current);
    }
  }
  return {
    documents:report.length,
    lines:[...totals.values()].sort((a,b)=>a.areaId.localeCompare(b.areaId,'es')||
      a.productName.localeCompare(b.productName,'es')||a.unit.localeCompare(b.unit,'es'))
  };
}

function assertDraft(draft){
  if(!draft || draft.schemaVersion!==1 ||
    draft.status!==MONITOR_SUPPLY_STATUS.DRAFT ||
    !draft.lines || Array.isArray(draft.lines)) {
    throw new Error('Surtido no editable: solo se modifica un borrador');
  }
}
function positive(value){
  const amount=Number(value);
  if(value==null||value===''||!Number.isFinite(amount)||amount<=0||amount>1e9){
    throw new Error('La cantidad entregada debe ser positiva');
  }
  return roundPrecision(amount);
}
function roundPrecision(value){return Math.round((value+Number.EPSILON)*1e6)/1e6;}
function required(value,label){
  const v=String(value??'').trim();
  if(!v)throw new Error(label+' obligatorio');
  if(v.length>220)throw new Error(label+' demasiado largo');
  return v;
}
function short(value,length,label) {
  const v=String(value??'').trim();
  if(v.length>length)throw new Error(label+' demasiado largo');
  return v;
}
function dateOnly(value){
  const text=String(value||'');
  const date=new Date(text+'T00:00:00Z');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(text)||!Number.isFinite(date.getTime())||
    date.toISOString().slice(0,10)!==text){
    throw new Error('Fecha operativa inválida');
  }
  return text;
}
