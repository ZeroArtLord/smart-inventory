// Proyección inmutable de una semana Monitor al CONTRATO VISUAL de Comprar/Pedir V6.
// Estos objetos NO son compras confirmadas ni se guardan en IndexedDB/servidor.
export function buildMonitorNativeLists(snapshot, { ownerLabel = 'Usuario VIGÍA' } = {}) {
  if (!snapshot || snapshot.source !== 'monitor-weekly-review') {
    throw new Error('Revisión Monitor no disponible');
  }
  const week = String(snapshot.weekStart || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(week)) throw new Error('Semana Monitor inválida');
  const definitions=[['PURCHASE','COM'],['ORDER','PED']];
  if((snapshot.lists?.INQUIRY||[]).length)definitions.push(['INQUIRY','PRE']);
  return definitions.map(([kind,prefix])=>{
    const rows = (snapshot.lists?.[kind] || []).map(item=>({
      id:item.itemKey,
      productId:item.productId || item.itemKey,
      productName:item.description,
      status:'DRAFT',
      notes:item.notes || '',
      printQuantity:item.quantity,
      printUnit:item.unit || '',
      printCategory:item.category || 'SIN CATEGORÍA',
      printExtra:item.kind === 'EXTRA',
      sourceSuggestion:{
        kind:item.kind === 'EXTRA' ? 'EXTRA' : 'PRODUCT',
        categoryNameAtDecision:item.category || 'SIN CATEGORÍA',
        displayQuantity:item.quantity,
        displayUnit:item.unit || ''
      }
    }));
    return {
      id:'monitor-'+week+'-r'+String(snapshot.round||1)+'-'+kind.toLowerCase(),
      code:prefix+'-MON-'+week.replaceAll('-','').slice(2)+'-R'+String(snapshot.round||1),
      kind,
      dateLabel:'Semana '+week,
      ownerLabel:String(ownerLabel || 'Usuario VIGÍA'),
      status:'DRAFT',
      statusLabel:snapshot.closed?'MONITOR · CERRADA':'MONITOR · CICLO ACTIVO',
      activeItems:rows,
      items:rows,
      source:'monitor-weekly-review',
      readOnly:true
    };
  });
}
