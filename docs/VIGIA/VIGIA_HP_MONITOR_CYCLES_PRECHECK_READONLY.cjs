#!/usr/bin/env node
'use strict';
// VIGIA Monitor -- preflight de SOLO LECTURA antes del cambio de ciclos.
// No crea ni migra tablas, no cambia .env, no reinicia servicio ni imprime secretos.
const path=require('node:path');
const fs=require('node:fs');
const {createRequire}=require('node:module');
const {execFileSync}=require('node:child_process');
const root=process.env.VIGIA_APP_ROOT||'C:\\SmartInventory\\App';
const server=path.join(root,'v2','server');
const expectedMinimum=21;
const allowedBase='smart_inventory';
async function main(){
  if(!fs.existsSync(path.join(server,'package.json'))||!fs.existsSync(path.join(server,'.env')))
    throw Error('No se encontro VIGIA en C:\\SmartInventory\\App');
  const rev=execFileSync('git.exe',['-C',root,'rev-parse','HEAD'],
    {encoding:'utf8',windowsHide:true}).trim();
  const status=execFileSync('git.exe',['-C',root,'status','--porcelain','--untracked-files=no'],
    {encoding:'utf8',windowsHide:true}).trim();
  const requireApp=createRequire(path.join(server,'package.json'));
  requireApp('dotenv').config({path:path.join(server,'.env'),override:false,quiet:true});
  const uri=process.env.DATABASE_URL;
  if(!uri)throw Error('DATABASE_URL no configurada');
  const url=new URL(uri);
  if(!['postgres:','postgresql:'].includes(url.protocol)||
     decodeURIComponent(url.pathname.slice(1))!==allowedBase)
    throw Error('Base configurada no corresponde a smart_inventory');
  const pg=requireApp('pg');
  const client=new pg.Client({connectionString:uri,
    application_name:'vigia_monitor_cycles_preflight_readonly',
    connectionTimeoutMillis:10000,statement_timeout:15000});
  const checks=[];
  function check(label,passed,value){
    checks.push(Boolean(passed));
    console.log('['+(passed?'OK':'BLOQUEADO')+'] '+label+
      (value===undefined?'':' | '+value));
  }
  console.log('================================================');
  console.log(' VIGIA - CICLOS, PREGUNTAR Y BUSCADOR / PRECHECK');
  console.log('================================================');
  check('Git sin cambios rastreados',status.length===0,'HEAD='+rev);
  const health=await fetch('http://127.0.0.1:5190/health',{signal:AbortSignal.timeout(8000)})
    .then(x=>x.json()).catch(()=>null);
  const ready=await fetch('http://127.0.0.1:5190/ready',{signal:AbortSignal.timeout(8000)})
    .then(x=>x.json()).catch(()=>null);
  check('/health y /ready',health?.ok===true&&ready?.ok===true);
  const cfg=await fetch('http://127.0.0.1:5190/api/v1/public/config',{signal:AbortSignal.timeout(8000)})
    .then(x=>x.json()).catch(()=>null);
  check('Monitor Pilot activado previamente',cfg?.monitorPilotEnabled===true);
  try{
    await client.connect();
    await client.query('BEGIN READ ONLY');
    const r=await client.query(
      "SELECT current_database() AS db,current_user AS role,"+
      "(SELECT COUNT(*)::int FROM schema_migrations) AS migrations,"+
      "(SELECT COUNT(*)::int FROM schema_migrations WHERE filename="+
      "'022_monitor_review_cycles_ask.sql') AS has_022,"+
      "(SELECT COUNT(*)::int FROM products) AS products,"+
      "(SELECT COUNT(*)::int FROM monitor_weekly_review_items) AS active_reviews,"+
      "to_regclass('public.monitor_review_cycles') IS NOT NULL AS cycle_table,"+
      "to_regclass('public.monitor_review_archives') IS NOT NULL AS archive_table");
    const a=r.rows[0];
    check('DB de produccion y rol',a.db==='smart_inventory'&&a.role==='smart_inventory');
    check('Version de migraciones previa',a.migrations===expectedMinimum&&a.has_022===0,
      'migraciones='+a.migrations+', 022='+a.has_022);
    check('Tablas nuevas aun no aplicadas',!a.cycle_table&&!a.archive_table);
    check('Productos intactos',a.products>0,'activos+inactivos='+a.products);
    console.log('REVISIONES_MONITOR_ACTIVAS='+a.active_reviews);
    await client.query('COMMIT');
  }finally{await client.end().catch(()=>{});}
  console.log('NO SE HA INSTALADO NI MODIFICADO NADA.');
  if(!checks.every(Boolean)){
    console.error('VIGIA_MONITOR_CYCLES_PRECHECK_BLOCKED');
    process.exitCode=2;
  }else{
    console.log('VIGIA_MONITOR_CYCLES_PRECHECK_PASS');
    console.log('FALTA AUTORIZAR Y PREPARAR RESPALDO NUEVO ANTES DE 022.');
  }
}
main().catch(e=>{
 console.error('VIGIA_MONITOR_CYCLES_PRECHECK_FAIL: '+String(e.message||'Error'));
 process.exitCode=1;
});
