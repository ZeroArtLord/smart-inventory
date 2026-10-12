#!/usr/bin/env node
'use strict';
// VIGIA MONITOR HP: solo lectura. Sin SQL DDL, migraciones, git pull, reinicios ni borrados.
// Escribe únicamente salida a la consola. No muestra secretos de DATABASE_URL.
const fs=require('node:fs');
const fsp=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const {createRequire}=require('node:module');
const {execFileSync}=require('node:child_process');
const ROOT='C:\\SmartInventory\\App';
const SERVER=path.join(ROOT,'v2','server');
const ARCHIVE='F:\\SmartInventoryBackups\\VIGIA_MANUAL_PREDEPLOY\\vigia_manual_predeploy_2026-10-12T13-40-02-012Z.dump';
const SNAPSHOT='F:\\SmartInventoryBackups\\VIGIA_MANUAL_PREDEPLOY\\HP_APP_SNAPSHOT_20261012_095434_67ae0e91';
const EXPECTED_SHA='3b83bd345a0128810d44e50c154162b2fc5e9fff79c95ec697dbdb33a4f0a0e4';
const EXPECTED_PROD='067eb9f94e1441836c67f26c97f0c34a5e4745b8';
const EXPECTED_MIGRATIONS=[
 '001_init.sql','002_dev_workspace_key.sql','003_lot_location.sql','004_replenishments.sql',
 '005_entity_versions.sql','006_audit_events.sql','007_data_integrity.sql',
 '008_movement_relations.sql','009_unique_user_email.sql','010_product_presentations.sql',
 '011_saint_initial_load.sql','012_product_saint_code.sql','013_product_intelligence_policy.sql',
 '014_product_saint_bridge.sql','015_supply_areas.sql','016_supply_area_drafts.sql',
 '017_area_shortcuts.sql','018_product_barcodes.sql','019_manual_procurement_request.sql'
];
const TARGET_NEW=['020_monitor_weekly_reviews.sql','021_monitor_supply_deliveries.sql'];
const results=[];
function check(label,ok,detail){
 results.push({label,ok:Boolean(ok)});
 console.log('['+(ok?'OK':'BLOQUEADO')+'] '+label+(detail?' | '+detail:''));
}
async function sha(file){
 const h=crypto.createHash('sha256');
 for await(const piece of fs.createReadStream(file))h.update(piece);
 return h.digest('hex');
}
async function main(){
 console.log('================================================');
 console.log(' VIGIA HP - ULTIMO PREFLIGHT PARA MONITOR (LECTURA)');
 console.log('================================================');
 console.log('El proceso no cambia DB, archivos de produccion, servicio o colas.');
 const required=[
  path.join(SERVER,'package.json'),path.join(SERVER,'.env'),
  path.join(ROOT,'v2','index.html'),path.join(ROOT,'v2','sw.js')
 ];
 check('Archivos de aplicacion actual',required.every(f=>fs.existsSync(f)));
 if(!results.at(-1).ok)throw Error('Archivos requeridos ausentes');
 const rev=execFileSync('git',['-C',ROOT,'rev-parse','HEAD'],{encoding:'utf8',windowsHide:true}).trim();
 const changed=execFileSync('git',['-C',ROOT,'status','--porcelain','--untracked-files=no'],{encoding:'utf8',windowsHide:true}).trim();
 check('Version del HP sin desviaciones',rev===EXPECTED_PROD&&changed==='',rev.slice(0,12)+' | modificados='+ (changed?changed.split(/\r?\n/).length:0));
 check('Respaldo PostgreSQL presente',fs.existsSync(ARCHIVE));
 if(fs.existsSync(ARCHIVE)){
  const st=await fsp.stat(ARCHIVE);
  const match=await sha(ARCHIVE)===EXPECTED_SHA;
  check('Respaldo PostgreSQL SHA256',st.size===1893531&&match,'bytes='+st.size);
 }
 check('Snapshot App y Servicio presente',
  fs.existsSync(path.join(SNAPSHOT,'App','v2','server','.env'))&&
  fs.existsSync(path.join(SNAPSHOT,'Service','SmartInventoryService.exe'))&&
  fs.existsSync(path.join(SNAPSHOT,'VIGIA_SNAPSHOT_RECEIPT.txt')));
 for(const rel of ['v2\\index.html','v2\\sw.js','v2\\server\\src\\app.js','v2\\server\\.env']){
  const live=path.join(ROOT,rel),safe=path.join(SNAPSHOT,'App',rel);
  if(fs.existsSync(live)&&fs.existsSync(safe)){
   check('Hash coincide '+rel,await sha(live)===await sha(safe));
  }else{check('Hash coincide '+rel,false,'archivo faltante');}
 }
 const scoped=createRequire(path.join(SERVER,'package.json'));
 scoped('dotenv').config({path:path.join(SERVER,'.env'),override:false});
 const pg=scoped('pg');
 const uri=process.env.DATABASE_URL;
 if(!uri)throw Error('DATABASE_URL ausente. No mostrar valor.');
 const parsed=new URL(uri);
 check('Base configurada exacta',decodeURIComponent(parsed.pathname.slice(1))==='smart_inventory');
 const client=new pg.Client({connectionString:uri,
  application_name:'vigia_monitor_preflight_readonly',
  statement_timeout:10000,connectionTimeoutMillis:10000});
 try{
  await client.connect();
  const env=await client.query(
    "SELECT current_database() AS db, current_user AS role, "+
    "has_schema_privilege(current_user, 'public', 'CREATE') AS can_create_in_public, "+
    "to_regclass('public.monitor_weekly_review_items') IS NOT NULL AS monitor_review_exists, "+
    "to_regclass('public.monitor_supply_deliveries') IS NOT NULL AS monitor_supply_exists"
  );
  const e=env.rows[0]||{};
  check('Conexion al PostgreSQL real',e.db==='smart_inventory'&&e.role==='smart_inventory',
    'base='+e.db+' | rol='+e.role);
  check('Permiso para migraciones aditivas',e.can_create_in_public===true,
    'schema public CREATE='+e.can_create_in_public);
  check('Monitor aun sin tablas nuevas',e.monitor_review_exists===false&&e.monitor_supply_exists===false);
  const rows=await client.query("SELECT filename FROM schema_migrations ORDER BY filename");
  const applied=rows.rows.map(x=>String(x.filename));
  const missing=EXPECTED_MIGRATIONS.filter(x=>!applied.includes(x));
  const extra=applied.filter(x=>!EXPECTED_MIGRATIONS.includes(x));
  check('Migraciones V2 exactas antes de Monitor',
    missing.length===0&&extra.length===0&&applied.length===19,
    'aplicadas='+applied.length+' | ausentes='+missing.join(',')+' | adicionales='+extra.join(','));
  check('Monitor 020/021 pendientes',
    TARGET_NEW.every(x=>!applied.includes(x)),'esperadas='+TARGET_NEW.join(','));
  const count=await client.query(
   "SELECT (SELECT COUNT(*)::int FROM products) AS products,"+
   "(SELECT COUNT(*)::int FROM documents) AS documents,"+
   "(SELECT COUNT(*)::int FROM movements) AS movements"
  );
  console.log('DATOS_PRODUCTIVOS_ACTUALES '+JSON.stringify(count.rows[0]));
 } finally {await client.end().catch(()=>{});}
 console.log('================================================');
 const failures=results.filter(x=>!x.ok).map(x=>x.label);
 if(failures.length){
  console.log('VIGIA_MONITOR_PREFLIGHT_BLOCKED: '+failures.join(' ; '));
  console.log('NO instalar, NO migrar y NO reiniciar hasta revisar.');
  process.exitCode=2;
 }else{
  console.log('VIGIA_MONITOR_PREFLIGHT_READONLY_PASS');
  console.log('NO se ha instalado ni migrado el HP. Pendiente autorizacion de despliegue y reinicio corto.');
 }
}
main().catch(err=>{
 console.error('VIGIA_MONITOR_PREFLIGHT_ERROR: '+String(err.code||err.message||'Error'));
 console.error('NO instalar ni migrar hasta aclarar.');
 process.exitCode=1;
});
