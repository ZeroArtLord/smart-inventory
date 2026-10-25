#!/usr/bin/env node
'use strict';
// Verificador SQL de VIGIA en HP: solo lectura, ninguna migracion ni DDL.
// Ejecucion: node VIGIA_HP_MONITOR_DB_VERIFY_SAFE.cjs counts|schema
// Carga pg/dotenv desde la instalacion real sin mover .env ni revelar credenciales.
// Se ejecuta como ARCHIVO .cjs; NO usar node -e (PowerShell 5.1 altera comillas).
const fs=require('node:fs');
const path=require('node:path');
const {createRequire}=require('node:module');
const server=process.env.VIGIA_SERVER_DIR||'C:\\SmartInventory\\App\\v2\\server';
const mode=process.argv[2];
const countSQL=[
 'SELECT current_database() AS db,',
 '(SELECT COUNT(*)::int FROM products) AS products,',
 '(SELECT COUNT(*)::int FROM documents) AS documents,',
 '(SELECT COUNT(*)::int FROM document_lines) AS lines,',
 '(SELECT COUNT(*)::int FROM movements) AS movements,',
 '(SELECT COUNT(*)::int FROM sync_events) AS sync,',
 '(SELECT COUNT(*)::int FROM audit_events) AS audit'
].join(' ');
const schemaSQL=[
 'SELECT current_database() AS db,',
 '(SELECT COUNT(*)::int FROM schema_migrations) AS mig,',
 '(SELECT COUNT(*)::int FROM schema_migrations',
 " WHERE filename IN ('020_monitor_weekly_reviews.sql','021_monitor_supply_deliveries.sql')) AS monitor_mig,",
 '(SELECT COUNT(*)::int FROM monitor_weekly_review_items) AS review_items,',
 '(SELECT COUNT(*)::int FROM monitor_weekly_review_mutations) AS review_mutations,',
 '(SELECT COUNT(*)::int FROM monitor_supply_deliveries) AS supply_deliveries'
].join(' ');
(async()=>{
 if(!['counts','schema'].includes(mode))throw Error('Modo invalido: counts o schema');
 if(!fs.existsSync(path.join(server,'package.json'))||
    !fs.existsSync(path.join(server,'.env')))throw Error('Instalacion VIGIA incompleta');
 const use=createRequire(path.join(server,'package.json'));
 use('dotenv').config({path:path.join(server,'.env'),override:false,quiet:true});
 const pg=use('pg');
 const uri=process.env.DATABASE_URL;
 if(!uri)throw Error('DATABASE_URL ausente');
 const source=new URL(uri);
 if(!['postgres:','postgresql:'].includes(source.protocol)||
    decodeURIComponent(source.pathname.replace(/^\//,''))!=='smart_inventory'){
  throw Error('La URI no apunta a la DB permitida');
 }
 const c=new pg.Client({
  connectionString:uri,
  application_name:'vigia_hp_monitor_readonly_verify',
  connectionTimeoutMillis:10000,
  statement_timeout:12000
 });
 try{
  await c.connect();
  await c.query('BEGIN TRANSACTION READ ONLY');
  const result=await c.query(mode==='counts'?countSQL:schemaSQL);
  const row=result.rows[0];
  if(!row||row.db!=='smart_inventory')throw Error('DB de consulta inesperada');
  if(mode==='schema'){
   if(row.mig!==21||row.monitor_mig!==2||
      row.review_items!==0||row.review_mutations!==0||row.supply_deliveries!==0){
    throw Error('Las migraciones no estan en el estado aditivo esperado');
   }
   console.log('MONITOR_MIGRATIONS_21_PASS');
  }else{
   console.log('COUNTS='+JSON.stringify(row));
  }
  await c.query('COMMIT');
 }finally{
  await c.end().catch(()=>{});
 }
})().catch(()=>{
 console.error('VIGIA_MONITOR_DB_READONLY_FAIL');
 process.exitCode=1;
});
