# VIGÍA / ByteMind Solutions — Precheck de producción (SOLO LECTURA)
# NO instala, detiene, reinicia, migra, modifica stock ni elimina archivos/colas.
# Guarda un informe TXT local para revisarlo antes del despliegue real.
param(
  [string]$Root = 'C:\SmartInventory\App',
  [string]$ServiceName = 'SmartInventoryV2',
  [string]$OutputDirectory = "$env:TEMP\VIGIA_PRECHECK"
)
$ErrorActionPreference='Continue'
$ProgressPreference='SilentlyContinue'
$stamp=Get-Date -Format 'yyyyMMdd_HHmmss'
New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
$reportFile=Join-Path $OutputDirectory ("VIGIA_HP_PRECHECK_"+$stamp+".txt")
$lines=New-Object 'System.Collections.Generic.List[string]'
function Add-Line([string]$Message) {
  $lines.Add($Message)
  Write-Host $Message
}
function Check-Path([string]$Name,[string]$Value) {
  Add-Line ("[{0}] {1}: {2}" -f $(if(Test-Path -LiteralPath $Value){'OK'}else{'PENDIENTE'}),$Name,$Value)
}
function Health-Check([string]$Label,[string]$Url) {
  try {
    $response=Invoke-RestMethod -Uri $Url -Method Get -TimeoutSec 5 -ErrorAction Stop
    Add-Line ("[RESPONDE] {0}: ok={1}" -f $Label,[string]$response.ok)
    if($Label -eq '/ready' -and $response.ok -ne $true) {
      Add-Line "[ATENCION] /ready no confirma estado listo. NO DESPLEGAR todavia."
    }
  } catch {
    Add-Line ("[PENDIENTE] {0}: no responde o no fue accesible ({1})" -f $Label,$_.Exception.Message)
  }
}
Add-Line "============================================================"
Add-Line " VIGIA MONITOR - REVISION DEL HP SIN CAMBIOS DE PRODUCCION"
Add-Line " Fecha: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
Add-Line " Clave de continuidad: VIGIA-FARO-1011"
Add-Line "============================================================"
Add-Line ""
Add-Line "1) SISTEMA Y SERVICIO"
Add-Line ("Host: {0}" -f $env:COMPUTERNAME)
Add-Line ("Windows: {0}" -f [Environment]::OSVersion.VersionString)
try {
  $svc=Get-CimInstance Win32_Service -Filter ("Name='"+$ServiceName+"'") -ErrorAction Stop
  if($null -eq $svc) {
    Add-Line "[PENDIENTE] No se encontro el servicio $ServiceName"
  } else {
    Add-Line ("Servicio: {0} / Inicio: {1} / PID: {2}" -f $svc.State,$svc.StartMode,$svc.ProcessId)
    Add-Line ("Ruta del servicio: {0}" -f $svc.PathName)
  }
} catch {Add-Line "[PENDIENTE] No se pudo consultar Win32_Service"}
Add-Line ""
Add-Line "2) ARCHIVOS ACTUALES"
Check-Path "Raiz VIGIA" $Root
Check-Path "Servidor" (Join-Path $Root 'v2\server')
Check-Path "Interfaz actual" (Join-Path $Root 'v2\index.html')
Check-Path "Service Worker" (Join-Path $Root 'v2\sw.js')
$localGit=Get-Command git -ErrorAction SilentlyContinue
if($null -ne $localGit) {
  $commit=& git -C $Root rev-parse HEAD 2>$null
  if($LASTEXITCODE -eq 0 -and $commit) {Add-Line ("Git HEAD local: {0}" -f $commit.Trim())}
  else {Add-Line "[NOTA] La carpeta instalada no es un repositorio Git, comprobar version con archivos originales"}
}
# Lectura solo de claves NO sensibles; nunca exportar .env o passwords.
$envFile=Join-Path $Root 'v2\server\.env'
if(Test-Path -LiteralPath $envFile){
  $keys=@('NODE_ENV','AUTH_MODE','PORT','HOST','BACKUP_DIR','MONITOR_PILOT_ENABLED')
  foreach($rawLine in (Get-Content -LiteralPath $envFile -ErrorAction SilentlyContinue)) {
    if($rawLine -match '^\s*([A-Z_]+)\s*=\s*(.*)$') {
      $k=$Matches[1]
      if($keys -contains $k){Add-Line ("Config {0}={1}" -f $k,$Matches[2])}
    }
  }
} else {Add-Line "[NOTA] .env no ubicado en ruta estandar"}
Add-Line ""
Add-Line "3) RESPUESTA LOCAL DEL SERVICIO"
Health-Check '/health' 'http://127.0.0.1:5190/health'
Health-Check '/ready' 'http://127.0.0.1:5190/ready'
Add-Line ""
Add-Line "4) ESPACIO Y HERRAMIENTAS BACKUP"
try {
  $drive=Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='C:'"
  if($null -ne $drive) {
    Add-Line ("C: libre GB: {0:N2}" -f ($drive.FreeSpace/1GB))
  }
} catch {Add-Line "[PENDIENTE] No se pudo consultar espacio libre"}
foreach($cmd in @('pg_dump','pg_restore','psql','node')){
  $tool=Get-Command $cmd -ErrorAction SilentlyContinue
  Add-Line ("{0}: {1}" -f $cmd,$(if($tool){$tool.Source}else{'No disponible en PATH'}))
}
$backupCandidates=@('C:\SmartInventory\Backups','C:\SmartInventory\Backup')
foreach($dir in $backupCandidates){
 if(Test-Path -LiteralPath $dir){
  $files=Get-ChildItem -LiteralPath $dir -File -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 3
  Add-Line ("Backups presentes en {0}: {1} archivos mas recientes" -f $dir,@($files).Count)
  foreach($file in $files){
    Add-Line ("  {0} | {1:N2} MB | {2}" -f $file.Name,($file.Length/1MB),$file.LastWriteTime)
  }
 }
}
Add-Line ""
Add-Line "5) RESTRICCIONES ANTES DE ACTIVAR"
Add-Line "[PENDIENTE] Demostrar backup PostgreSQL y restauracion comprobada antes de migrar."
Add-Line "[PENDIENTE] Verificar pendientes/conflictos locales en CADA telefono, no visibles desde este script."
Add-Line "[PENDIENTE] Autorizar una ventana corta para activar Monitor con usuario permitido y rollback."
Add-Line "[SEGURIDAD] Este diagnostico NO ha cambiado servicio, DB, version, stock, cache ni colas."
Add-Line ""
try {
  [IO.File]::WriteAllLines($reportFile,$lines,[Text.Encoding]::UTF8)
  Write-Host ""
  Write-Host ("INFORME GUARDADO: {0}" -f $reportFile) -ForegroundColor Cyan
} catch {
  Write-Host "No fue posible guardar el informe. El diagnostico sigue visible arriba." -ForegroundColor Yellow
}
