#!/usr/bin/env node
'use strict';
// VIGIA HP: verifica RESTAURACION COMPLETA del dump manual en una DB EFIMERA.
// No altera la DB de la app, movimientos, IndexedDB ni el servicio Windows.
// Crea SOLO una DB nueva de nombre aleatorio, la restaura, consulta y elimina.
// Si no tiene permiso CREATEDB se detiene SIN modificar permisos de usuarios.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const {createRequire}=require('node:module');

const SERVER=process.env.VIGIA_SERVER_DIR||'C:\\SmartInventory\\App\\v2\\server';
const PG_BIN=process.env.VIGIA_PG_BIN_DIR||'C:\\Program Files\\PostgreSQL\\18\\bin';
const DUMP=process.env.VIGIA_RESTORE_DUMP||
  'F:\\SmartInventoryBackups\\VIGIA_MANUAL_PREDEPLOY\\vigia_manual_predeploy_2026-10-12T13-40-02-012Z.dump';
const EXPECTED_SHA='3b83bd345a0128810d44e50c154162b2fc5e9fff79c95ec697dbdb33a4f0a0e4';
const TEMP_DB='vigia_restore_probe_'+crypto.randomBytes(8).toString('hex');
const restoreExe=path.join(PG_BIN,'pg_restore.exe');
const role='archive_restore_probe';

