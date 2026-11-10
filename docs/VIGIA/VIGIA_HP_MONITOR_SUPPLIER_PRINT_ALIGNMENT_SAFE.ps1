# VIGIA Monitor: impresion de proveedores igual a Finalizar pedidos.
# Admite despliegue acumulado desde el HP anterior. Sin migraciones.
[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][ValidatePattern('^[a-fA-F0-9]{40}$')][string]$TargetSha,
  [switch]$Apply
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
$root='C:\SmartInventory\App'
$bases=@('43da1c7577d4bd10f079cb747d0453f8c80b6fce',
  '05d44a6e0606ae6a4974a8ff0af229963d5b3b26',
  '14d2d08512c9926872abbafe31408038e4666ce3',
  '62c591b4190d58dbb3019e4cea13db0e7e4481f9')
$branch='fix/vigia-monitor-supplier-print-alignment-20261110'
$runtime=@('v2/server/src/printing/thermalEscPos.js',
  'v2/src/printing/thermalPrinterClient.js',
  'v2/src/replenishment/monitorNativeTicketAdapter.js',
  'v2/src/replenishment/monitorSupplierOrders.js',
  'v2/src/ui/monitorNormalMirrorUi.js',
  'v2/src/ui/monitorReviewPilotUi.js','v2/src/ui/monitorSupplierOrdersUi.js','v2/sw.js')
$required=@('v2/src/ui/monitorNormalMirrorUi.js','v2/sw.js')
$allowed=$runtime+@('v2/css/monitor-pilot.css','v2/src/ui/monitorSupplierOrdersUi.js',
  'v2/scripts/monitorPilotBrowserSmoke.mjs','v2/scripts/monitorSupplierBrowserSmoke.mjs',
  'v2/test/monitorPrintFlow.test.js','v2/test/monitorToNormalMirror.test.js',
  'v2/test/monitorSupplierOrders.test.js',
  '.github/workflows/v2-tests.yml','docs/VIGIA/VIGIA_HP_MONITOR_SCROLL_SAFE.ps1',
  'docs/VIGIA/VIGIA_HP_MONITOR_PRINT_SUPPLIERS_SAFE.ps1',
  'docs/VIGIA/VIGIA_HP_MONITOR_ASK_QUEUE_ORDERS_SAFE.ps1',
  'docs/VIGIA/VIGIA_HP_MONITOR_SUPPLIER_PRINT_ALIGNMENT_SAFE.ps1')
