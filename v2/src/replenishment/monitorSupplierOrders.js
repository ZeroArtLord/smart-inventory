// Contrato compartido cliente/servidor: cantidades de empaque, sin conversiones.
export function normalizeSupplier(input={}){
  const name=String(input.name||'').trim();
  if(!name||name.length>160)throw Error('Indica un nombre de proveedor (máximo 160 caracteres)');
  const raw=String(input.phone||'').trim();
  if(!/^[+\d\s().-]+$/.test(raw))throw Error('Indica un teléfono internacional válido');
  let phone=raw.replace(/[^\d]/g,'');
  if(phone.startsWith('00'))phone=phone.slice(2);
  if(/^04\d{9}$/.test(phone))phone='58'+phone.slice(1);
  if(!/^[1-9]\d{7,14}$/.test(phone))throw Error('Indica un teléfono internacional válido');
  return {name,phone,active:input.active!==false};
}
export function buildSupplierOrderGroups({items=[],suppliers=[],selections={}}={}){
  if(!items.length)throw Error('No hay productos marcados como Pedir');
  const catalog=new Map(suppliers.map(s=>[s.id,s]));
  const groups=new Map();
  for(const item of [...items].sort((a,b)=>a.itemKey.localeCompare(b.itemKey))){
    const name=String(item.name||item.description||'Producto').trim();
    if(item.unavailable)throw Error(name+': el producto ya no está activo en el catálogo');
    const quantity=Number(item.quantity);
    if(item.quantity==null||!Number.isFinite(quantity)||quantity<=0||quantity>1e9)
      throw Error(name+': falta una cantidad positiva');
    const unit=String(item.unit||'').trim();
    if(!unit||unit.length>40)throw Error(name+': falta la medida de empaque');
    const supplierId=selections[item.itemKey];
    const supplier=catalog.get(supplierId);
    if(!supplier||supplier.active===false)throw Error(name+': selecciona un proveedor activo');
    const normalized=normalizeSupplier(supplier);
    if(!groups.has(supplierId))groups.set(supplierId,{supplierId,
      supplier:{id:supplierId,name:normalized.name,phone:normalized.phone},items:[]});
    groups.get(supplierId).items.push({itemKey:item.itemKey,productId:item.productId||null,
      name,quantity,unit,notes:String(item.notes||'').trim(),version:Number(item.version||0)});
  }
  return [...groups.values()].sort((a,b)=>a.supplierId.localeCompare(b.supplierId));
}
export function supplierOrderFingerprint(groups){
  return JSON.stringify([...groups].sort((a,b)=>a.supplierId.localeCompare(b.supplierId)).map(g=>({
    supplierId:g.supplierId,supplier:{id:g.supplier.id,name:g.supplier.name,phone:g.supplier.phone},
    items:[...g.items].sort((a,b)=>a.itemKey.localeCompare(b.itemKey)).map(i=>({
      itemKey:i.itemKey,productId:i.productId||null,name:i.name,quantity:i.quantity,unit:i.unit,
      notes:i.notes||'',version:i.version
    }))
  })));
}
export function buildSupplierMessage(order,{now=new Date()}={}){
  const hour=Number(new Intl.DateTimeFormat('en-GB',{timeZone:'America/Caracas',hour:'2-digit',hourCycle:'h23'}).format(now));
  const greeting=hour<12?'buenos días':hour<19?'buenas tardes':'buenas noches';
  const lines=order.items.map(i=>'- '+new Intl.NumberFormat('es-VE',{maximumFractionDigits:6}).format(i.quantity)+
    ' '+i.unit+' — '+i.name+(i.notes?' ('+i.notes+')':''));
  return 'Hola, '+greeting+'. Le escribo de parte del Club social deportivo y campestre el establo, c.a para hacerle el siguiente pedido:\n\n'+
    (order.replacesOrderId?'Actualización del pedido anterior:\n':'')+lines.join('\n')+
    '\n\nPor favor, me confirma despacho y facturación de este pedido. Tenga un buen día.';
}
export function supplierWhatsAppUrl(order,options){
  const supplier=normalizeSupplier(order.supplier);
  return 'https://wa.me/'+supplier.phone+'?text='+encodeURIComponent(buildSupplierMessage(order,options));
}
