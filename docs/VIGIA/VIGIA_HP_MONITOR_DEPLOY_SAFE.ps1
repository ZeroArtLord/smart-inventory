# VIGIA MONITOR HP - FASE B CONTROLADA (APLICACION REAL)
# Usuario autorizo mantenimiento, detencion/reinicio SmartInventoryV2 y migraciones 020/021.
# NO modifica la clave de PostgreSQL, .env, stock, cola offline, ni respalda/purga datos.
# Si falla tras detener, intenta rollback SOLO DEL CODIGO al commit previo, preservando tablas aditivas.
[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
$root='C:\SmartInventory\App'
$server=Join-Path $root 'v2\server'
$node='C:\Program Files\nodejs\node.exe'
$old='067eb9f94e1441836c67f26c97f0c34a5e4745b8'
$target='e8cdedac21cf372261049543644ec2b1d68cfa9f'
$newDump='F:\SmartInventoryBackups\VIGIA_MANUAL_PREDEPLOY\vigia_manual_predeploy_2026-10-13T13-03-19-421Z.dump'
$newHash='64f0b48a373dd34c959237419c10325b2171092b3f59bb8d9a4ad6735a6420d5'
$snapshot='F:\SmartInventoryBackups\VIGIA_MANUAL_PREDEPLOY\HP_APP_SNAPSHOT_20261012_095434_67ae0e91'
$stageDir=Join-Path $env:TEMP 'VIGIA_MONITOR_PREPARE'
$logDir=Join-Path $env:TEMP 'VIGIA_MONITOR_DEPLOY'
New-Item -ItemType Directory -Path $logDir -Force | Out-Null
$logFile=Join-Path $logDir ('VIGIA_HP_MONITOR_DEPLOY_'+(Get-Date -Format 'yyyyMMdd_HHmmss')+'.txt')
$messages=New-Object 'System.Collections.Generic.List[string]'
$serviceStopped=$false
$codeUpdated=$false
$success=$false
$rollbackSuccess=$false
$baseline=$null
$step='inicio'
function Say([string]$s) {$messages.Add($s);Write-Host $s}
function Insist([bool]$yes,[string]$s) {if(-not $yes){throw $s}}
function GitChecked([string[]]$a) {
    $v=& git.exe -C $root @a 2>&1
    if($LASTEXITCODE -ne 0){throw ('Git devolvio error: '+($a -join ' '))}
    return (($v -join [Environment]::NewLine).Trim())
}
function CurrentSha(){return (GitChecked @('rev-parse','HEAD'))}
function TrackedChanges(){return (GitChecked @('status','--porcelain','--untracked-files=no'))}
function WaitService([string]$name,[string]$expected,[int]$seconds) {
    $svc=Get-Service -Name $name -ErrorAction Stop
    $desired=[Enum]::Parse([ServiceProcess.ServiceControllerStatus],$expected)
    $svc.WaitForStatus($desired,[TimeSpan]::FromSeconds($seconds))
    $svc.Refresh()
    Insist ($svc.Status.ToString() -eq $expected) ($name+' no alcanzo '+$expected)
}
function WaitApi([int]$seconds) {
    $until=(Get-Date).AddSeconds($seconds)
    while((Get-Date) -lt $until) {
        try {
            $h=Invoke-RestMethod -Uri 'http://127.0.0.1:5190/health' -Method Get -TimeoutSec 4 -ErrorAction Stop
            $r=Invoke-RestMethod -Uri 'http://127.0.0.1:5190/ready' -Method Get -TimeoutSec 4 -ErrorAction Stop
            if($h.ok -eq $true -and $r.ok -eq $true) {return}
        }catch{}
        Start-Sleep -Seconds 2
    }
    throw 'VIGIA no devolvio /health y /ready ok=true antes del timeout'
}
function NodeChecked([string[]]$arguments,[string]$purpose){
    & $node @arguments
    if($LASTEXITCODE -ne 0){throw ($purpose+' falló. Codigo='+$LASTEXITCODE)}
}
function ReadCounts {
    Push-Location $server
    try {
        # Usa dotenv + pg instalado, sin imprimir DATABASE_URL ni credenciales.
        $js=@'
require("dotenv").config();
const pg=require("pg");
(async()=>{
 const c=new pg.Client({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:10000});
 try{
  await c.connect();
  const r=await c.query("SELECT current_database() AS db,"+
    "(SELECT COUNT(*)::int FROM products) AS products,"+
    "(SELECT COUNT(*)::int FROM documents) AS documents,"+
    "(SELECT COUNT(*)::int FROM document_lines) AS lines,"+
    "(SELECT COUNT(*)::int FROM movements) AS movements,"+
    "(SELECT COUNT(*)::int FROM sync_events) AS sync,"+
    "(SELECT COUNT(*)::int FROM audit_events) AS audit");
  if(r.rows[0]?.db!=="smart_inventory")throw Error("La DB no es smart_inventory");
  console.log("COUNTS="+JSON.stringify(r.rows[0]));
 }finally{await c.end().catch(()=>{});}
})().catch(()=>{console.error("ERROR_CONTEOS_READONLY");process.exitCode=1});
'@
        $out=@(& $node -e $js)
        Insist ($LASTEXITCODE -eq 0) 'No se pudieron obtener los conteos actuales'
        $line=@($out|Where-Object {$_ -match '^COUNTS='}|Select-Object -Last 1)
        Insist ($line.Count -eq 1) 'Salida de conteos inesperada'
        return $line[0].Substring(7)
    }finally{Pop-Location}
}
function ValidateMonitorSchema {
    Push-Location $server
    try {
        $js=@'
require("dotenv").config();
const {Client}=require("pg");
(async()=>{
const c=new Client({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:10000});
try{
 await c.connect();
 const q=await c.query("SELECT current_database() AS db,"+
 "(SELECT COUNT(*)::int FROM schema_migrations) AS mig,"+
 "(SELECT COUNT(*)::int FROM schema_migrations WHERE filename IN "+
 "('020_monitor_weekly_reviews.sql','021_monitor_supply_deliveries.sql')) AS monitor_mig,"+
 "(SELECT COUNT(*)::int FROM monitor_weekly_review_items) AS review_items,"+
 "(SELECT COUNT(*)::int FROM monitor_weekly_review_mutations) AS review_mutations,"+
 "(SELECT COUNT(*)::int FROM monitor_supply_deliveries) AS supply_deliveries");
 const a=q.rows[0];
 if(a.db!=="smart_inventory"||a.mig!==21||a.monitor_mig!==2||
 a.review_items!==0||a.review_mutations!==0||a.supply_deliveries!==0) {
  throw Error("La migracion no quedo en el estado aditivo esperado");
 }
 console.log("MONITOR_MIGRATIONS_21_PASS");
}finally{await c.end().catch(()=>{});}
})().catch(()=>{console.error("MONITOR_SCHEMA_CHECK_FAILED");process.exitCode=1});
'@
        NodeChecked -arguments @('-e',$js) -purpose 'Validacion SQL de Monitor'
    }finally{Pop-Location}
}
function SecureFlagIsOff {
    $envPath=Join-Path $server '.env'
    Insist (Test-Path -LiteralPath $envPath -PathType Leaf) 'Falta .env productivo'
    $lines=Get-Content -LiteralPath $envPath -ErrorAction Stop
    $enabled=@($lines|Where-Object {$_ -match '^\s*MONITOR_PILOT_ENABLED\s*=\s*["'']?true(?:["'']?\s*(?:#.*)?)?$'})
    Insist ($enabled.Count -eq 0) 'El .env tiene Monitor habilitado antes del despliegue'
    Insist ($env:MONITOR_PILOT_ENABLED -ne 'true') 'La sesion de PowerShell tiene Monitor activado'
}
function CheckHealthFlag([bool]$strict) {
    WaitApi 75
    $cfg=Invoke-RestMethod -Uri 'http://127.0.0.1:5190/api/v1/public/config' -TimeoutSec 7
    Insist ($cfg.ok -eq $true) 'Config publica no responde ok=true'
    $prop=$cfg.PSObject.Properties['monitorPilotEnabled']
    if($strict){
        Insist ($null -ne $prop -and $cfg.monitorPilotEnabled -eq $false) 'Monitor NO esta apagado en config publica nueva'
    }else{
        Insist ($null -eq $prop -or $cfg.monitorPilotEnabled -eq $false) 'Piloto se encuentra habilitado ANTES de instalar'
    }
}
function StartOldVersionOnFailure {
    Say 'RECUPERACION: verificando que el servicio este detenido antes de restaurar archivos...'
    $prior=Get-Service -Name 'SmartInventoryV2' -ErrorAction Stop
    if($prior.Status -ne 'Stopped'){
        Stop-Service -Name 'SmartInventoryV2' -ErrorAction Stop
        WaitService 'SmartInventoryV2' 'Stopped' 40
    }
    Start-Sleep -Seconds 2
    $openPorts=@(Get-NetTCPConnection -LocalPort 5190 -State Listen -ErrorAction SilentlyContinue)
    Insist ($openPorts.Count -eq 0) 'Puerto 5190 aun escucha; no cambiar codigo durante rollback'
    $sha=CurrentSha
    $clean=[string]::IsNullOrWhiteSpace((TrackedChanges))
    if($sha -eq $old){
        Say 'RECUPERACION: codigo antiguo ya presente.'
    } elseif($sha -eq $target -and $clean -and $codeUpdated) {
        # Esta accion cambia SOLO archivos rastreados que el propio script instaló.
        # Nunca usa git clean ni elimina .env ni toca PostgreSQL.
        [void](GitChecked @('reset','--hard',$old))
        Insist ((CurrentSha) -eq $old) 'No se pudo restituir codigo antiguo'
        Say 'RECUPERACION: codigo anterior restaurado; tablas Monitor aditivas se conservan.'
    }else{
        throw ('RECUPERACION MANUAL NECESARIA: SHA/estado inesperado. HEAD='+$sha)
    }
    $svc=Get-Service -Name 'SmartInventoryV2'
    if($svc.Status -ne 'Running'){
        Start-Service -Name 'SmartInventoryV2' -ErrorAction Stop
        WaitService 'SmartInventoryV2' 'Running' 35
    }
    WaitApi 75
    Say 'ROLLBACK_CODIGO_OK: servicio viejo respondiendo /health y /ready; NO se revirtio la DB.'
}
try{
    Say '========================================================='
    Say ' VIGIA MONITOR HP - DESPLIEGUE CONTROLADO Y REVERSIBLE'
    Say '========================================================='
    Say ('Fecha local: '+(Get-Date -Format 'yyyy-MM-dd HH:mm:ss'))
    Say 'Importante: los clientes no deben registrar operaciones durante esta ventana.'
    $step='Prevalidar servicio, version, backups y bandera'
    Insist ((Get-Service 'SmartInventoryV2').Status -eq 'Running') 'Servicio VIGIA no esta Running'
    Insist ((Get-Service 'postgresql-x64-18').Status -eq 'Running') 'PostgreSQL 18 no esta Running'
    Insist ((CurrentSha) -eq $old) 'Version inesperada de VIGIA'
    Insist ([string]::IsNullOrWhiteSpace((TrackedChanges))) 'Cambios locales rastreados; cancelar'
    Insist ([bool](Get-Command git.exe -ErrorAction SilentlyContinue)) 'git.exe no encontrado'
    Insist (Test-Path -LiteralPath $node -PathType Leaf) 'Node no encontrado'
    Insist (Test-Path -LiteralPath (Join-Path $snapshot 'VIGIA_SNAPSHOT_RECEIPT.txt') -PathType Leaf) 'Snapshot de aplicacion ausente'
    Insist (Test-Path -LiteralPath $newDump -PathType Leaf) 'Respaldo del 13-Oct no encontrado'
    $digest=(Get-FileHash -LiteralPath $newDump -Algorithm SHA256).Hash.ToLowerInvariant()
    Insist ($digest -eq $newHash) 'SHA256 de respaldo nuevo no coincide'
    $stage=@(Get-ChildItem -LiteralPath $stageDir -Filter 'VIGIA_MONITOR_STAGE_*.txt' -File -ErrorAction Stop|Sort-Object LastWriteTime -Descending|Select-Object -First 1)
    Insist ($stage.Count -eq 1) 'No se encontro informe de STAGE'
    Insist ((Get-Content -LiteralPath $stage[0].FullName -Raw).Contains('STAGE_PASS_SIN_PARAR_SERVICIO')) 'STAGE no aprobo'
    Insist ($stage[0].LastWriteTime.Date -eq (Get-Date).Date) 'STAGE no es de hoy; regenerar preparacion'
    Insist (((Get-Date)-(Get-Item -LiteralPath $newDump).LastWriteTime).TotalHours -lt 4) 'Dump demasiado antiguo para ventana; generar otro respaldo'
    [void](GitChecked @('cat-file','-e',($target+'^{commit}')))
    & git.exe -C $root merge-base --is-ancestor $old $target
    Insist ($LASTEXITCODE -eq 0) 'El SHA Monitor no es fast-forward del anterior'
    $dep=GitChecked @('diff','--name-only',$old,$target,'--','v2/server/package.json','v2/server/package-lock.json')
    Insist ([string]::IsNullOrWhiteSpace($dep)) 'Cambios de dependencias no previstos'
    SecureFlagIsOff
    CheckHealthFlag $false
    $baseline=ReadCounts
    Say ('[OK] Precheck: git '+$old.Substring(0,12)+'; dump SHA256; snapshot; Monitor off')
    Say ('COUNTS_ANTES '+$baseline)
    Say 'Este procedimiento puede interrumpir VIGIA durante algunos minutos.'
    $approve=Read-Host 'Escribe EJECUTAR para detener servicio, instalar Monitor y aplicar 020/021'
    if($approve -cne 'EJECUTAR'){throw 'Operador no confirmo EJECUTAR, produccion sin cambios'}
    $step='Detener solo SmartInventoryV2'
    Say '[1/7] Deteniendo SOLO SmartInventoryV2...'
    Stop-Service -Name 'SmartInventoryV2' -ErrorAction Stop
    $serviceStopped=$true
    WaitService 'SmartInventoryV2' 'Stopped' 40
    # El wrapper puede haber terminado y dejar un node huérfano: bloquear checkout si puerto ocupado.
    Start-Sleep -Seconds 2
    $listeners=@(Get-NetTCPConnection -State Listen -LocalPort 5190 -ErrorAction SilentlyContinue)
    Insist ($listeners.Count -eq 0) 'Puerto 5190 sigue en LISTEN: no cambiar archivos con Node activo'
    $step='Avance de Git fast-forward'
    Say '[2/7] Avanzando archivos rastreados hasta SHA probado...'
    [void](GitChecked @('merge','--ff-only','--no-stat',$target))
    $codeUpdated=$true
    Insist ((CurrentSha) -eq $target) 'El HEAD no coincide con el candidato exacto'
    SecureFlagIsOff
    $step='Migraciones 020/021'
    Say '[3/7] Aplicando solamente nuevas migraciones 020/021 (SQL transaccional)...'
    Push-Location $server
    try {NodeChecked -arguments @('scripts/migrate.js') -purpose 'Migrador transaccional'}finally{Pop-Location}
    $step='Comprobando migraciones y datos'
    Say '[4/7] Comprobando 21 migraciones y tablas Monitor inicialmente vacias...'
    ValidateMonitorSchema
    $after=ReadCounts
    Insist ($after -eq $baseline) 'Cambios inesperados en recuentos antiguos; no continuar'
    Say ('COUNTS_DESPUES '+$after)
    $step='Preflight de produccion'
    Say '[5/7] Ejecutando preflight de produccion (Firebase, DB, integridad)...'
    Push-Location $server
    try {NodeChecked -arguments @('scripts/preflightProduction.js') -purpose 'Preflight produccion'}finally{Pop-Location}
    $step='Iniciando servicio y comprobando API'
    Say '[6/7] Iniciando servicio SmartInventoryV2...'
    Start-Service -Name 'SmartInventoryV2' -ErrorAction Stop
    WaitService 'SmartInventoryV2' 'Running' 40
    CheckHealthFlag $true
    $step='Revision final'
    Say '[7/7] Revisando version final y conteos...'
    Insist ((CurrentSha) -eq $target) 'Version final no coincide'
    Insist ([string]::IsNullOrWhiteSpace((TrackedChanges))) 'Aparecieron cambios locales rastreados'
    $finalCounts=ReadCounts
    Insist ($finalCounts -eq $baseline) 'Conteos productivos cambiaron durante mantenimiento'
    Say ('COUNTS_FINALES '+$finalCounts)
    Say 'VIGIA_MONITOR_DEPLOY_SUCCESS_OFF'
    Say 'Servicio Running, API ok, 21 migraciones, piloto apagado; falta validacion visual PC/telefono.'
    $success=$true
}catch{
    Say ('DEPLOY_STEP_FAILED: '+$step)
    Say ('DEPLOY_ERROR: '+$_.Exception.Message)
    if($serviceStopped){
        try{
            StartOldVersionOnFailure
            $rollbackSuccess=$true
        }catch{
            Say ('ROLLBACK_ATTENTION: '+$_.Exception.Message)
            Say 'NO hacer reinicios manuales ni modificar DB hasta revisar el estado.'
        }
    }else{
        Say 'ANTES_DEL_STOP: servicio no fue detenido; no hubo intento de migracion.'
    }
}finally{
    Say ('REPORTE: '+$logFile)
    [IO.File]::WriteAllLines($logFile,$messages,[Text.Encoding]::UTF8)
}
if(-not $success){exit 1}
