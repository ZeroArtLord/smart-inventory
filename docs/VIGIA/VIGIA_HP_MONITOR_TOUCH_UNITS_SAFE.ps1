# VIGIA Monitor: unidades de un toque y sincronizacion del ciclo al imprimir.
# Cambio de cliente servido desde disco. Ejecutar en HP como administrador.
[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][ValidatePattern('^[a-fA-F0-9]{40}$')][string]$TargetSha,
  [switch]$Apply
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
$root='C:\SmartInventory\App'
$base='cfc1fe1fa9429c778a1028fff154a1770a0f930d'
$branch='feature/vigia-monitor-ciclos-preguntar-busqueda-20261025'
$runtime=@('v2/css/monitor-pilot.css','v2/src/ui/monitorReviewPilotUi.js',
  'v2/src/ui/monitorNormalMirrorUi.js','v2/sw.js')
$allowed=$runtime+@('v2/scripts/monitorPilotBrowserSmoke.mjs','v2/test/monitorPrintFlow.test.js','v2/test/monitorReviewWeeks.test.js',
  '.github/workflows/v2-tests.yml','docs/VIGIA/VIGIA_HP_MONITOR_TOUCH_UNITS_SAFE.ps1',
  'docs/VIGIA/tests/monitorTouchPrecheck.Tests.ps1')
$updated=$false
function Demand([bool]$ok,[string]$reason){if(-not $ok){throw $reason}}
function Git([string[]]$arguments){
  $previous=$ErrorActionPreference
  $ErrorActionPreference='Continue'
  try{$out=& git.exe -C $root @arguments 2>&1;$rc=$LASTEXITCODE}
  finally{$ErrorActionPreference=$previous}
  Demand ($rc -eq 0) ('Git fallo: '+($arguments -join ' '))
  return (($out -join [Environment]::NewLine).Trim())
}
function Ready {
  Demand ((Get-Service 'SmartInventoryV2').Status.ToString() -eq 'Running') 'SmartInventoryV2 no esta Running'
  foreach($endpoint in @('health','ready')){
    $r=Invoke-RestMethod ('http://127.0.0.1:5190/'+$endpoint) -TimeoutSec 10
    Demand ($r.ok -eq $true) ('API no disponible: '+$endpoint)
  }
}
try{
  Demand (Test-Path -LiteralPath $root -PathType Container) 'App no encontrada'
  Ready
  Demand ((Git @('rev-parse','HEAD')) -ceq $base) 'HEAD no coincide con la version instalada verificada'
  Demand ([string]::IsNullOrWhiteSpace((Git @('status','--porcelain','--untracked-files=no')))) 'Git tiene cambios rastreados'
  Demand ([string]::IsNullOrWhiteSpace((Git (@('status','--porcelain','--untracked-files=all','--')+$runtime)))) 'Hay archivos locales en las rutas del cliente'
  [void](Git @('fetch','--quiet','--no-tags','origin',$branch))
  Demand ((Git @('rev-parse','FETCH_HEAD')) -ceq $TargetSha) 'TargetSha no coincide con la rama remota'
  & git.exe -C $root merge-base --is-ancestor $base $TargetSha
  Demand ($LASTEXITCODE -eq 0) 'El candidato no desciende de la version instalada'
  $changes=@((Git @('diff','--name-only',$base,$TargetSha)) -split "\r?\n" | Where-Object {$_})
  Demand ($changes.Count -gt 0) 'Candidato sin cambios'
  foreach($file in $changes){Demand ($allowed -contains $file) ('Archivo fuera del alcance: '+$file)}
  foreach($file in $runtime){Demand ($changes -contains $file) ('Falta archivo esperado: '+$file)}
  Write-Host ('MONITOR_TOUCH_PRECHECK_PASS | BASE='+$base+' | TARGET='+$TargetSha)
  Write-Host 'Alcance: interfaz y cache PWA. Sin migraciones, stock, .env ni reinicio de servicios.'
  if(-not $Apply){Write-Host 'PRECHECK: ejecutar con -Apply para instalar este candidato.';return}
  $backupRoot='F:\SmartInventoryBackups\VIGIA_MANUAL_PREDEPLOY'
  Demand (Test-Path -LiteralPath $backupRoot -PathType Container) 'No existe la ruta de respaldos manuales'
  $snapshot=Join-Path $backupRoot ('MONITOR_TOUCH_UI_'+(Get-Date -Format 'yyyyMMdd_HHmmss')+'_'+[guid]::NewGuid().ToString('N'))
  [void](New-Item -ItemType Directory -Path $snapshot)
  $receipt=@('BASE='+$base,'TARGET='+$TargetSha)
  foreach($file in $runtime){
    $source=Join-Path $root $file
    $destination=Join-Path $snapshot $file
    [void](New-Item -ItemType Directory -Force -Path (Split-Path $destination -Parent))
    Copy-Item -LiteralPath $source -Destination $destination -ErrorAction Stop
    $hash=(Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash
    Demand ($hash -ceq (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash) ('Snapshot no coincide: '+$file)
    $receipt+=($file+' SHA256='+$hash)
  }
  [IO.File]::WriteAllLines((Join-Path $snapshot 'RECEIPT.txt'),$receipt,[Text.Encoding]::UTF8)
  Write-Host ('SNAPSHOT_UI_OK | '+$snapshot)
  [void](Git @('merge','--ff-only','--no-stat',$TargetSha))
  $updated=$true
  Demand ((Git @('rev-parse','HEAD')) -ceq $TargetSha) 'HEAD no alcanzo el candidato'
  foreach($file in $runtime){
    Demand ((Git @('hash-object','--',$file)) -ceq (Git @('rev-parse',($TargetSha+':'+$file)))) ('Archivo instalado diferente: '+$file)
  }
  Ready
  $sw=Invoke-WebRequest 'http://127.0.0.1:5190/sw.js' -UseBasicParsing -Headers @{'Cache-Control'='no-cache'} -TimeoutSec 10
  Demand ($sw.Content -match 'smart-inventory-v2-shell-73-monitor-touch-units-1') 'El servidor no entrega el cache nuevo'
  Write-Host ('VIGIA_MONITOR_TOUCH_DEPLOY_PASS | '+$TargetSha)
  Write-Host 'Cerrar y abrir VIGIA para activar el cliente nuevo. Revisar unidades y Preguntar de una copia.'
}catch{
  Write-Host ('BLOQUEADO: '+$_.Exception.Message)
  if($updated){
    try{
      Demand ((Git @('rev-parse','HEAD')) -ceq $TargetSha) 'HEAD cambio; requiere revision manual'
      Demand ([string]::IsNullOrWhiteSpace((Git @('status','--porcelain','--untracked-files=no')))) 'Git modificado; requiere revision manual'
      [void](Git @('reset','--hard',$base))
      Ready
      Write-Host 'RECUPERACION_CLIENTE_OK'
    }catch{Write-Host ('RECUPERACION_MANUAL_REQUERIDA: '+$_.Exception.Message)}
  }
  throw
}
