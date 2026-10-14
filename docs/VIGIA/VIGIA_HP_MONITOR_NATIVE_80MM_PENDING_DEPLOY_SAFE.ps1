# VIGIA-FARO-1011 - Monitor -> Comprar/Pedir normal: actualizar e imprimir.
# Despliegue conservador: NO toca PostgreSQL, .env, colas offline ni stock.
# Requiere confirmacion humana al TERMINAR la lista y parada breve SOLO de SmartInventoryV2.
# Se ancla a un SHA funcional probado; falla cerrado si el HP no tiene el SHA base esperado.
[CmdletBinding()]
param([switch]$PreflightOnly)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$root = 'C:\SmartInventory\App'
$base = 'e658deb90bbfb05978f8e1ab6c3d7e1c123d7c02'
$target = '2aaefe9b34a773f1d9d2682393e22301c95d955f'
$branch = 'feature/vigia-monitor-normal-mirror-20261013'
$backupRoot = 'F:\SmartInventoryBackups\VIGIA_MONITOR_NATIVE_80MM'
$logFile = Join-Path $env:TEMP ('VIGIA_MONITOR_NATIVE_80MM_DEPLOY_'+(Get-Date -Format 'yyyyMMdd_HHmmss')+'.txt')
$log = New-Object 'System.Collections.Generic.List[string]'
$changedCode = $false
$serviceStopped = $false
$done = $false
function Say([string]$message) { $log.Add($message); Write-Host $message }
function Demand([bool]$condition,[string]$message) { if(-not $condition){ throw $message } }
function GitChecked([string[]]$gitArgs) {
  $output = & git.exe -C $root @gitArgs 2>&1
  if($LASTEXITCODE -ne 0){ throw ('Git fallo: '+($gitArgs -join ' ')) }
  return (($output -join [Environment]::NewLine).Trim())
}
function CurrentSha { return (GitChecked @('rev-parse','HEAD')) }
function TrackedDirty { return (GitChecked @('status','--porcelain','--untracked-files=no')) }
function ApiReady([int]$maxSeconds) {
  $end = (Get-Date).AddSeconds($maxSeconds)
  while((Get-Date) -lt $end){
    try {
      $h = Invoke-RestMethod -Uri 'http://127.0.0.1:5190/health' -TimeoutSec 5
      $r = Invoke-RestMethod -Uri 'http://127.0.0.1:5190/ready' -TimeoutSec 5
      if($h.ok -eq $true -and $r.ok -eq $true){return}
    }catch{}
    Start-Sleep -Seconds 2
  }
  throw 'Servidor no alcanza /health y /ready OK'
}
function WaitSvc([string]$status,[int]$seconds) {
  $svc = Get-Service -Name 'SmartInventoryV2' -ErrorAction Stop
  $desired = [Enum]::Parse([ServiceProcess.ServiceControllerStatus],$status)
  $svc.WaitForStatus($desired,[TimeSpan]::FromSeconds($seconds))
  $svc.Refresh()
  Demand ($svc.Status.ToString() -eq $status) ('Servicio no alcanzo '+$status)
}
try {
  Say '========================================================='
  Say 'VIGIA MONITOR | IMPRESION ORIGINAL V6 + PENDIENTES RAPIDOS'
  Say '========================================================='
  Say ('Fase: '+$(if($PreflightOnly){'SOLO PRECHECK'}else{'PRECHECK Y CONFIRMACION'}))
  Demand ([bool](Get-Command git.exe -ErrorAction SilentlyContinue)) 'Git no esta instalado'
  Demand (Test-Path -LiteralPath $root -PathType Container) 'Ruta VIGIA no encontrada'
  Demand ((Get-Service -Name 'SmartInventoryV2' -ErrorAction Stop).Status.ToString() -eq 'Running') 'SmartInventoryV2 no esta Running'
  Demand ((Get-Service -Name 'postgresql-x64-18' -ErrorAction Stop).Status.ToString() -eq 'Running') 'PostgreSQL 18 no esta Running'
  ApiReady 20
  $head = CurrentSha
  Say ('SHA instalado: '+$head)
  Demand ($head -eq $base) 'HP tiene version distinta; NO desplegar. Revisar HEAD antes de continuar.'
  Demand ([string]::IsNullOrWhiteSpace((TrackedDirty))) 'Hay cambios locales en archivos rastreados; NO desplegar'
  Say '[1/6] Version y Git limpio verificados.'
  # Git fetch SOLO actualiza .git; no cambia archivos ni servicio.
  [void](GitChecked @('fetch','--quiet','--no-tags','origin',$branch))
  $remote = GitChecked @('rev-parse','FETCH_HEAD')
  [void](GitChecked @('cat-file','-e',($target+'^{commit}')))
  & git.exe -C $root merge-base --is-ancestor $base $target
  Demand ($LASTEXITCODE -eq 0) 'La rama propuesta no desciende de la version activa'
  & git.exe -C $root merge-base --is-ancestor $target $remote
  Demand ($LASTEXITCODE -eq 0) 'El commit aprobado no esta en el remoto obtenido'
  # Se han revisado solo cambios frontend, PWA, tests y documentación.
  $unexpected = GitChecked @('diff','--name-only',$base,$target,'--','v2/server')
  Demand ([string]::IsNullOrWhiteSpace($unexpected)) 'El candidato incluye cambios en backend; cancelar'
  $allowed = @(
    '.github/workflows/v2-tests.yml',
    'docs/VIGIA/VIGIA_HP_MONITOR_NORMAL_PRINT_DEPLOY_SAFE.ps1',
    'v2/scripts/monitorPilotBrowserSmoke.mjs',
    'v2/src/printing/thermalPrinterClient.js',
    'v2/src/replenishment/monitorNativeTicketAdapter.js',
    'v2/src/ui/monitorNormalMirrorUi.js',
    'v2/src/ui/monitorReviewPilotUi.js',
    'v2/src/ui/procurementWorkspaceV6Print.js',
    'v2/src/ui/procurementWorkspaceV6Render.js',
    'v2/src/ui/procurementWorkspaceV6Ui.js',
    'v2/sw.js',
    'v2/test/browser/monitorPilot.html',
    'v2/test/monitorToNormalMirror.test.js'
  )
  $paths = @(GitChecked @('diff','--name-only',$base,$target) | ForEach-Object { $_ -split "[\r\n]+" } | Where-Object { $_ -ne '' })
  foreach($file in $paths) {
    Demand ($allowed -contains $file) ('Archivo inesperado: '+$file)
  }
  Demand ($paths.Count -gt 0) 'Sin cambios candidatos'
  foreach($file in @(
    'docs/VIGIA/VIGIA_HP_MONITOR_NORMAL_PRINT_DEPLOY_SAFE.ps1',
    'v2/src/replenishment/monitorNativeTicketAdapter.js'
  )) {
    Demand (-not (Test-Path -LiteralPath (Join-Path $root $file))) ('Archivo NUEVO no rastreado existente: '+$file)
  }
  Say ('[2/6] Candidato aprobado y sin cambios de servidor. Archivos: '+$paths.Count)
  $cfg = Invoke-RestMethod -Uri 'http://127.0.0.1:5190/api/v1/public/config' -TimeoutSec 8
  Demand ($cfg.ok -eq $true -and $cfg.monitorPilotEnabled -eq $true) 'Monitor no esta activo; detener para diagnosticar'
  Demand (Test-Path -LiteralPath 'F:\' -PathType Container) 'Disco F: de respaldos no disponible'
  New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
  $archive = Join-Path $backupRoot ('VIGIA_CODE_BEFORE_MONITOR_PRINT_'+(Get-Date -Format 'yyyyMMdd_HHmmss')+'.zip')
  & git.exe -C $root archive --format=zip '-o' $archive HEAD
  Demand ($LASTEXITCODE -eq 0 -and (Test-Path -LiteralPath $archive)) 'Snapshot de codigo fallo'
  $hash = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash
  Demand (-not [string]::IsNullOrWhiteSpace($hash)) 'No se pudo obtener SHA256 del respaldo'
  Say ('[3/6] Snapshot codigo guardado en F:, SHA256='+$hash)
  if($PreflightOnly) {
    Say 'PREFLIGHT_MONITOR_PRINT_PASS - Sin parada ni actualizacion de codigo'
    $done = $true
  }else{
    Say 'No se tocaran tablas, stock, .env ni conflictos antiguos.'
    Say 'ASEGURATE de que terminaste y TODOS los dispositivos Monitor indiquen SINCRONIZADO.'
    $ok = Read-Host 'Escribe SINCRONIZADO si tus listas ya llegaron al servidor'
    Demand ($ok -ceq 'SINCRONIZADO') 'Confirmacion de sincronizacion no recibida'
    $ok2 = Read-Host 'Escribe DESPLEGAR para detener SmartInventoryV2 brevemente'
    Demand ($ok2 -ceq 'DESPLEGAR') 'Operacion cancelada por operador'
    Say '[4/6] Deteniendo SOLO SmartInventoryV2...'
    Stop-Service -Name 'SmartInventoryV2' -ErrorAction Stop
    $serviceStopped = $true
    WaitSvc 'Stopped' 45
    Start-Sleep -Seconds 2
    $listeners = @(Get-NetTCPConnection -LocalPort 5190 -State Listen -ErrorAction SilentlyContinue)
    Demand ($listeners.Count -eq 0) 'Puerto 5190 todavia escucha; no cambiar codigo'
    [void](GitChecked @('merge','--ff-only','--no-stat',$target))
    $changedCode = $true
    Demand ((CurrentSha) -eq $target) 'Git no alcanzo candidato fijado'
    Demand ([string]::IsNullOrWhiteSpace((TrackedDirty))) 'Worktree inconsistente tras actualizar'
    Say '[5/6] Codigo actualizado; arrancando servicio sin migrar DB...'
    Start-Service -Name 'SmartInventoryV2' -ErrorAction Stop
    WaitSvc 'Running' 45
    ApiReady 90
    $conf = Invoke-RestMethod -Uri 'http://127.0.0.1:5190/api/v1/public/config' -TimeoutSec 8
    Demand ($conf.ok -eq $true -and $conf.monitorPilotEnabled -eq $true) 'Monitor dejo de estar habilitado'
    Say '[6/6] VIGIA_MONITOR_NATIVE_80MM_PENDING_PASS'
    Say 'Usa Comprar / Pedir -> Mis listas -> Actualizar listas -> Vista 80mm -> Imprimir ticket. Pendientes avanza automaticamente.'
    Say 'La impresión usa el motor nativo V6 ESC/POS TCP/IP. Conservar impresora RC-8002 configurada.'
    $done = $true
  }
}catch {
  Say ('BLOQUEADO: '+$_.Exception.Message)
  if($serviceStopped){
    try {
      # Rollback SOLO CODIGO bajo parada, sin tocar DB ni .env.
      $svc = Get-Service 'SmartInventoryV2'
      if($svc.Status.ToString() -ne 'Stopped'){
        Stop-Service -Name 'SmartInventoryV2' -ErrorAction Stop
        WaitSvc 'Stopped' 45
      }
      if($changedCode){
        Demand ((CurrentSha) -eq $target) 'Rollback manual requerido: SHA ya no coincide'
        Demand ([string]::IsNullOrWhiteSpace((TrackedDirty))) 'Rollback manual requerido: cambios nuevos en disco'
        [void](GitChecked @('reset','--hard',$base))
        Say 'Codigo previo restaurado de forma local; datos/DB intactos.'
      }
      Start-Service -Name 'SmartInventoryV2' -ErrorAction Stop
      WaitSvc 'Running' 45
      ApiReady 90
      Say 'RECUPERACION_CODIGO_OK'
    }catch{
      Say ('ALERTA: requiere recuperacion manual, sin borrar datos: '+$_.Exception.Message)
    }
  }
}finally{
  Say ('Reporte: '+$logFile)
  [IO.File]::WriteAllLines($logFile,$log,[Text.Encoding]::UTF8)
}
if(-not $done){exit 1}
