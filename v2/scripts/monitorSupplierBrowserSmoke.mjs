import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright';
import {buildSupplierOrderGroups,supplierOrderFingerprint} from '../src/replenishment/monitorSupplierOrders.js';
const root=process.cwd(),suppliers=[],assignments=new Map(),orders=[],preferences={},errors=[];
let failAssignment=false,finalizeCalls=0;
const items=[{itemKey:'product:p1',kind:'PRODUCT',productId:'p1',name:'Servilletas',decision:'ORDER',quantity:null,unit:'CAJA',notes:'Blancas',version:1},
 {itemKey:'product:p2',kind:'PRODUCT',productId:'p2',name:'Aceite',decision:'ORDER',quantity:2,unit:'BULTO',notes:'',version:1}];
const server=createServer(async(req,res)=>{try{const file=path.resolve(root,'.'+new URL(req.url,'http://x').pathname);if(!file.startsWith(root+path.sep))return res.writeHead(403).end();res.writeHead(200,{'content-type':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html'}).end(await readFile(file));}catch{res.writeHead(404).end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
const context=await browser.newContext({viewport:{width:390,height:844},permissions:['clipboard-read','clipboard-write']});const page=await context.newPage();
page.on('pageerror',e=>errors.push(e.message));
await page.addInitScript(()=>{window.__opened=[];window.open=url=>{window.__opened.push(url);return null;};});
await page.route('**/api/v1/**',async route=>{
 const req=route.request(),p=new URL(req.url()).pathname,body=req.method()==='GET'?null:req.postDataJSON(),w=p.split('/')[5];
 const send=(data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify({ok:status<400,...data})});
 if(p.endsWith('/public/config'))return send({authMode:'dev',monitorPilotEnabled:true});
 if(p.endsWith('/session'))return send({session:{workspaceId:'w-sui',userId:'u-sui',permissions:['catalog.view','purchases.write']}});
 if(p.endsWith('/supplier-orders')&&p.includes('/reviews/')){
   if(req.method()==='GET')return send({weekStart:w,round:1,items,suppliers,assignments:[...assignments.values()].filter(a=>a.week===w),preferences,orders});
   finalizeCalls++;try{const selections=Object.fromEntries(items.map(i=>[i.itemKey,assignments.get(w+':'+i.itemKey)?.supplierId||preferences[i.productId]]));
     const groups=buildSupplierOrderGroups({items,suppliers,selections});assert.equal(body.fingerprint,supplierOrderFingerprint(groups));
     for(const g of groups)orders.push({...g,id:'order-'+(orders.length+1),status:'FINALIZED',weekStart:w,round:1});return send({orders});
   }catch(e){return send({message:e.message},400);}
 }
 if(p.includes('/supplier-assignments/')){if(failAssignment)return send({message:'Sin conexión de prueba'},503);const key=decodeURIComponent(p.split('/').pop()),a={itemKey:key,supplierId:body.supplierId,version:1,week:w};assignments.set(w+':'+key,a);return send({assignment:a});}
 if(p.includes('/monitor/suppliers/')&&req.method()==='PUT'){const s={id:p.split('/').pop(),name:body.name,phone:'584141234567',active:body.active,version:1};suppliers.push(s);return send({supplier:s});}
 if(p.endsWith('/sent')){const o=orders.find(o=>o.id===p.split('/').at(-2));o.status='SENT';for(const i of o.items)preferences[i.productId]=o.supplierId;return send({order:o});}
 if(p.includes('/reviews/')&&p.endsWith('/items')){const i=items.find(i=>i.itemKey==='product:'+body.itemId);Object.assign(i,{quantity:body.quantity,unit:body.unit,notes:body.notes,decision:body.decision,version:i.version+1});return send({item:i});}
 if(p.includes('/reviews/'))return send({workspaceId:'w-sui',weekStart:w,currentRound:1,items});
 if(p.includes('/review-cycles/'))return send({round:1,currentRound:1});return send({message:'Unknown '+p},404);
});
const tab=name=>page.locator('[data-mp-page="'+name+'"]');
const row=name=>page.locator('.mp-supplier-assignment').filter({hasText:name});
async function open(){await page.locator('#app h2').evaluate(el=>{el.textContent='Comprar / Pedir';});await page.locator('#vigiaMonitorPilotLauncher').click();await page.locator('#mpWeekSelect').selectOption('2026-10-19');await page.waitForFunction(()=>!document.querySelector('#mpWeekSelect').disabled);}
try{
 await mkdir('test-results/monitor-suppliers',{recursive:true});await page.goto('http://127.0.0.1:'+server.address().port+'/test/browser/monitorPilot.html?vigiaMonitorPilot=1');
 await page.evaluate(async()=>{const db=await import('/src/storage/database.js'),sync=await import('/src/sync/syncSettings.js');await sync.saveSyncConfig({workspaceId:'w-sui',serverUserId:'u-sui',authMode:'dev'});for(const [id,name] of [['p1','Servilletas'],['p2','Aceite']])await db.put(db.STORES.PRODUCTS,{id,name,categoryId:'c1',unitCode:'UND',active:true});await db.put(db.STORES.CATEGORIES,{id:'c1',name:'Consumo',active:true});document.querySelector('#app h2').textContent='Comprar / Pedir';});
 await open();assert.equal(await tab('suppliers').count(),1,'Monitor exposes supplier catalogue');await tab('suppliers').click();
 await page.locator('#mpSupplierForm [name="name"]').fill('Sumervalca');await page.locator('#mpSupplierForm [name="phone"]').fill('04141234567');await page.locator('#mpSupplierForm button[type="submit"]').click();await page.locator('#mpSupplierRows').getByText('Sumervalca',{exact:true}).waitFor();
 const id=suppliers[0].id;await tab('supplier-assign').click();await row('Servilletas').locator('[data-ms-filter]').fill('sum');failAssignment=true;await row('Servilletas').locator('select').selectOption(id);await page.getByText('Sin conexión de prueba',{exact:true}).waitFor();
 failAssignment=false;await page.reload();await open();await tab('supplier-assign').click();await row('Servilletas').waitFor();assert.equal(await row('Servilletas').locator('select').inputValue(),id,'selection survives failed request and reload');
 await page.locator('[data-ms-action="retry"]').click();await page.waitForFunction(()=>!document.querySelector('[data-ms-action="retry"]').disabled);await row('Aceite').locator('select').selectOption(id);await page.waitForFunction(()=>!document.querySelector('[data-ms-action="retry"]').disabled);
 await tab('supplier-final').click();await page.getByText(/Servilletas: falta una cantidad positiva/).waitFor();assert.equal(await page.locator('[data-ms-action="finalize"]').count(),0);assert.equal(finalizeCalls,0);
 await tab('selected').click();const selected=page.locator('.mp-selected-row').filter({hasText:'Servilletas'});await selected.locator('.mp-edit-quantity').fill('3');await selected.locator('.mp-edit-quantity').press('Enter');await page.waitForFunction(()=>document.querySelectorAll('.mp-save-status[data-status="saved"]').length>0);
 await tab('supplier-final').click();await page.locator('[data-ms-action="finalize"]').click();await page.locator('[data-ms-action="whatsapp"]').waitFor();assert.equal(await page.locator('[data-ms-action="whatsapp"]').count(),1);
 await page.locator('[data-ms-action="whatsapp"]').click();const opened=await page.evaluate(()=>window.__opened);assert.equal(opened.length,1);const text=new URL(opened[0]).searchParams.get('text');assert.match(text,/3 CAJA — Servilletas \(Blancas\)/);assert.match(text,/2 BULTO — Aceite/);assert.equal(await page.locator('[data-ms-action="sent"]').count(),1,'open is not sent');
 await page.locator('[data-ms-action="copy"]').click();assert.match(await page.evaluate(()=>navigator.clipboard.readText()),/confirma despacho y facturación/);
 await page.locator('[data-ms-action="sent"]').scrollIntoViewIfNeeded();
 const beforeSent=await page.evaluate(()=>{
   window.__supplierPanelBeforeSent=document.querySelector('.mp-suppliers');
   return {top:document.querySelector('#vigiaMonitorPilot').scrollTop,nav:document.querySelector('.mp-nav').scrollLeft};
 });
 assert.ok(beforeSent.top>100,'test must mark sent while scrolled down');
 page.once('dialog',d=>d.accept());await page.locator('[data-ms-action="sent"]').click();await page.getByText(/Enviado · confirmado manualmente/).waitFor();
 const afterSent=await page.evaluate(()=>({same:window.__supplierPanelBeforeSent===document.querySelector('.mp-suppliers'),
   top:document.querySelector('#vigiaMonitorPilot').scrollTop,nav:document.querySelector('.mp-nav').scrollLeft}));
 assert.equal(afterSent.same,true,'mark sent must update the existing panel without reloading it');
 assert.ok(Math.abs(afterSent.top-beforeSent.top)<=1,'mark sent moved vertical scroll: '+JSON.stringify({beforeSent,afterSent}));
 assert.equal(afterSent.nav,beforeSent.nav,'mark sent moved navigation scroll');await page.screenshot({path:'test-results/monitor-suppliers/pedidos-mobile.png'});
 await page.locator('#mpWeekSelect').selectOption('2026-10-26');await page.waitForFunction(()=>!document.querySelector('#mpWeekSelect').disabled);await tab('supplier-assign').click();await page.getByText('Sugerido según tu último pedido enviado').first().waitFor();assert.equal(await row('Servilletas').locator('select').inputValue(),id);
 const layout=await page.evaluate(()=>({width:document.querySelector('#vigiaMonitorPilot').scrollWidth,viewport:innerWidth}));assert.ok(layout.width<=layout.viewport+1,JSON.stringify(layout));await page.screenshot({path:'test-results/monitor-suppliers/asignar-mobile.png'});assert.deepEqual(errors,[]);
 console.log('MONITOR_SUPPLIER_BROWSER_PASS: catalogue, search, durable assignments, required quantity, grouped WhatsApp/copy, manual sent and next-week learning');
}catch(e){await page.screenshot({path:'test-results/monitor-suppliers/failure.png'});console.error(e);process.exitCode=1;}finally{await browser.close();server.close();}
