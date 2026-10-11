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
const url='http://127.0.0.1:'+port+'/test/browser/monitorPilot.html';
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
const context=await browser.newContext({viewport:{width:1280,height:850}});
const page=await context.newPage();
page.on('pageerror',error=>errors.push(error.message));
page.on('console',message=>{
  if(message.type()==='error'&&!message.text().includes('net::ERR_FAILED'))errors.push(message.text());
});

await page.route('**/api/v1/session',route=>route.fulfill({
  status:200,contentType:'application/json',
  body:JSON.stringify({ok:true,session:{
    workspaceId:'workspace-browser-lab',userId:'worker-browser-lab',
    permissions:['catalog.view','purchases.write','supply.write','reports.view']
  }})
}));
await page.route('**/api/v1/monitor/supplies*',async route=>{
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
  await page.locator('#vigiaMonitorSupplyPilot [data-vs-action="close"]').click();
  await page.locator('#vsSupplyLauncher').click();
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
  await page.locator('#vigiaMonitorSupplyPilot [data-vs-action="close"]').click();
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
  assert.equal(stored.size,1,'one remote delivery, no duplicate');
  assert.ok(stored.has(immutableId),'retry preserves original document ID');
  const legacyQueue=await page.evaluate(async()=>{
    const db=await import('/src/storage/database.js');
    return db.get(db.STORES.SYNC_QUEUE,'legacy-pending-test');
  });
  assert.equal(legacyQueue.status,'PENDING','existing V2 queue item untouched');

  // Reports: new confirmed deliveries separate from legacy local history.
  await page.locator('#vigiaMonitorSupplyPilot [data-vs-action="close"]').click();
  await page.locator('#app h2').evaluate(el=>{el.textContent='Reportes';});
  await page.locator('#vsReportLauncher').click();
  await page.getByText('Surtidos Monitor registrados').waitFor();
  await page.getByText('Agua mineral',{exact:true}).waitFor();
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
  await page.locator('#vigiaMonitorSupplyPilot [data-vs-action="close"]').click();
  await page.locator('#app h2').evaluate(el=>{el.textContent='Surtido';});
  await page.locator('#vsSupplyLauncher').click();
  await page.screenshot({path:path.join(screenshots,'surtidos-mobile.png')});
  const supplyLayout=await page.evaluate(()=>({
    viewport:innerWidth,width:document.documentElement.scrollWidth
  }));
  assert.ok(supplyLayout.width<=supplyLayout.viewport+2,
    'supply page horizontal overflow: '+JSON.stringify(supplyLayout));
  await page.locator('#vigiaMonitorSupplyPilot [data-vs-action="close"]').click();

  // Weekly catalog review, extra free-form item, and print preview.
  await page.locator('#app h2').evaluate(el=>{el.textContent='Comprar / Pedir';});
  await page.locator('#vigiaMonitorPilotLauncher').click();
  await page.locator('#vigiaMonitorPilot .mp-tile').first().click();
  await page.locator('#vigiaMonitorPilot #mpQuantity').fill('');
  await page.locator('#vigiaMonitorPilot [data-mp-choice="BUY"]').click();
  await page.locator('#vigiaMonitorPilot [data-mp-page="extras"]').click();
  await page.locator('#vigiaMonitorPilot #mpExtraForm [name="description"]').fill('Cinta métrica');
  await page.locator('#vigiaMonitorPilot #mpExtraForm button[type="submit"]').click();
  await page.locator('#vigiaMonitorPilot [data-mp-page="lists"]').click();
  await page.getByText('COPIA CHÓFER',{exact:true}).waitFor();
  await page.getByText('Cinta métrica',{exact:true}).first().waitFor();
  await page.screenshot({path:path.join(screenshots,'comprar-pedir-mobile.png')});
  const weeklyLayout=await page.evaluate(()=>({
    viewport:innerWidth,width:document.documentElement.scrollWidth
  }));
  assert.ok(weeklyLayout.width<=weeklyLayout.viewport+2,
    'weekly review overflow on mobile: '+JSON.stringify(weeklyLayout));
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
