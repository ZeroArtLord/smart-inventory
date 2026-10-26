// Búsqueda local del catálogo Monitor. No depende de servidor ni VPN.
export function searchMonitorProducts(products=[],query='',limit=25){
  const normalized=normalizeSearch(query);
  if(!normalized)return [];
  const words=normalized.split(/\s+/).filter(Boolean);
  return (Array.isArray(products)?products:[])
    .filter(p=>{
      const text=normalizeSearch([p.name,p.sku,p.saintCode,p.barcode,p.id,
        ...(Array.isArray(p.aliases)?p.aliases:[])].join(' '));
      return words.every(word=>text.includes(word));
    })
    .slice(0,limit);
}
export function normalizeSearch(value){
  return String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .toLocaleLowerCase('es').trim();
}
