import { buildThermalPrintPayload } from './thermalPrinterClient.js';

const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,char=>({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
})[char]);
const scriptLiteral=value=>JSON.stringify(value).replace(/</g,'\\u003c');

export function reserveLetterOrderWindow(){
  const tab=window.open('','_blank');
  if(!tab)throw new Error('El navegador bloqueó la ventana de impresión. Permite ventanas emergentes para VIGÍA.');
  tab.document.write('<!doctype html><html lang="es"><meta charset="utf-8"><title>VIGÍA · Preparando pedidos</title><body><p>Preparando lista de pedidos sincronizada…</p></body></html>');
  tab.document.close();
  return tab;
}

export function showLetterOrderPrint(tab,list,businessName){
  if(list?.kind!=='ORDER')throw new Error('La impresión en carta corresponde solo a pedidos');
  if(!tab||tab.closed)throw new Error('Se cerró la ventana de impresión');
  tab.document.open();
  tab.document.write(renderLetterOrderPrintHtml(list,businessName));
  tab.document.close();
}

export function renderLetterOrderPrintHtml(list,businessName){
  if(list?.kind!=='ORDER')throw new Error('La impresión en carta corresponde solo a pedidos');
  const payload=buildThermalPrintPayload(list);
  const grouped=new Map();
  for(const item of payload.items){
    const supplier=String(item.category||'SIN PROVEEDOR ASIGNADO').trim()||'SIN PROVEEDOR ASIGNADO';
    if(!grouped.has(supplier))grouped.set(supplier,[]);
    grouped.get(supplier).push(item);
  }
  const groups=[...grouped.entries()].sort(([a],[b])=>{
    if(a==='SIN PROVEEDOR ASIGNADO')return 1;
    if(b==='SIN PROVEEDOR ASIGNADO')return -1;
    return a.localeCompare(b,'es');
  });
  const source=groups.map(([supplier,items])=>`<section class="source-group" data-supplier="${escapeHtml(supplier)}">
    <h2>${escapeHtml(supplier)}</h2>
    ${items.map(item=>`<div class="order-row">
      <div><strong>${escapeHtml(item.name)}</strong>${item.note?`<small>${escapeHtml(item.note)}</small>`:''}${item.extra?'<small>EXTRA</small>':''}</div>
      <b>${escapeHtml(item.quantityText)}</b><i aria-label="Pendiente"></i>
    </div>`).join('')}
  </section>`).join('');
  const heading=escapeHtml(businessName||'NOMBRE DEL NEGOCIO');
  const code=escapeHtml(payload.code);
  const date=escapeHtml(payload.dateLabel);
  const owner=escapeHtml(payload.ownerLabel);
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>VIGÍA · Pedidos · ${code}</title>
<style>
  @page{size:letter;margin:0}
  *{box-sizing:border-box}
  html,body{margin:0;background:#e9edf0;color:#1b2735;font-family:Arial,Helvetica,sans-serif}
  .toolbar{position:sticky;top:0;z-index:3;padding:12px 18px;background:#1b2735;color:white;font:14px Arial}
  .toolbar button{padding:9px 15px;margin-right:12px;cursor:pointer}
  .toolbar span{display:inline-block;max-width:800px;vertical-align:middle}
  #pages{padding:12px}
  .sheet{width:8.5in;height:11in;padding:9mm;margin:0 auto 16px;background:white;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 2px 12px #0002;break-after:page;page-break-after:always}
  .sheet:last-child{break-after:auto;page-break-after:auto}
  .sheet-header{height:29mm;flex:none}
  .brand{font-size:9pt;font-weight:700;letter-spacing:.2px}
  .title-line{display:flex;align-items:baseline;justify-content:space-between;border-bottom:1px solid #aab4bd;padding:5px 0 4px}
  .title-line strong{font-size:15pt}.copy-label{font-size:8pt;font-weight:bold}
  .meta{display:flex;justify-content:space-between;gap:12px;color:#536170;font-size:8pt;line-height:1.6}
  .columns{display:flex;gap:5mm;flex:1;min-height:0}
  .column{width:calc((100% - 5mm)/2);height:100%;overflow:hidden}
  .legend{height:6mm;display:grid;grid-template-columns:minmax(0,1fr) 26mm 5mm;gap:2mm;border-bottom:1px solid #aab4bd;font-size:7pt;font-weight:bold;align-items:center}
  .legend span:nth-child(2),.legend span:nth-child(3){text-align:right}
  .column-body{height:calc(100% - 6mm);overflow:hidden}
  .supplier{background:#e9edf0;font-size:8pt;font-weight:700;padding:3px 5px;margin:5px 0 2px;line-height:1.3}
  .order-row{display:grid;grid-template-columns:minmax(0,1fr) 26mm 5mm;gap:2mm;align-items:start;border-bottom:1px solid #b7bec6;padding:4px 1px;font-size:8pt;line-height:1.25;break-inside:avoid}
  .order-row strong{display:block;overflow-wrap:anywhere}.order-row small{display:block;color:#536170;font-size:7pt;overflow-wrap:anywhere}
  .order-row b{text-align:right;overflow-wrap:anywhere}.order-row i{width:3.6mm;height:3.6mm;border:1px solid #1b2735;margin-left:auto}
  .sheet-footer{height:15mm;flex:none;border-top:1px solid #aab4bd;margin-top:2mm;padding-top:3px;font-size:7.4pt;color:#536170}
  .footer-line,.footer-bottom{display:flex;justify-content:space-between;gap:10px}.footer-bottom{margin-top:6px}
  @media print{html,body{background:white}#pages{padding:0}.toolbar{display:none}.sheet{margin:0;box-shadow:none}}
</style></head><body>
<div class="toolbar"><button type="button" onclick="window.print()">Imprimir pedidos</button><span>Selecciona \\\\BANCOS\\EPSON L3250 Series · Papel Carta · Escala 100 % · Sin encabezados ni pies del navegador. Comprueba la vista previa antes de confirmar.</span></div>
<main id="pages"></main><template id="order-source">${source}</template>
<script>
  const heading=${scriptLiteral(heading)},code=${scriptLiteral(code)},date=${scriptLiteral(date)},owner=${scriptLiteral(owner)};
  const copies=['COPIA PEDIDO / PROVEEDOR','COPIA DEPÓSITO'];
  const source=[...document.querySelector('#order-source').content.querySelectorAll('.source-group')];
  const pages=document.querySelector('#pages');
  function newPage(copy){
    const sheet=document.createElement('section');sheet.className='sheet';
    sheet.innerHTML='<header class="sheet-header"><div class="brand">'+heading+'</div><div class="title-line"><strong>LISTA DE PEDIDOS</strong><span class="copy-label">'+copy+'</span></div><div class="meta"><span>Lista: '+code+' · Fecha: '+date+'<br>Almacenista: '+owner+'</span><span class="page-number"></span></div></header><div class="columns"></div><footer class="sheet-footer"><div class="footer-line"><span class="observations"></span><span class="signature"></span></div><div class="footer-bottom"><span>LISTA DE PEDIDOS · '+copy+'</span><span class="page-number"></span></div></footer>';
    for(let i=0;i<2;i++){
      const col=document.createElement('div');col.className='column';
      col.innerHTML='<div class="legend"><span>PRODUCTO / DETALLE</span><span>CANT.</span><span>OK</span></div><div class="column-body"></div>';
      sheet.querySelector('.columns').append(col);
    }
    pages.append(sheet);return sheet;
  }
  function paginate(copy){
    const made=[];let sheet=newPage(copy);made.push(sheet);let col=0;
    const body=()=>sheet.querySelectorAll('.column-body')[col];
    const over=()=>body().scrollHeight>body().clientHeight+1;
    function next(){
      if(col===0){col=1;return}
      sheet=newPage(copy);made.push(sheet);col=0;
    }
    for(const group of source){
      const items=[...group.querySelectorAll('.order-row')];
      let heading=null;let count=0;
      for(let index=0;index<items.length;index++){
        if(!heading){
          heading=document.createElement('div');heading.className='supplier';
          heading.textContent=group.dataset.supplier+(index?' (CONT.)':'');body().append(heading);count=0;
        }
        const row=items[index].cloneNode(true);body().append(row);
        if(over()){
          row.remove();
          if(!count)heading.remove();
          next();heading=null;
          index--;
          continue;
        }
        count++;
      }
    }
    made.forEach((page,i)=>{
      page.querySelectorAll('.page-number').forEach(node=>node.textContent='Hoja '+(i+1)+' de '+made.length);
      if(i===made.length-1){
        page.querySelector('.observations').textContent='Observaciones: _________________________________________';
        page.querySelector('.signature').textContent='Firma: ____________________';
      }else page.querySelector('.observations').textContent='Continúa en la siguiente hoja · mantener juntas las páginas de esta copia';
    });
  }
  paginate(copies[0]);paginate(copies[1]);
  window.addEventListener('load',()=>setTimeout(()=>window.print(),250));
</script></body></html>`;
}
