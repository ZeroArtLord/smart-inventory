// Chromium E2E in GitHub CI against actual pilot modules + IndexedDB.
// All API responses are simulated; NO production credentials or server touched.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const root=process.cwd();
const screenshots=path.join(root,'test-results','monitor-pilot');
const errors=[];
const stored=new Map();
let postAttempts=0,networkDown=false;
const server=createServer(async(req,res)=>{
  try {
    const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    const target=path.resolve(root,'.'+pathname);
    if(!target.startsWith(root+path.sep)) {res.writeHead(403).end();return;}
    const body=await readFile(target);
    const mime=target.endsWith('.js')||target.endsWith('.mjs')?'text/javascript':
      target.endsWith('.css')?'text/css':target.endsWith('.html')?'text/html':'application/octet-stream';
    res.writeHead(200,{'content-type':mime,'cache-control':'no-store'});
    res.end(body);
  }catch(error){res.writeHead(404).end('Not found');}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const port=server.address().port;
const url='http://127.0.0.1:'+port+'/test/browser/monitorPilot.html?vigiaMonitorPilot=1';
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
const context=await browser.newContext({viewport:{width:1280,height:850}});
const page=await context.newPage();
// Recalcular en cada carga, también al hacer reload() durante el smoke.
await page.addInitScript(()=>{
  const d=new Date();
  d.setDate(d.getDate()-((d.getDay()+6)%7));
  window.__vigiaTestWeekStart=[
    d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),
    String(d.getDate()).padStart(2,'0')
  ].join('-');
});
page.on('pageerror',error=>errors.push(error.message));
page.on('console',message=>{
  if(message.type()==='error'&&!message.text().includes('net::ERR_FAILED'))errors.push(message.text());
});

await page.route('**/api/v1/public/config',route=>route.fulfill({
  status:200,contentType:'application/json',
  body:JSON.stringify({ok:true,authMode:'dev',monitorPilotEnabled:true})
}));
await page.route('**/api/v1/session',route=>route.fulfill({
  status:200,contentType:'application/json',
  body:JSON.stringify({ok:true,session:{
    workspaceId:'workspace-browser-lab',userId:'worker-browser-lab',
    permissions:['catalog.view','purchases.write','supply.write','reports.view']
  }})
}));
// Playwright '*' no cruza '/': usar '**' para incluir /consumption.
await page.route('**/api/v1/monitor/supplies**',async route=>{
  const req=route.request();
  const u=new URL(req.url());
  const method=req.method();
  if(method==='POST'){
    postAttempts++;
    if(networkDown)return route.abort('failed');
    const body=req.postDataJSON();
    const old=stored.get(body.id);
    if(old&&JSON.stringify(old.source)!==JSON.stringify(body)){
      return route.fulfill({status:409,contentType:'application/json',
        body:JSON.stringify({code:'MONITOR_SUPPLY_ID_CONFLICT',message:'Documento duplicado con distinto contenido'})});
    }
    const doc=old?.doc||{
      ...body,destinationAreaName:'Cocina',recordedAt:new Date().toISOString(),
      recordedBy:'worker-browser-lab',status:'RECORDED'
    };
    stored.set(body.id,{source:body,doc});
    return route.fulfill({status:old?200:201,contentType:'application/json',
      body:JSON.stringify({ok:true,delivery:doc,replayed:Boolean(old)})});
  }
  if(u.pathname.endsWith('/consumption')){
    const lines=[...stored.values()].flatMap(x=>x.doc.lines.map(line=>({
      areaName:'Cocina',areaId:'area-cocina',productName:'Agua mineral',
      productId:line.productId,unit:line.unit,quantity:line.quantity,deliveries:1
    })));
    return route.fulfill({status:200,contentType:'application/json',
      body:JSON.stringify({ok:true,basis:'RECORDED_MONITOR_SUPPLIES_ONLY',lines})});
  }
  if(method==='GET'){
    return route.fulfill({status:200,contentType:'application/json',
      body:JSON.stringify({ok:true,deliveries:[...stored.values()].map(x=>x.doc),nextOffset:null})});
  }
  return route.abort('failed');
});

const reviewItems=new Map();
await page.route('**/api/v1/monitor/reviews/**',async route=>{
  const req=route.request();
  if(req.method()==='GET'){
    return route.fulfill({status:200,contentType:'application/json',
      body:JSON.stringify({ok:true,items:[...reviewItems.values()]})});
  }
  const b=req.postDataJSON();
  const itemKey=(b.kind==='PRODUCT'?'product:':'extra:')+b.itemId;
  const previous=reviewItems.get(itemKey);
  const row={
    itemKey,kind:b.kind,productId:b.kind==='PRODUCT'?b.itemId:null,
    description:b.description||null,decision:b.decision,quantity:b.quantity??null,
    unit:b.unit||'',notes:b.notes||'',deleted:b.deleted===true,
    version:(previous?.version||0)+1,updatedBy:'worker-browser-lab',
    updatedAt:new Date().toISOString()
  };
  reviewItems.set(itemKey,row);
  return route.fulfill({status:200,contentType:'application/json',
    body:JSON.stringify({ok:true,item:row,appliedVersion:row.version,replayed:false})});
});
try{
  await mkdir(screenshots,{recursive:true});
  await page.goto(url,{waitUntil:'networkidle'});

  await page.evaluate(async()=>{
    const storage=await import('/src/storage/database.js');
    const settings=await import('/src/sync/syncSettings.js');
    await settings.saveSyncConfig({
      workspaceId:'workspace-browser-lab',
      serverUserId:'worker-browser-lab',authMode:'dev'
    });
    await storage.put(storage.STORES.PRODUCTS,{
      id:'prod-agua',name:'Agua mineral',categoryId:'bebidas',sku:'AGUA',
      unitCode:'UND',active:true
    });
    await storage.put(storage.STORES.CATEGORIES,{
      id:'bebidas',name:'Bebidas',active:true
    });
    await storage.put(storage.STORES.PRODUCTS,{
      id:'prod-cafe',name:'Café de prueba',categoryId:'viveres',sku:'CAFE',
      unitCode:'UND',active:true
    });
    await storage.put(storage.STORES.PRODUCTS,{
      id:'prod-yuca',name:'Yuca de prueba',categoryId:'hortalizas',sku:'YUCA',
      unitCode:'KG',active:true
    });
    await storage.put(storage.STORES.PRODUCTS,{
      id:'prod-pan',name:'Pan de prueba',categoryId:'viveres',sku:'PAN',
      unitCode:'UND',active:true
    });
    await storage.put(storage.STORES.CATEGORIES,{
      id:'viveres',name:'Viveres',active:true
    });
    await storage.put(storage.STORES.CATEGORIES,{
      id:'hortalizas',name:'Hortalizas',active:true
    });
    await storage.put(storage.STORES.AREAS,{
      id:'area-cocina',name:'Cocina',active:true,sortOrder:1
    });
    await storage.put(storage.STORES.SYNC_QUEUE,{
      id:'legacy-pending-test',entityId:'old',status:'PENDING'
    });
  });

  // Desktop: actual UI, IDB autosave + closure/reopen.
  await page.locator('#vsSupplyLauncher').click();
  await page.locator('#vsArea').selectOption('area-cocina');
  await page.locator('#vsAddForm [name="quantity"]').fill('4');
  await page.locator('#vsAddForm button[type="submit"]').click();
  await page.locator('#vigiaMonitorSupplyPilot .vs-line').filter({hasText:'Agua mineral'}).waitFor();
  await page.screenshot({path:path.join(screenshots,'surtidos-desktop.png')});
  await page.locator('#vigiaMonitorSupplyPilot .vs-header [data-vs-action="close"]').click();
  await page.locator('#vsSupplyLauncher').click();
  // open() lee IndexedDB asíncronamente; esperar al carrito restaurado.
  await page.locator('#vigiaMonitorSupplyPilot .vs-line').filter({hasText:'Agua mineral'}).waitFor();
  assert.equal(await page.locator('#vigiaMonitorSupplyPilot .vs-line').filter({hasText:'Agua mineral'}).count(),1,
    'cart is autosaved across dialog reopen');

  // Simulate unavailable API (static assets still online) and verify durable outbox.
  networkDown=true;
  await page.locator('#vigiaMonitorSupplyPilot [data-vs-action="confirm"]').click();
  await page.waitForFunction(async()=>{
    const mod=await import('/src/documents/monitorSupplyOutbox.js');
    const data=await mod.listMonitorSupplyOutbox({
      workspaceId:'workspace-browser-lab',userId:'worker-browser-lab'
    });
    return data.length===1&&data[0].status==='PENDING';
  });
  assert.equal(stored.size,0,'failed POST did not create a remote delivery');
  await page.locator('#vigiaMonitorSupplyPilot .vs-header [data-vs-action="close"]').click();
  await page.reload({waitUntil:'networkidle'});
  await page.locator('#vsSupplyLauncher').click();
  await page.locator('#vigiaMonitorSupplyPilot').getByText('Entregas pendientes de enviar').waitFor();
  const localAfterReload=await page.evaluate(async()=>{
    const mod=await import('/src/documents/monitorSupplyOutbox.js');
    return mod.listMonitorSupplyOutbox({
      workspaceId:'workspace-browser-lab',userId:'worker-browser-lab'
    });
  });
  assert.equal(localAfterReload.length,1,'record remains in indexedDB after reload');
  assert.equal(localAfterReload[0].status,'PENDING');
  const immutableId=localAfterReload[0].delivery.id;

  networkDown=false;
  await page.locator('#vigiaMonitorSupplyPilot [data-vs-action="retry"]').click();
  await page.waitForFunction(async()=>{
    const mod=await import('/src/documents/monitorSupplyOutbox.js');
    return (await mod.listMonitorSupplyOutbox({
      workspaceId:'workspace-browser-lab',userId:'worker-browser-lab'
    })).length===0;
  });
  // Verificar confirmación externa además del cambio de estado local.
  for(let attempt=0;attempt<80&&stored.size===0;attempt++){
    await new Promise(resolve=>setTimeout(resolve,75));
  }
  const localStatuses=await page.evaluate(async()=>{
    const mod=await import('/src/documents/monitorSupplyOutbox.js');
    return (await mod.listMonitorSupplyOutbox({
      workspaceId:'workspace-browser-lab',userId:'worker-browser-lab'
    },{includeSynced:true})).map(x=>({id:x.delivery.id,status:x.status}));
  });
  console.log('BROWSER_DELIVERY_CONFIRMATION',JSON.stringify({
    postAttempts,remoteCount:stored.size,localStatuses,immutableId
  }));
  assert.equal(stored.size,1,'one remote delivery, no duplicate');
  assert.ok(stored.has(immutableId),'retry preserves original document ID');
  const legacyQueue=await page.evaluate(async()=>{
    const db=await import('/src/storage/database.js');
    return db.get(db.STORES.SYNC_QUEUE,'legacy-pending-test');
  });
  assert.equal(legacyQueue.status,'PENDING','existing V2 queue item untouched');

  // Reports: new confirmed deliveries separate from legacy local history.
  await page.locator('#vigiaMonitorSupplyPilot .vs-header [data-vs-action="close"]').click();
  await page.locator('#app h2').evaluate(el=>{el.textContent='Reportes';});
  await page.locator('#vsReportLauncher').click();
  await page.getByText('Surtidos Monitor registrados').waitFor();
  console.log('BROWSER_REPORT_VISIBLE',JSON.stringify({
    text:(await page.locator('#vigiaMonitorSupplyPilot').innerText()).slice(0,1400),
    deliveries:stored.size,postAttempts
  }));
  await page.getByText('Agua mineral',{exact:true}).waitFor({timeout:5000});
  await page.getByText('Historial anterior de VIGÍA V2 (separado)').waitFor();
  await page.screenshot({path:path.join(screenshots,'reportes-desktop.png')});

  // Mobile: CSS really fits 390px, controls are clickable and usable.
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:path.join(screenshots,'reportes-mobile.png')});
  const reportLayout=await page.evaluate(()=>({
    viewport:innerWidth,width:document.documentElement.scrollWidth
  }));
  assert.ok(reportLayout.width<=reportLayout.viewport+2,
    'reports cause horizontal document overflow at 390px: '+JSON.stringify(reportLayout));
  await page.locator('#vigiaMonitorSupplyPilot .vs-header [data-vs-action="close"]').click();
  await page.locator('#app h2').evaluate(el=>{el.textContent='Surtido';});
  await page.locator('#vsSupplyLauncher').click();
  await page.screenshot({path:path.join(screenshots,'surtidos-mobile.png')});
  const supplyLayout=await page.evaluate(()=>({
    viewport:innerWidth,width:document.documentElement.scrollWidth
  }));
  assert.ok(supplyLayout.width<=supplyLayout.viewport+2,
    'supply page horizontal overflow: '+JSON.stringify(supplyLayout));
  await page.locator('#vigiaMonitorSupplyPilot .vs-header [data-vs-action="close"]').click();

  // Weekly catalog review, extra free-form item, and print preview.
  await page.locator('#app h2').evaluate(el=>{el.textContent='Comprar / Pedir';});
  await page.locator('#vigiaMonitorPilotLauncher').click();
  await page.locator('#vigiaMonitorPilot .mp-tile').first().click();
  await page.locator('#vigiaMonitorPilot #mpQuantity').fill('');
  await page.locator('#vigiaMonitorPilot [data-mp-choice="BUY"]').click();

  // Seleccionados: cantidad + unidad del catálogo, manual, Enter y persistencia.
  await page.locator('#vigiaMonitorPilot [data-mp-page="selected"]').click();
  const editRow=page.locator('#vigiaMonitorPilot .mp-selected-row').first();
  await editRow.locator('.mp-edit-unit-select').waitFor();
  for(const unit of ['CAJA','BULTO','UND','KG','CJ']){
    assert.ok((await editRow.locator('.mp-edit-unit-select option').allTextContents()).includes(unit),
      'unit unavailable in selected: '+unit);
  }
  assert.equal(await editRow.locator('[data-mp-action="save-selection"]').count(),0,
    'No debe existir Guardar por producto');
  await editRow.locator('.mp-edit-quantity').fill('2');
  await editRow.locator('.mp-edit-unit-select').selectOption('CAJA');
  // No click/Enter: el autosave debe ejecutarse por cambios de campo.
  await page.waitForFunction(async()=>{
    const mod=await import('/src/replenishment/monitorReviewOffline.js');
    const record=await mod.readMonitorReview({workspaceId:'workspace-browser-lab',
      userId:'worker-browser-lab',weekStart:window.__vigiaTestWeekStart});
    return record.items.some(x=>x.kind==='PRODUCT'&&x.unit==='CAJA'&&x.quantity===2);
  },null,{timeout:12000});
  await page.waitForFunction(async()=>{
    const m=await import('/src/replenishment/monitorReviewOffline.js');
    const state=await m.readMonitorReview({workspaceId:'workspace-browser-lab',userId:'worker-browser-lab',weekStart:window.__vigiaTestWeekStart});
    return state.items.some(x=>x.kind==='PRODUCT'&&x.decision==='BUY'&&x.unit==='CAJA'&&x.quantity===2);
  },null,{timeout:12000});

  await editRow.locator('.mp-edit-unit-select').selectOption('__OTHER__');
  await editRow.locator('.mp-edit-unit-other').fill('GAVETA');
  await editRow.locator('.mp-edit-quantity').fill('3');
  await editRow.locator('.mp-edit-unit-other').press('Enter');
  await page.waitForFunction(async()=>{
    const m=await import('/src/replenishment/monitorReviewOffline.js');
    const state=await m.readMonitorReview({workspaceId:'workspace-browser-lab',userId:'worker-browser-lab',weekStart:window.__vigiaTestWeekStart});
    return state.items.some(x=>x.kind==='PRODUCT'&&x.decision==='BUY'&&x.unit==='GAVETA'&&x.quantity===3);
  },null,{timeout:12000});
  await editRow.locator('.mp-edit-unit-select').selectOption('CAJA');
  await editRow.locator('.mp-edit-quantity').fill('2');
  await editRow.locator('.mp-edit-quantity').press('Enter'); // Solo avanza, no hace falta para guardar.
  await page.waitForFunction(async()=>{
    const m=await import('/src/replenishment/monitorReviewOffline.js');
    const state=await m.readMonitorReview({workspaceId:'workspace-browser-lab',userId:'worker-browser-lab',weekStart:window.__vigiaTestWeekStart});
    return state.items.some(x=>x.kind==='PRODUCT'&&x.decision==='BUY'&&x.unit==='CAJA'&&x.quantity===2);
  },null,{timeout:12000});
  // La sincronización de una edición anterior no puede restaurar GAVETA tras
  // confirmar CAJA: se espera el ACK y se comprueba también el DOM, no solo IDB.
  await page.waitForFunction(async()=>{
    const m=await import('/src/replenishment/monitorReviewOffline.js');
    const state=await m.readMonitorReview({workspaceId:'workspace-browser-lab',userId:'worker-browser-lab',weekStart:window.__vigiaTestWeekStart});
    return state.pendingCount===0 && state.items.some(x=>
      x.kind==='PRODUCT' && x.unit==='CAJA' && x.quantity===2);
  },null,{timeout:15000});
  const finalRow=page.locator('#vigiaMonitorPilot .mp-selected-row').first();
  assert.equal(await finalRow.locator('.mp-edit-unit-select').inputValue(),'CAJA',
    'a stale sync response restored an older unit into the DOM');
  assert.equal(await finalRow.locator('.mp-edit-quantity').inputValue(),'2');
  // Cambiar Comprar/Pedir debe guardarse solo, aun mientras editamos otra fila.
  await finalRow.locator('.mp-edit-decision').selectOption('ORDER');
  await page.waitForFunction(async()=>{
    const m=await import('/src/replenishment/monitorReviewOffline.js');
    const record=await m.readMonitorReview({workspaceId:'workspace-browser-lab',
      userId:'worker-browser-lab',weekStart:window.__vigiaTestWeekStart});
    return record.items.some(x=>x.kind==='PRODUCT'&&x.decision==='ORDER'&&x.unit==='CAJA'&&x.quantity===2);
  },null,{timeout:12000});
  await finalRow.locator('.mp-edit-decision').selectOption('BUY');
  await page.waitForFunction(async()=>{
    const m=await import('/src/replenishment/monitorReviewOffline.js');
    const record=await m.readMonitorReview({workspaceId:'workspace-browser-lab',
      userId:'worker-browser-lab',weekStart:window.__vigiaTestWeekStart});
    return record.items.some(x=>x.kind==='PRODUCT'&&x.decision==='BUY'&&x.unit==='CAJA'&&x.quantity===2);
  },null,{timeout:12000});
  // Edición rápida y navegación: al pulsar Extras, el último número aún en
  // debounce debe persistir en IndexedDB antes de cambiar de pantalla.
  await finalRow.locator('.mp-edit-quantity').fill('4');
  await page.locator('#vigiaMonitorPilot .mp-nav [data-mp-page="extras"]').click();
  await page.waitForFunction(async()=>{
    const m=await import('/src/replenishment/monitorReviewOffline.js');
    const record=await m.readMonitorReview({workspaceId:'workspace-browser-lab',
      userId:'worker-browser-lab',weekStart:window.__vigiaTestWeekStart});
    return record.pendingCount===0 && record.items.some(x=>x.kind==='PRODUCT'&&x.decision==='BUY'&&x.quantity===4);
  },null,{timeout:15000});
  const beforeNavSaved=await page.evaluate(async()=>{
    const m=await import('/src/replenishment/monitorReviewOffline.js');
    const record=await m.readMonitorReview({workspaceId:'workspace-browser-lab',userId:'worker-browser-lab',weekStart:window.__vigiaTestWeekStart});
    return record.items.find(x=>x.kind==='PRODUCT'&&x.decision==='BUY');
  });
  assert.equal(beforeNavSaved?.quantity,4,'Autosave must flush when leaving selected');
  await page.locator('#vigiaMonitorPilot .mp-nav [data-mp-page="selected"]').click();
  const returnRow=page.locator('#vigiaMonitorPilot .mp-selected-row').first();
  await returnRow.locator('.mp-edit-quantity').fill('2');
  // Observación EXACTAMENTE como en VIGÍA: 180 caracteres, autoguardada
  // junto a cantidad, unidad y método. Ejemplo del usuario: REBANADAS.
  const noteField=returnRow.locator('.mp-edit-note');
  assert.equal(await noteField.getAttribute('maxlength'),'180');
  await noteField.fill('rebanadas');
  await page.waitForFunction(async()=>{
    const m=await import('/src/replenishment/monitorReviewOffline.js');
    const state=await m.readMonitorReview({workspaceId:'workspace-browser-lab',
      userId:'worker-browser-lab',weekStart:window.__vigiaTestWeekStart});
    return state.items.some(x=>x.kind==='PRODUCT'&&x.notes==='rebanadas'&&x.quantity===2&&x.unit==='CAJA');
  },null,{timeout:12000});
  await page.waitForFunction(async()=>{
    const m=await import('/src/replenishment/monitorReviewOffline.js');
    const record=await m.readMonitorReview({workspaceId:'workspace-browser-lab',userId:'worker-browser-lab',weekStart:window.__vigiaTestWeekStart});
    return record.items.some(x=>x.kind==='PRODUCT'&&x.decision==='BUY'&&x.unit==='CAJA'&&x.quantity===2);
  },null,{timeout:12000});
  await page.screenshot({path:path.join(screenshots,'seleccionados-unidades-mobile.png')});
  console.log('MONITOR_SELECTED_NOTES_PASS: quantity/unit/type/note autosaved; exact V6 ticket observation');

  await page.locator('#vigiaMonitorPilot .mp-nav [data-mp-page="extras"]').click();
  await page.locator('#vigiaMonitorPilot #mpExtraForm [name="description"]').fill('Cinta métrica');
  await page.locator('#vigiaMonitorPilot #mpExtraForm button[type="submit"]').click();
  // Extras también pueden empezar como Preguntar y luego pasar a Pedido.
  await page.locator('#vigiaMonitorPilot [data-mp-page="extras"]').click();
  await page.locator('#vigiaMonitorPilot #mpExtraForm [name="description"]').fill('Etiqueta consulta');
  await page.locator('#vigiaMonitorPilot #mpExtraForm [name="decision"]').selectOption('ASK');
  await page.locator('#vigiaMonitorPilot #mpExtraForm button[type="submit"]').click();
  await page.locator('#vigiaMonitorPilot [data-mp-page="ask"]').click();
  const askedExtra=page.locator('#vigiaMonitorPilot .mp-row').filter({hasText:'Etiqueta consulta'});
  await askedExtra.waitFor();
  await askedExtra.locator('[data-mp-action="resolve-ask-extra"][data-mp-choice="ORDER"]').click();
  await page.waitForFunction(async()=>{
    const mod=await import('/src/replenishment/monitorReviewOffline.js');
    const r=await mod.readMonitorReview({workspaceId:'workspace-browser-lab',
      userId:'worker-browser-lab',weekStart:window.__vigiaTestWeekStart});
    return r.items.some(x=>x.kind==='EXTRA'&&x.description==='Etiqueta consulta'&&x.decision==='ORDER');
  });
  await page.locator('#vigiaMonitorPilot [data-mp-page="lists"]').click();
  await page.locator('#vigiaMonitorPilot .v6p-ticket').filter({hasText:'COPIA CHÓFER'}).first().waitFor();
  const nativeTicketText=await page.locator('#vigiaMonitorPilot .v6p-ticket').filter({hasText:'COPIA CHÓFER'}).first().innerText();
  console.log('MONITOR_SELECTED_NATIVE_PRINT_TEXT',JSON.stringify(nativeTicketText.slice(0,900)));
  assert.match(nativeTicketText,/2\s+CJ/,
    'native ticket must use original CAJA->CJ abbreviation');
  assert.match(nativeTicketText,/\(rebanadas\)/,
    'Original VIGIA ticket must print the per-product observation in parentheses');
  await page.getByText('Cinta métrica',{exact:true}).first().waitFor();
  await page.screenshot({path:path.join(screenshots,'comprar-pedir-mobile.png')});
  const weeklyLayout=await page.evaluate(()=>({
    viewport:innerWidth,width:document.documentElement.scrollWidth
  }));
  assert.ok(weeklyLayout.width<=weeklyLayout.viewport+2,
    'weekly review overflow on mobile: '+JSON.stringify(weeklyLayout));

  // Regresión Pendientes: BUY -> autoavance al siguiente pendiente
  // incluso en una categoría distinta; ORDER/NOT_NEEDED -> final sin Inicio.
  await page.evaluate(async()=>{
    const mod=await import('/src/replenishment/monitorReviewOffline.js');
    const opts={workspaceId:'workspace-browser-lab',userId:'worker-browser-lab',
      weekStart:window.__vigiaTestWeekStart};
    await mod.queueMonitorReviewChange(opts,{
      kind:'PRODUCT',itemId:'prod-cafe',decision:'PENDING',quantity:null
    });
    await mod.queueMonitorReviewChange(opts,{
      kind:'PRODUCT',itemId:'prod-yuca',decision:'PENDING',quantity:null
    });
    await mod.queueMonitorReviewChange(opts,{
      kind:'PRODUCT',itemId:'prod-pan',decision:'PENDING',quantity:null
    });
  });
  await page.locator('#vigiaMonitorPilot [data-mp-action="sync"]').click();
  await page.locator('#vigiaMonitorPilot [data-mp-page="pending"]').click();
  assert.equal(await page.locator('#vigiaMonitorPilot .mp-row').count(),3);
  await page.locator('#vigiaMonitorPilot .mp-row').first().getByRole('button',{name:'Revisar ahora'}).click();
  let active=await page.locator('#vigiaMonitorPilot .mp-card h2[style]').first().innerText();
  assert.match(active,/Café de prueba/);
  await page.locator('#vigiaMonitorPilot #mpQuantity').fill('5');
  await page.locator('#vigiaMonitorPilot [data-mp-choice="BUY"]').click();
  await page.waitForFunction(()=>
    document.querySelector('#vigiaMonitorPilot .mp-card h2[style]')?.textContent.includes('Pan de prueba')
  ,null,{timeout:12000});
  active=await page.locator('#vigiaMonitorPilot .mp-card h2[style]').first().innerText();
  assert.match(active,/Pan de prueba/,
    'BUY should advance to next pending product, not Inicio');
  await page.locator('#vigiaMonitorPilot #mpQuantity').fill('3');
  await page.locator('#vigiaMonitorPilot [data-mp-choice="ORDER"]').click();
  await page.waitForFunction(()=>
    document.querySelector('#vigiaMonitorPilot .mp-card h2[style]')?.textContent.includes('Yuca de prueba')
  ,null,{timeout:12000});
  await page.locator('#vigiaMonitorPilot #mpQuantity').fill('');
  await page.locator('#vigiaMonitorPilot [data-mp-choice="NOT_NEEDED"]').click();
  await page.waitForFunction(()=>
    document.querySelector('#vigiaMonitorPilot .mp-card h2')?.textContent.startsWith('Pendientes')
  ,null,{timeout:12000});
  assert.match(await page.locator('#vigiaMonitorPilot .mp-card h2').first().innerText(),/Pendientes/);
  assert.match(await page.locator('#vigiaMonitorPilot').innerText(),/No tienes productos pendientes/);
  const storedPending=await page.evaluate(async()=>{
    const mod=await import('/src/replenishment/monitorReviewOffline.js');
    const s=await mod.readMonitorReview({workspaceId:'workspace-browser-lab',
      userId:'worker-browser-lab',weekStart:window.__vigiaTestWeekStart});
    return s.items.filter(x=>['product:prod-cafe','product:prod-pan','product:prod-yuca'].includes(x.itemKey))
      .map(x=>({id:x.itemKey,decision:x.decision,qty:x.quantity}));
  });
  assert.ok(storedPending.some(x=>x.id==='product:prod-cafe'&&x.decision==='BUY'&&x.qty===5));
  assert.ok(storedPending.some(x=>x.id==='product:prod-pan'&&x.decision==='ORDER'&&x.qty===3));
  assert.ok(storedPending.some(x=>x.id==='product:prod-yuca'&&x.decision==='NOT_NEEDED'));
  console.log('MONITOR_PENDING_AUTOADVANCE_PASS',JSON.stringify(storedPending));

  // El mismo ticket debe ser imprimible desde la vista VIGÍA NORMAL (sin
  // que el viejo CSS "body * visibility:hidden" genere una página en blanco).
  await page.locator('#vigiaMonitorPilot [data-mp-action="close"]').click();
  await page.evaluate(async()=>{
    const {projectMonitorToNormal}=await import('/src/replenishment/monitorToNormalMirror.js');
    const {printableMonitorMirror}=await import('/src/ui/monitorNormalMirrorUi.js');
    const snapshot=projectMonitorToNormal({
      weekStart:window.__vigiaTestWeekStart,
      products:[{id:'prod-agua',name:'Agua mineral',categoryId:'bebidas',unitCode:'UND'}],
      categories:[{id:'bebidas',name:'BEBIDAS'}],
      serverItems:[{itemKey:'product:prod-agua',kind:'PRODUCT',productId:'prod-agua',
        decision:'BUY',quantity:null,unit:'CJ',notes:'Test impresora'}]
    });
    const host=document.createElement('section');
    host.id='v6MonitorPrintPage';
    host.innerHTML=printableMonitorMirror(snapshot);
    document.body.append(host);
    document.body.classList.add('vigia-monitor-normal-print-active');
  });
  await page.emulateMedia({media:'print'});
  const printView=await page.evaluate(()=>({
    host:getComputedStyle(document.getElementById('v6MonitorPrintPage')).display,
    ticket:getComputedStyle(document.querySelector('#v6MonitorPrintPage .v6p-ticket')).visibility,
    app:getComputedStyle(document.getElementById('app')).display,
    tickets:document.querySelectorAll('#v6MonitorPrintPage .v6p-ticket').length,
    text:document.getElementById('v6MonitorPrintPage').innerText
  }));
  assert.notEqual(printView.host,'none','Normal print host hidden in print media');
  assert.equal(printView.ticket,'visible','Legacy V6 CSS hid the print ticket');
  assert.equal(printView.app,'none','Normal app background leaks into printed ticket');
  assert.equal(printView.tickets,4,'Expected four receipts on 80mm roll');
  assert.match(printView.text,/________ CJ/);
  await page.emulateMedia({media:'screen'});
  await page.evaluate(()=>{
    document.body.classList.remove('vigia-monitor-normal-print-active');
    document.getElementById('v6MonitorPrintPage')?.remove();
  });
  assert.equal(errors.length,0,'browser errors: '+errors.join('\n'));
  console.log('MONITOR_BROWSER_SMOKE_PASS: Chromium desktop/mobile, real pilot screens, IndexedDB autosave/reload, failed API retry, no duplicate, legacy queue untouched, new reports, manual extras');
}catch(error){
  await page.screenshot({path:path.join(screenshots,'failure.png')}).catch(()=>{});
  console.error('MONITOR_BROWSER_SMOKE_FAIL:',error.stack||error);
  process.exitCode=1;
}finally{
  await browser.close();
  await new Promise(r=>server.close(r));
}
