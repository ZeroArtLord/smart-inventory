#!/usr/bin/env node
'use strict';
// VIGÍA: prueba real de restauración con cuenta POSTGRES separada.
// Este programa NO cambia permisos, NO altera smart_inventory ni reinicia VIGÍA.
// Crea una DB efímera aleatoria, la restaura, verifica, y borra SOLO esa DB.
// La clave de postgres se introduce en PowerShell y llega por entorno temporal.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const {createRequire}=require('node:module');

const SERVER=process.env.VIGIA_SERVER_DIR||'C:\\SmartInventory\\App\\v2\\server';
const BIN=process.env.VIGIA_PG_BIN_DIR||'C:\\Program Files\\PostgreSQL\\18\\bin';
const ARCHIVE=process.env.VIGIA_RESTORE_DUMP||
  'F:\\SmartInventoryBackups\\VIGIA_MANUAL_PREDEPLOY\\vigia_manual_predeploy_2026-10-12T13-40-02-012Z.dump';
const EXPECTED_SHA='3b83bd345a0128810d44e50c154162b2fc5e9fff79c95ec697dbdb33a4f0a0e4';
const SCRATCH='vigia_restore_probe_'+crypto.randomBytes(10).toString('hex');
const IDENT=/^vigia_restore_probe_[a-f0-9]{20}$/;
const OLD_DATABASE='smart_inventory';
function insist(value,message){if(!value)throw Error(message);}
function tempSql(){
  insist(IDENT.test(SCRATCH),'Nombre temporal no seguro');
  insist(SCRATCH!==OLD_DATABASE&&SCRATCH!=='postgres','Destino no seguro');
  return '"'+SCRATCH+'"';
}
async function fileHash(file){
  const hash=crypto.createHash('sha256');
  for await(const chunk of fs.createReadStream(file))hash.update(chunk);
  return hash.digest('hex');
}
function restoreArchive(args,environment){
  return new Promise((resolve,reject)=>{
    const cli=path.join(BIN,'pg_restore.exe');
    let settled=false;
    const child=spawn(cli,args,{env:environment,stdio:['ignore','ignore','pipe'],windowsHide:true});
    let errors='';
    child.stderr.on('data',part=>{errors=(errors+part.toString()).slice(-1600);});
    child.once('error',()=>{if(!settled){settled=true;reject(Error('No se pudo iniciar pg_restore.exe'));}});
    child.once('close',status=>{
      if(settled)return;
      settled=true;
      if(status===0)resolve();
      else reject(Error('pg_restore devolvio codigo '+status+' (destino temporal). '+cleanError(errors)));
    });
  });
}
function cleanError(value){
  // El administrador nunca se añade a los argumentos ni a los mensajes.
  return String(value||'').replace(/password[^\n]*/gi,'password [OCULTA]')
    .slice(0,400).replace(/\s+/g,' ');
}
async function main(){
  insist(process.platform==='win32','Este comprobador se ejecuta en el HP Windows');
  insist(fs.existsSync(ARCHIVE),'No se encuentra el dump manual indicado');
  insist(fs.existsSync(path.join(BIN,'pg_restore.exe')),'No se encontro pg_restore.exe');
  insist(fs.existsSync(path.join(SERVER,'package.json')),'Carpeta del servidor no encontrada');
  insist(fs.existsSync(path.join(SERVER,'.env')),'No se encontro .env del servidor');
  const adminPassword=process.env.VIGIA_PG_ADMIN_PASSWORD;
  insist(adminPassword && adminPassword.length>0,
    'Solicita la clave de postgres de forma oculta en PowerShell; no pasarla por argumento');
  console.log('[1/6] Comparando SHA256 con el respaldo protegido...');
  const sha=await fileHash(ARCHIVE);
  insist(sha===EXPECTED_SHA,'SHA256 incorrecto. No se ejecuta ninguna operacion SQL');
  const scoped=createRequire(path.join(SERVER,'package.json'));
  scoped('dotenv').config({path:path.join(SERVER,'.env'),override:false,quiet:true});
  const pg=scoped('pg');
  const source=process.env.DATABASE_URL;
  insist(source,'DATABASE_URL no configurada');
  const connection=new URL(source);
  insist(['postgres:','postgresql:'].includes(connection.protocol),'URI PostgreSQL invalida');
  insist(decodeURIComponent(connection.pathname.replace(/^\//,''))===OLD_DATABASE,
    'El VIGIA actual usa una DB inesperada: detener');
  const host=connection.hostname||'127.0.0.1';
  const port=Number(connection.port||5432);
  insist(Number.isInteger(port)&&port>0&&port<65536,'Puerto invalido');
  const options={
    host,port,user:'postgres',password:adminPassword,connectionTimeoutMillis:12000
  };
  if(connection.searchParams.get('sslmode')==='require')options.ssl={rejectUnauthorized:false};
  const admin=new pg.Client({...options,database:'postgres',application_name:'vigia_restore_admin'});
  let tempClient=null;
  let created=false;
  let restored=false;
  let deleted=false;
  console.log('[2/6] Autenticando administrador en la base postgres (sin cambiar roles)...');
  try{
    await admin.connect();
    const check=await admin.query(
      "SELECT current_database() AS db, current_user AS role, "+
      "r.rolcreatedb AS createdb, r.rolsuper AS superuser "+
      "FROM pg_roles r WHERE r.rolname=current_user"
    );
    const role=check.rows[0];
    insist(role&&role.db==='postgres'&&role.role==='postgres',
      'No se confirmo acceso administrativo al usuario postgres en base postgres');
    insist(role.createdb===true||role.superuser===true,
      'El rol administrador autenticado tampoco tiene CREATEDB');
    const preexisting=await admin.query('SELECT 1 FROM pg_database WHERE datname=$1',[SCRATCH]);
    insist(preexisting.rowCount===0,'La base temporal ya existe: abortar sin tocarla');
    console.log('[3/6] Creando exclusivamente una base efimera nueva...');
    await admin.query('CREATE DATABASE '+tempSql()+' TEMPLATE template0');
    created=true;
    console.log('[4/6] Restaurando el dump solo en '+SCRATCH+' ...');
    const environment={...process.env,PGPASSWORD:adminPassword,PGCONNECT_TIMEOUT:'12'};
    delete environment.VIGIA_PG_ADMIN_PASSWORD;
    const sslmode=connection.searchParams.get('sslmode');
    if(sslmode)environment.PGSSLMODE=sslmode;
    await restoreArchive([
      '--exit-on-error','--single-transaction','--no-owner','--no-privileges',
      '--no-password','--host',host,'--port',String(port),
      '--username','postgres','--dbname',SCRATCH,ARCHIVE
    ],environment);
    tempClient=new pg.Client({...options,database:SCRATCH,application_name:'vigia_restore_validate'});
    await tempClient.connect();
    const actual=await tempClient.query('SELECT current_database() AS db');
    insist(actual.rows[0]?.db===SCRATCH,'La lectura no se realizo en la DB temporal');
    const mustHave=[
      'workspaces','users','workspace_members','products',
      'documents','document_lines','movements','lots',
      'replenishments','sync_events','audit_events',
      'workspace_initial_loads','schema_migrations','inventory_stock'
    ];
    for(const name of mustHave){
      const rel=await tempClient.query("SELECT to_regclass($1) AS rel",['public.'+name]);
      insist(rel.rows[0]?.rel,'Objeto ausente en el backup restaurado: '+name);
    }
    const summary=await tempClient.query(
      'SELECT (SELECT COUNT(*)::int FROM workspaces) AS workspaces,'+
      '(SELECT COUNT(*)::int FROM products) AS products,'+
      '(SELECT COUNT(*)::int FROM documents) AS documents,'+
      '(SELECT COUNT(*)::int FROM document_lines) AS document_lines,'+
      '(SELECT COUNT(*)::int FROM movements) AS movements,'+
      '(SELECT COUNT(*)::int FROM sync_events) AS sync_events,'+
      '(SELECT COUNT(*)::int FROM audit_events) AS audit_events,'+
      '(SELECT COUNT(*)::int FROM schema_migrations) AS migrations'
    );
    insist(summary.rows[0]?.workspaces>0&&summary.rows[0]?.products>0&&
      summary.rows[0]?.migrations>0,'El backup restaurado carece de registros criticos');
    console.log('[5/6] Tablas y registros verificados en DB temporal.');
    console.log('DATOS_RESTAURADOS '+JSON.stringify(summary.rows[0]));
    restored=true;
  }finally{
    if(tempClient)await tempClient.end().catch(()=>{});
    if(created){
      console.log('[6/6] Borrando UNICAMENTE la DB efimera creada...');
      try{
        // Nunca IF EXISTS sobre un nombre externo, jamás drop de smart_inventory.
        await admin.query('DROP DATABASE '+tempSql());
        deleted=true;
      }catch{
        console.error('ATENCION: DB temporal restante '+SCRATCH+
          '; no borrar nada manualmente hasta revisarlo');
      }
    }
    await admin.end().catch(()=>{});
  }
  insist(restored,'La restauracion no se verifico');
  insist(deleted,'Restauracion correcta, pero la limpieza de la base temporal no se confirmo');
  console.log('VIGIA_RESTORE_ADMIN_PASS: restauracion completa, datos comprobados y DB temporal eliminada');
  console.log('VIGIA PRODUCTIVO: smart_inventory intacto; servicio no reiniciado; roles sin modificar.');
}
main().catch(e=>{
  console.error('VIGIA_RESTORE_ADMIN_FAIL: '+cleanError(e.message));
  console.error('NO actualizar ni migrar VIGIA mientras falte PASS.');
  process.exitCode=1;
});
