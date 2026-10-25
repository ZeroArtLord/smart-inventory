#!/usr/bin/env node
'use strict';
// VIGÍA: diagnóstico solo lectura. No crea bases ni cambia permisos.
const path=require('node:path');
const {createRequire}=require('node:module');
const fs=require('node:fs');
const server=process.env.VIGIA_SERVER_DIR||'C:\\SmartInventory\\App\\v2\\server';

(async()=>{
  if(!fs.existsSync(path.join(server,'package.json'))||
     !fs.existsSync(path.join(server,'.env')))throw Error('No se encontró instalación VIGÍA');
  const appRequire=createRequire(path.join(server,'package.json'));
  appRequire('dotenv').config({path:path.join(server,'.env'),override:false});
  const pg=appRequire('pg');
  const url=process.env.DATABASE_URL;
  if(!url)throw Error('DATABASE_URL no disponible');
  const parsed=new URL(url);
  if(!['postgres:','postgresql:'].includes(parsed.protocol))throw Error('URI no es PostgreSQL');
  const selectedDb=decodeURIComponent(parsed.pathname.replace(/^\//,''));
  if(selectedDb!=='smart_inventory')throw Error('Base inesperada; detener');
  const adminUrl=new URL(url);adminUrl.pathname='/postgres';
  const client=new pg.Client({connectionString:adminUrl.toString(),application_name:'vigia_role_diagnostic_readonly'});
  try{
    await client.connect();
    const info=await client.query(
      "SELECT current_user AS session_user, current_database() AS database_name, "+
      "r.rolcreatedb AS can_create_databases, r.rolsuper AS superuser, "+
      "(SELECT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='postgres' AND rolsuper)) AS postgres_admin_role_exists "+
      "FROM pg_roles r WHERE r.rolname=current_user"
    );
    const temp=await client.query(
      "SELECT count(*)::int AS temporary_probe_databases "+
      "FROM pg_database WHERE datname LIKE 'vigia_restore_probe_%'"
    );
    if(info.rows.length!==1)throw Error('No se pudo identificar rol');
    const r=info.rows[0];
    console.log('VIGIA_PG_ROLE_READONLY_PASS');
    console.log('DB consultada: '+r.database_name);
    console.log('Rol de servicio: '+r.session_user);
    console.log('Puede crear bases: '+r.can_create_databases);
    console.log('Es superusuario: '+r.superuser);
    console.log('Existe rol administrador postgres: '+r.postgres_admin_role_exists);
    console.log('DB temporales con prefijo de prueba: '+temp.rows[0].temporary_probe_databases);
    console.log('No se crearon bases ni cambiaron roles, servicios o archivos.');
  }finally{
    await client.end().catch(()=>{});
  }
})().catch(err=>{
  console.error('VIGIA_PG_ROLE_READONLY_FAIL: '+err.message);
  process.exitCode=1;
});
