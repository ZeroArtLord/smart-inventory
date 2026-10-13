#!/usr/bin/env node
'use strict';
// VIGIA HP Monitor: lectura de la unica cuenta DIOS activa en el workspace.
// SOLO SELECT bajo transaccion READ ONLY. No imprime passwords/tokens/emails.
const fs=require('node:fs');
const path=require('node:path');
const {createRequire}=require('node:module');
const SERVER=process.env.VIGIA_SERVER_DIR||'C:\\SmartInventory\\App\\v2\\server';
(async()=>{
 const file=path.join(SERVER,'package.json');
 if(!fs.existsSync(file)||!fs.existsSync(path.join(SERVER,'.env')))throw Error('Instalacion VIGIA no encontrada');
 const scoped=createRequire(file);
 scoped('dotenv').config({path:path.join(SERVER,'.env'),override:false,quiet:true});
 const uri=process.env.DATABASE_URL;
 if(!uri)throw Error('Falta config de DB');
 const parsed=new URL(uri);
 if(!['postgres:','postgresql:'].includes(parsed.protocol)||
     decodeURIComponent(parsed.pathname.slice(1))!=='smart_inventory')
   throw Error('DB productiva inesperada: detener');
 const {Client}=scoped('pg');
 const conn=new Client({connectionString:uri,application_name:'vigia_pilot_god_lookup_readonly',
   connectionTimeoutMillis:10000,statement_timeout:10000});
 try{
  await conn.connect();
  await conn.query('BEGIN READ ONLY');
  const check=await conn.query(
   "SELECT current_database() AS db, "+
   "(SELECT COUNT(*)::int FROM schema_migrations) AS migrations");
  if(check.rows[0]?.db!=='smart_inventory'||check.rows[0]?.migrations!==21)
   throw Error('Esquema esperado de 21 migraciones no confirmado');
  const r=await conn.query(
   "SELECT u.id::text AS user_id, u.external_auth_id AS firebase_uid, "+
   "COALESCE(u.display_name, '') AS display_name, wm.workspace_id::text AS workspace_id, "+
   "wm.permissions AS permissions "+
   "FROM workspace_members wm "+
   "JOIN users u ON u.id=wm.user_id "+
   "JOIN workspaces w ON w.id=wm.workspace_id "+
   "WHERE wm.role_code='GOD' AND wm.active=true AND u.active=true AND w.active=true "+
   "ORDER BY wm.workspace_id,u.id");
  if(r.rows.length!==1)throw Error('Se requiere exactamente 1 cuenta DIOS activa; encontradas='+r.rows.length);
  const u=r.rows[0];
  const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if(!uuid.test(u.user_id)||!uuid.test(u.workspace_id)||
     !u.firebase_uid||typeof u.firebase_uid!=='string')
   throw Error('La cuenta DIOS no tiene ID interno o identidad Firebase vinculado');
  if(!Array.isArray(u.permissions)||!u.permissions.includes('*'))
   throw Error('La cuenta DIOS no tiene el permiso maestro esperado');
  await conn.query('COMMIT');
  console.log('VIGIA_GOD_IDENTIFIED '+JSON.stringify({
    userId:u.user_id.toLowerCase(),
    workspaceId:u.workspace_id.toLowerCase(),
    displayName:u.display_name,
    firebaseLinked:true
  }));
 }finally{await conn.end().catch(()=>{});}
})().catch(()=>{console.error('VIGIA_GOD_LOOKUP_BLOCKED');process.exitCode=1;});
