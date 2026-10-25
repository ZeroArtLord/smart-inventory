#!/usr/bin/env node
'use strict';
// Solo lectura: confirma la migración 022 y la API sin modificar datos.
const path=require('node:path');
const {createRequire}=require('node:module');
const root=process.env.VIGIA_APP_ROOT||'C:\\SmartInventory\\App';
const server=path.join(root,'v2','server');
const use=createRequire(path.join(server,'package.json'));
use('dotenv').config({path:path.join(server,'.env'),override:false,quiet:true});
const uri=process.env.DATABASE_URL;
if(!uri||decodeURIComponent(new URL(uri).pathname.slice(1))!=='smart_inventory')
  throw Error('Base de producción inesperada');
const pg=use('pg');
const client=new pg.Client({connectionString:uri,connectionTimeoutMillis:10000,statement_timeout:15000});
async function main(){
  const [health,ready,config]=await Promise.all([
    fetch('http://127.0.0.1:5190/health',{signal:AbortSignal.timeout(8000)}).then(r=>r.json()),
    fetch('http://127.0.0.1:5190/ready',{signal:AbortSignal.timeout(8000)}).then(r=>r.json()),
    fetch('http://127.0.0.1:5190/api/v1/public/config',{signal:AbortSignal.timeout(8000)}).then(r=>r.json())
  ]);
  if(health.ok!==true||ready.ok!==true||config.monitorPilotEnabled!==true)
    throw Error('API o piloto no disponibles');
  await client.connect();
  try{
    await client.query('BEGIN READ ONLY');
    const r=await client.query(
      "SELECT current_database() AS db,"+
      "(SELECT COUNT(*)::int FROM schema_migrations) AS migrations,"+
      "(SELECT COUNT(*)::int FROM schema_migrations WHERE filename='022_monitor_review_cycles_ask.sql') AS migration_022,"+
      "to_regclass('public.monitor_review_cycles') IS NOT NULL AS cycles,"+
      "to_regclass('public.monitor_review_archives') IS NOT NULL AS archives,"+
      "(SELECT COUNT(*)::int FROM monitor_weekly_review_items) AS active_reviews");
    const x=r.rows[0];
    if(x.db!=='smart_inventory'||x.migrations!==22||x.migration_022!==1||!x.cycles||!x.archives)
      throw Error('Migración 022 o tablas no coinciden');
    await client.query('COMMIT');
    console.log('REVISIONES_MONITOR_ACTIVAS='+x.active_reviews);
    console.log('VIGIA_MONITOR_CYCLES_POSTCHECK_PASS');
  }finally{await client.end().catch(()=>{});}
}
main().catch(e=>{console.error('VIGIA_MONITOR_CYCLES_POSTCHECK_FAIL: '+e.message);process.exitCode=1;});
