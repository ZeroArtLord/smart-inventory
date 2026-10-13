#!/usr/bin/env node
'use strict';
// VIGÍA Monitor — copia manual adicional. No modifica el servidor, tablas ni
// respaldos anteriores. Se debe ejecutar en el HP con Node.js instalado.
// La carpeta objetivo es un subdirectorio fuera de la retención del backup V2.
const { createRequire }=require('node:module');
const fs=require('node:fs');
const fsp=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const crypto=require('node:crypto');
const { spawn }=require('node:child_process');

const server=process.env.VIGIA_SERVER_DIR||'C:\\SmartInventory\\App\\v2\\server';
const backupRoot=process.env.VIGIA_MANUAL_BACKUP_DIR||'F:\\SmartInventoryBackups\\VIGIA_MANUAL_PREDEPLOY';
const executableDir=process.env.VIGIA_PG_BIN_DIR||'C:\\Program Files\\PostgreSQL\\18\\bin';
const timestamp=new Date().toISOString().replace(/[:.]/g,'-');
const destination=path.join(backupRoot,'vigia_manual_predeploy_'+timestamp+'.dump');
const temporary=destination+'.partial';

function safetyCheck(){
  if(!fs.existsSync(path.join(server,'package.json'))||
     !fs.existsSync(path.join(server,'.env')))throw Error('No se encontro la instalacion o el .env del servidor');
  if(!fs.existsSync(path.join(executableDir,'pg_dump.exe'))||
     !fs.existsSync(path.join(executableDir,'pg_restore.exe')))
    throw Error('No se encontraron pg_dump.exe y pg_restore.exe en la ruta verificada');
  const root=path.resolve(backupRoot).toLowerCase();
  if(root===path.resolve('F:\\SmartInventoryBackups').toLowerCase())
    throw Error('Se requiere SUBCARPETA manual para evitar purgas por retencion');
}
async function run(cmd,args,env){
  return new Promise((resolve,reject)=>{
    const child=spawn(cmd,args,{
      env,stdio:['ignore','ignore','pipe'],windowsHide:true
    });
    let stderr='';
    child.stderr.on('data',chunk=>{
      // No mostrar detalles de errores que pudiesen incluir credenciales.
      stderr+=chunk.toString().slice(0,1000);
    });
    child.once('error',()=>reject(Error(path.basename(cmd)+' no pudo iniciarse')));
    child.once('close',code=>code===0?resolve():reject(Error(path.basename(cmd)+' fallo con codigo '+code)));
  });
}
async function sha256(file){
  const hash=crypto.createHash('sha256');
  for await(const chunk of fs.createReadStream(file))hash.update(chunk);
  return hash.digest('hex');
}
(async()=>{
  safetyCheck();
  const scoped=createRequire(path.join(server,'package.json'));
  const dotenv=scoped('dotenv');
  dotenv.config({path:path.join(server,'.env'),override:false});
  const raw=process.env.DATABASE_URL;
  if(!raw)throw Error('DATABASE_URL no esta disponible en la configuracion');
  const url=new URL(raw);
  if(!['postgres:','postgresql:'].includes(url.protocol)||!url.pathname||url.pathname==='/')
    throw Error('La configuracion de base de datos no es valida');
  const database=decodeURIComponent(url.pathname.slice(1));
  const user=decodeURIComponent(url.username);
  const password=decodeURIComponent(url.password);
  if(!user||!database)throw Error('La configuracion de PostgreSQL carece de nombre de usuario o base');
  const host=url.hostname||'127.0.0.1';
  const port=url.port||'5432';
  const env={...process.env,PGPASSWORD:password,PGCONNECT_TIMEOUT:'12'};
  const sslmode=url.searchParams.get('sslmode');
  if(sslmode)env.PGSSLMODE=sslmode;
  await fsp.mkdir(backupRoot,{recursive:true});
  // Exclusive file creation: a never-used backup name; never overwrite.
  const handle=await fsp.open(temporary,'wx');
  await handle.close();
  try{
    console.log('[1/4] Realizando copia consistente online (pg_dump) ...');
    await run(path.join(executableDir,'pg_dump.exe'),[
      '--format=custom','--no-owner','--no-privileges',
      '--host',host,'--port',port,'--username',user,
      '--dbname',database,'--file',temporary
    ],env);
    const stat=await fsp.stat(temporary);
    if(stat.size<1024)throw Error('El archivo creado es sospechosamente pequeno');
    console.log('[2/4] Verificando catalogo de objetos (pg_restore --list) ...');
    await run(path.join(executableDir,'pg_restore.exe'),['--list',temporary],env);
    console.log('[3/4] Leyendo/descomprimiendo contenido sin restaurar la DB ...');
    await run(path.join(executableDir,'pg_restore.exe'),[
      '--no-owner','--no-privileges','--file',
      process.platform==='win32'?'NUL':'/dev/null',temporary
    ],env);
    await fsp.rename(temporary,destination);
    const digest=await sha256(destination);
    const receipt=destination+'.sha256.txt';
    await fsp.writeFile(receipt,
      [
        'VIGIA MANUAL BACKUP CHECK 2026-10-12',
        'ARCHIVO: '+path.basename(destination),
        'TAMANO_BYTES: '+stat.size,
        'SHA256: '+digest,
        'PG_RESTORE_LIST: OK',
        'PG_RESTORE_DECOMPRESS: OK',
        'RESTAURACION_EN_DB_TEMPORAL: NO REALIZADA',
        'PRODUCCION: SIN CAMBIOS DE TABLAS O MOVIMIENTOS',
        'COPIAS_ANTIGUAS: NO ELIMINADAS'
      ].join(os.EOL)+os.EOL,{flag:'wx'}
    );
    console.log('[4/4] Backup manual completado y revisado.');
    console.log('Archivo: '+destination);
    console.log('Tamaño: '+stat.size+' bytes');
    console.log('SHA256: '+digest);
    console.log('Comprobante: '+receipt);
    console.log('ATENCION: la restauracion en una base de prueba aun NO se ha ejecutado.');
  }catch(error){
    await fsp.rm(temporary,{force:true}).catch(()=>{});
    throw error;
  }
})().catch(error=>{
  console.error('RESPALDO NO VALIDADO: '+error.message);
  process.exitCode=1;
});