$base='';$updated=$false;$stopped=$false
function Demand([bool]$ok,[string]$reason){if(-not $ok){throw $reason}}
function Git([string[]]$arguments){
  $previous=$ErrorActionPreference;$ErrorActionPreference='Continue'
  try{$out=& git.exe -C $root @arguments 2>&1;$rc=$LASTEXITCODE}
  finally{$ErrorActionPreference=$previous}
  Demand ($rc -eq 0) ('Git fallo: '+($arguments -join ' '))
  return (($out -join [Environment]::NewLine).Trim())
}
function Ready([int]$seconds){
  $until=(Get-Date).AddSeconds($seconds)
  do{
    try{
      Demand ((Get-Service 'SmartInventoryV2').Status.ToString() -eq 'Running') 'Servicio detenido'
      $h=Invoke-RestMethod 'http://127.0.0.1:5190/health' -TimeoutSec 5
      $r=Invoke-RestMethod 'http://127.0.0.1:5190/ready' -TimeoutSec 5
      if($h.ok -eq $true -and $r.ok -eq $true){return}
    }catch{}
    Start-Sleep -Seconds 2
  }while((Get-Date) -lt $until)
  throw 'SmartInventoryV2 no responde /health y /ready'
}
function WaitService([string]$status){
  $service=Get-Service 'SmartInventoryV2'
  $desired=[Enum]::Parse([ServiceProcess.ServiceControllerStatus],$status)
  $service.WaitForStatus($desired,[TimeSpan]::FromSeconds(45))
  $service.Refresh()
  Demand ($service.Status.ToString() -eq $status) ('Servicio no alcanzo '+$status)
}
try{
  Demand (Test-Path -LiteralPath $root -PathType Container) 'App no encontrada'
  Ready 15
  $base=Git @('rev-parse','HEAD')
  Demand ($bases -contains $base) ('HEAD no es una base validada: '+$base)
  Demand ([string]::IsNullOrWhiteSpace((Git @('status','--porcelain','--untracked-files=no')))) 'Git tiene cambios rastreados'
  Demand ([string]::IsNullOrWhiteSpace((Git (@('status','--porcelain','--untracked-files=all','--')+$runtime)))) 'Hay archivos locales en rutas de impresion'
  [void](Git @('fetch','--quiet','--no-tags','origin',$branch))
  Demand ((Git @('rev-parse','FETCH_HEAD')) -ceq $TargetSha) 'TargetSha no coincide con la rama remota'
  & git.exe -C $root merge-base --is-ancestor $base $TargetSha
  Demand ($LASTEXITCODE -eq 0) 'El candidato no desciende de HEAD'
  $paths=@((Git @('diff','--name-only',$base,$TargetSha)) -split "\r?\n" | Where-Object {$_})
  Demand ($paths.Count -gt 0) 'Sin cambios candidatos'
  foreach($file in $paths){Demand ($allowed -contains $file) ('Archivo fuera del alcance: '+$file)}
  foreach($file in $required){Demand ($paths -contains $file) ('Falta archivo esperado: '+$file)}
  Write-Host ('VIGIA_SUPPLIER_PRINT_ALIGNMENT_PRECHECK_PASS | HP='+$base+' | CANDIDATO='+$TargetSha)
  Write-Host 'Sin migraciones; no se altera stock, .env ni datos de proveedores.'
  if(-not $Apply){Write-Host 'SOLO LECTURA: para instalar, ejecutar el mismo script con -Apply.';return}
  $backupRoot='F:\SmartInventoryBackups\VIGIA_MANUAL_PREDEPLOY'
  Demand (Test-Path -LiteralPath $backupRoot -PathType Container) 'No existe F: para el snapshot de codigo'
  $snapshot=Join-Path $backupRoot ('MONITOR_SUPPLIER_PRINT_ALIGNMENT_'+(Get-Date -Format 'yyyyMMdd_HHmmss')+'_'+[guid]::NewGuid().ToString('N'))
  [void](New-Item -ItemType Directory -Path $snapshot)
  $receipt=@('BASE='+$base,'TARGET='+$TargetSha)
  foreach($file in $runtime){
    $source=Join-Path $root $file;$destination=Join-Path $snapshot $file
    [void](New-Item -ItemType Directory -Force -Path (Split-Path $destination -Parent))
    Copy-Item -LiteralPath $source -Destination $destination -ErrorAction Stop
    $hash=(Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash
    Demand ($hash -ceq (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash) ('Snapshot no coincide: '+$file)
    $receipt+=($file+' SHA256='+$hash)
  }
  [IO.File]::WriteAllLines((Join-Path $snapshot 'RECEIPT.txt'),$receipt,[Text.Encoding]::UTF8)
  Write-Host ('SNAPSHOT_CODIGO_OK | '+$snapshot)
  $confirmation=Read-Host 'Verifica que todos los dispositivos Monitor indiquen SINCRONIZADO y escribe SINCRONIZADO'
  Demand ($confirmation -ceq 'SINCRONIZADO') 'No se confirmo sincronizacion'
  $confirmation=Read-Host 'Escribe DESPLEGAR para detener brevemente SmartInventoryV2'
  Demand ($confirmation -ceq 'DESPLEGAR') 'Despliegue cancelado'
  Stop-Service 'SmartInventoryV2' -ErrorAction Stop;$stopped=$true
  WaitService 'Stopped'
  Demand (@(Get-NetTCPConnection -LocalPort 5190 -State Listen -ErrorAction SilentlyContinue).Count -eq 0) 'Puerto 5190 sigue escuchando'
  [void](Git @('merge','--ff-only','--no-stat',$TargetSha));$updated=$true
  Demand ((Git @('rev-parse','HEAD')) -ceq $TargetSha) 'HEAD no alcanzo el candidato'
  foreach($file in $runtime){
    Demand ((Git @('hash-object','--',$file)) -ceq (Git @('rev-parse',($TargetSha+':'+$file)))) ('Archivo instalado diferente: '+$file)
  }
  Start-Service 'SmartInventoryV2' -ErrorAction Stop
  WaitService 'Running';Ready 90
  $sw=Invoke-WebRequest 'http://127.0.0.1:5190/sw.js' -UseBasicParsing -Headers @{'Cache-Control'='no-cache'} -TimeoutSec 10
  Demand ($sw.Content -match 'smart-inventory-v2-shell-78-monitor-supplier-print-alignment-1') 'El servidor no entrega el cache nuevo'
  Write-Host ('VIGIA_SUPPLIER_PRINT_ALIGNMENT_DEPLOY_PASS | '+$TargetSha)
  Write-Host 'Cierra y abre VIGIA; compara Mis listas con Finalizar pedidos antes de imprimir.'
}catch{
  Write-Host ('BLOQUEADO: '+$_.Exception.Message)
  if($stopped){
    try{
      if((Get-Service 'SmartInventoryV2').Status.ToString() -ne 'Stopped'){
        Stop-Service 'SmartInventoryV2' -ErrorAction Stop;WaitService 'Stopped'
      }
      if($updated){
        Demand ((Git @('rev-parse','HEAD')) -ceq $TargetSha) 'HEAD cambio; rollback manual requerido'
        Demand ([string]::IsNullOrWhiteSpace((Git @('status','--porcelain','--untracked-files=no')))) 'Git modificado; rollback manual requerido'
        [void](Git @('reset','--hard',$base))
      }
      Start-Service 'SmartInventoryV2' -ErrorAction Stop;WaitService 'Running';Ready 90
      Write-Host 'RECUPERACION_CODIGO_OK'
    }catch{Write-Host ('RECUPERACION_MANUAL_REQUERIDA: '+$_.Exception.Message)}
  }
  throw
}