function assert(condition,message){if(!condition)throw Error(message);}
async function hashFile(file){
  const sha=crypto.createHash('sha256');
  for await(const chunk of fs.createReadStream(file))sha.update(chunk);
  return sha.digest('hex');
}
async function runRestore(args,env){
  await new Promise((resolve,reject)=>{
    let stderr='';
    let settled=false;
    const cp=spawn(restoreExe,args,{env,stdio:['ignore','ignore','pipe'],windowsHide:true});
    cp.stderr.on('data',chunk=>{stderr+=(chunk.toString().slice(0,512));if(stderr.length>1200)stderr=stderr.slice(-1200);});
    cp.once('error',()=>{
      if(settled)return;settled=true;reject(Error('No fue posible iniciar pg_restore'));
    });
    cp.once('close',code=>{
      if(settled)return;settled=true;
      code===0?resolve():reject(Error('pg_restore fallo con codigo '+code+'; restauracion NO verificada'));
    });
  });
}
async function main(){
  assert(fs.existsSync(DUMP),'No se encuentra el dump seleccionado: detener');
  assert(fs.existsSync(restoreExe),'No se encuentra pg_restore.exe 18: detener');
  assert(fs.existsSync(path.join(SERVER,'.env')),'Falta .env del servidor: detener');
  assert(fs.existsSync(path.join(SERVER,'node_modules','pg')),'Falta libreria pg local: detener');
  console.log('[1/5] Verificando SHA256 del respaldo existente...');
  const sha=await hashFile(DUMP);
  assert(sha===EXPECTED_SHA,'SHA256 NO coincide. NO restaurar ningun archivo inesperado');
  const use=createRequire(path.join(SERVER,'package.json'));
  const dotenv=use('dotenv');
  dotenv.config({path:path.join(SERVER,'.env'),override:false,quiet:true});
  const pg=use('pg');
  const original=process.env.DATABASE_URL;
  assert(original,'DATABASE_URL no disponible: detener');
  const parsed=new URL(original);
  assert(['postgres:','postgresql:'].includes(parsed.protocol),'Conexion PostgreSQL invalida');
  const dbName=decodeURIComponent(parsed.pathname.replace(/^\//,''));
  assert(dbName==='smart_inventory','Base operativa distinta de smart_inventory: requiere revision');
  const urlAdmin=new URL(original);
  urlAdmin.pathname='/postgres';
  urlAdmin.searchParams.delete('application_name');
  // La conexión administradora SOLO apuntará a "postgres", nunca a smart_inventory.
  const admin=new pg.Client({connectionString:urlAdmin.toString(),
    application_name:'vigia_restore_preflight_admin'});
  let restored;
  let created=false;
  let restorePassed=false;
  let cleaned=false;
  console.log('[2/5] Conectando a la base administrativa postgres (no a la productiva)...');
  try{
    await admin.connect();
    const marker=await admin.query('SELECT current_database() AS name');
    assert(marker.rows[0].name==='postgres','Se conecto a la base incorrecta: detener');
    const exists=await admin.query('SELECT 1 FROM pg_database WHERE datname=$1',[TEMP_DB]);
    assert(exists.rowCount===0,'Colision en nombre de base efimera: detener');
    console.log('[3/5] Creando SOLO base temporal de restauracion...');
    assert(/^vigia_restore_probe_[a-f0-9]{16}$/.test(TEMP_DB),'Nombre temporal invalido');
    await admin.query('CREATE DATABASE "'+TEMP_DB+'"');
    created=true;
    const dbTempUrl=new URL(original);
    dbTempUrl.pathname='/'+TEMP_DB;
    dbTempUrl.searchParams.delete('application_name');
    const env={
      ...process.env,
      PGPASSWORD:decodeURIComponent(parsed.password),
      PGCONNECT_TIMEOUT:'12'
    };
    const args=[
      '--exit-on-error','--single-transaction','--no-owner','--no-privileges',
      '--host',parsed.hostname||'127.0.0.1',
      '--port',parsed.port||'5432',
      '--username',decodeURIComponent(parsed.username),
      '--dbname',TEMP_DB,
      DUMP
    ];
    const sslmode=parsed.searchParams.get('sslmode');
    if(sslmode)env.PGSSLMODE=sslmode;
    console.log('[4/5] Restaurando dump EN BASE TEMPORAL, sin tocar smart_inventory...');
    await runRestore(args,env);
    restored=new pg.Client({connectionString:dbTempUrl.toString(),
      application_name:'vigia_restore_verify_readonly'});
    await restored.connect();
    const current=await restored.query('SELECT current_database() AS name');
    assert(current.rows[0].name===TEMP_DB,'La consulta de validacion no entro en la DB temporal');
    const required=[
      'public.workspaces','public.users','public.products',
      'public.documents','public.document_lines','public.movements',
      'public.sync_events','public.audit_events','public.schema_migrations',
      'public.inventory_stock'
    ];
    const objectTypes=await restored.query(
      "SELECT to_regclass($1) AS object_name",['public.schema_migrations']);
    assert(objectTypes.rows[0].object_name,'Esquema de migraciones no fue restaurado');
    for(const obj of required){
      const result=await restored.query('SELECT to_regclass($1) AS name',[obj]);
      assert(result.rows[0].name,'Objeto critico ausente en restore: '+obj);
    }
    const summary=await restored.query(
      'SELECT '+
      '(SELECT COUNT(*)::int FROM workspaces) AS workspaces,'+
      '(SELECT COUNT(*)::int FROM products) AS products,'+
      '(SELECT COUNT(*)::int FROM documents) AS documents,'+
      '(SELECT COUNT(*)::int FROM movements) AS movements,'+
      '(SELECT COUNT(*)::int FROM sync_events) AS sync_events,'+
      '(SELECT COUNT(*)::int FROM audit_events) AS audit_events,'+
      '(SELECT COUNT(*)::int FROM schema_migrations) AS migrations'
    );
    assert(summary.rows[0].workspaces>0,'El backup restaurado no contiene ningun workspace');
    assert(summary.rows[0].products>0,'El backup restaurado no contiene productos');
    assert(summary.rows[0].migrations>0,'El backup restaurado no contiene migraciones');
    console.log('RESTORE_DATA_OK '+JSON.stringify(summary.rows[0]));
    restorePassed=true;
  }finally{
    if(restored)await restored.end().catch(()=>{});
    if(created){
      console.log('[5/5] Eliminando SOLO la DB efimera creada por esta prueba...');
      try{
        // NO TERMINAR conexiones ajenas, NO tocar base productiva.
        assert(/^vigia_restore_probe_[a-f0-9]{16}$/.test(TEMP_DB),'Identificador inseguro');
        await admin.query('DROP DATABASE "'+TEMP_DB+'"');
        cleaned=true;
      }catch(error){
        console.error('ATENCION: no fue posible borrar la DB temporal '+TEMP_DB+
          '. NO eliminar nada manualmente sin revision.');
      }
    }
    await admin.end().catch(()=>{});
  }
  assert(restorePassed,'Restauracion total no verificada');
  assert(cleaned,'La prueba restauro, pero no confirmo limpieza de la base temporal');
  console.log('VIGIA_RESTORE_REAL_PASS: dump SHA256, restauracion transaccional, tablas y datos verificados, DB temporal eliminada');
  console.log('Base de produccion: NO modificada. Windows SmartInventoryV2: NO reiniciado.');
}
main().catch(e=>{
  console.error('VIGIA_RESTORE_REAL_FAIL: '+e.message);
  console.error('No actualizar VIGIA ni aplicar migraciones hasta aclarar el resultado.');
  process.exitCode=1;
});
