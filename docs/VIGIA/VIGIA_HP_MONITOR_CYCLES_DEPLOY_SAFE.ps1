# VIGÍA Monitor: actualización de ciclos/Preguntar/búsqueda con respaldo real.
# Ejecutar como administrador en el HP. Solo detiene SmartInventoryV2.
[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][ValidatePattern('^[a-fA-F0-9]{40}$')][string]$ExpectedBaseSha,
  [Parameter(Mandatory=$true)][ValidatePattern('^[a-fA-F0-9]{40}$')][string]$TargetSha,
  [switch]$Deploy
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
$root='C:\SmartInventory\App'
$server=Join-Path $root 'v2\server'
$branch='feature/vigia-monitor-ciclos-preguntar-busqueda-20261025'
$approvedBases=@(
  '2d17b0285e2cdbb482e1a1b9763f86389e60f428', # HP verificado: observaciones ya instaladas
  '05a88c9ea2d9a7804a953763a5b2f50b53675a98'  # PR 24: mismo codigo funcional
)
$backupRoot='F:\SmartInventoryBackups\VIGIA_MANUAL_PREDEPLOY'
$base=''
$codeUpdated=$false
$serviceStopped=$false
$tempScripts=New-Object 'System.Collections.Generic.List[string]'
function Demand([bool]$ok,[string]$reason){if(-not $ok){throw $reason}}
function Git([string[]]$arguments){
  $out=& git.exe -C $root @arguments 2>&1
  Demand ($LASTEXITCODE -eq 0) ('Git fallo: '+($arguments -join ' '))
  return (($out -join [Environment]::NewLine).Trim())
}
function ApiReady([int]$seconds){
  $until=(Get-Date).AddSeconds($seconds)
  while((Get-Date) -lt $until){
    try{
      $h=Invoke-RestMethod 'http://127.0.0.1:5190/health' -TimeoutSec 5
      $r=Invoke-RestMethod 'http://127.0.0.1:5190/ready' -TimeoutSec 5
      if($h.ok -eq $true -and $r.ok -eq $true){return}
    }catch{}
    Start-Sleep -Seconds 2
  }
  throw 'La API no recupero /health y /ready'
}
function WaitService([string]$status){
  $svc=Get-Service 'SmartInventoryV2' -ErrorAction Stop
  $svc.WaitForStatus([Enum]::Parse([ServiceProcess.ServiceControllerStatus],$status),[TimeSpan]::FromSeconds(50))
  $svc.Refresh()
  Demand ($svc.Status.ToString() -eq $status) ('SmartInventoryV2 no alcanzo '+$status)
}
function CandidateScript([string]$name){
  $rel='docs/VIGIA/'+$name
  $content=Git @('show',($TargetSha+':'+$rel))
  $dest=Join-Path $env:TEMP ('VIGIA_'+[guid]::NewGuid().ToString('N')+'_'+$name)
  # Windows PowerShell 5.1 UTF8 agrega BOM; Node no acepta BOM antes de #!.
  $encoding=if($name.EndsWith('.ps1',[StringComparison]::OrdinalIgnoreCase)){
    [Text.Encoding]::UTF8
  }else{[System.Text.UTF8Encoding]::new($false)}
  [IO.File]::WriteAllText($dest,$content+[Environment]::NewLine,$encoding)
  $tempScripts.Add($dest)
  return $dest
}
function NodeChecked([string]$script,[string]$passMarker){
  $previousErrorPreference=$ErrorActionPreference
  $ErrorActionPreference='Continue'
  try{
    $out=& node.exe $script 2>&1
    $rc=$LASTEXITCODE
  }finally{$ErrorActionPreference=$previousErrorPreference}
  foreach($line in $out){Write-Host $line}
  Demand ($rc -eq 0 -and (($out -join "`n") -match [regex]::Escape($passMarker))) ($passMarker+' no confirmado')
  return (($out -join "`n"))
}
try{
  Demand (Test-Path -LiteralPath $root -PathType Container) 'App no encontrada'
  Demand (Test-Path -LiteralPath $backupRoot -PathType Container) 'No existe F: de respaldos manuales'
  Demand ((Get-Service 'SmartInventoryV2').Status.ToString() -eq 'Running') 'VIGÍA no esta Running'
  Demand ((Get-Service 'postgresql-x64-18').Status.ToString() -eq 'Running') 'PostgreSQL 18 no esta Running'
  ApiReady 20
  $base=Git @('rev-parse','HEAD')
  Demand ($base -ceq $ExpectedBaseSha) ('SHA del HP inesperado: '+$base)
  Demand ($approvedBases -contains $base) 'SHA no incluido en las bases verificadas de Monitor'
  Demand ([string]::IsNullOrWhiteSpace((Git @('status','--porcelain','--untracked-files=no')))) 'Git tiene cambios rastreados'
  # migrate.js ejecuta todos los SQL numerados presentes en disco, incluidos no rastreados.
  Demand ([string]::IsNullOrWhiteSpace((Git @('status','--porcelain','--untracked-files=all','--','v2/server/migrations')))) 'Migraciones locales o no rastreadas: detener'
  [void](Git @('fetch','--quiet','--no-tags','origin',$branch))
  Demand ((Git @('rev-parse','FETCH_HEAD')) -ceq $TargetSha) 'La rama remota no coincide con TargetSha'
  & git.exe -C $root merge-base --is-ancestor $base $TargetSha
  Demand ($LASTEXITCODE -eq 0) 'El candidato no desciende del HP'
  $migrations=@(Git @('diff','--name-only',$base,$TargetSha,'--','v2/server/migrations') -split "`n" | Where-Object {$_})
  Demand ($migrations.Count -eq 1 -and $migrations[0] -eq 'v2/server/migrations/022_monitor_review_cycles_ask.sql') 'Migraciones inesperadas'
  Demand ([string]::IsNullOrWhiteSpace((Git @('diff','--name-only',$base,$TargetSha,'--','v2/server/package.json')))) 'Dependencias de servidor cambiaron'
  $pre=CandidateScript 'VIGIA_HP_MONITOR_CYCLES_PRECHECK_READONLY.cjs'
  [void](NodeChecked $pre 'VIGIA_MONITOR_CYCLES_PRECHECK_PASS')
  Write-Host ('PRECHECK_OK | HP='+$base+' | CANDIDATO='+$TargetSha)
  if(-not $Deploy){
    Write-Host 'SOLO LECTURA: no se hizo backup nuevo, migracion, reinicio ni cambio de codigo.'
    return
  }
  $answer=Read-Host 'Escribe SINCRONIZADO tras verificar colas Monitor de todos los dispositivos'
  Demand ($answer -ceq 'SINCRONIZADO') 'Colas no confirmadas'
  # El helper no purga respaldos anteriores; la restauración usa una base temporal.
  $backupHelper=CandidateScript 'VIGIA_HP_BACKUP_MANUAL_SAFE.cjs'
  $backupOutput=NodeChecked $backupHelper 'Backup manual completado y revisado'
  $match=[regex]::Match($backupOutput,'(?m)^Archivo:\s*(.+\.dump)\s*$')
  Demand ($match.Success) 'No se identifico el nuevo dump'
  $dump=$match.Groups[1].Value.Trim()
  Demand ($dump.StartsWith($backupRoot,[StringComparison]::OrdinalIgnoreCase)) 'Dump fuera de F: manual'
  $digest=(Get-FileHash -LiteralPath $dump -Algorithm SHA256).Hash.ToLowerInvariant()
  Demand ($digest -match '^[a-f0-9]{64}$' -and (Test-Path -LiteralPath ($dump+'.sha256.txt'))) 'Respaldo sin hash o comprobante'
  $snapshot=CandidateScript 'VIGIA_HP_APP_SNAPSHOT_SAFE.ps1'
  & $snapshot -BackupRoot $backupRoot
  Demand ($LASTEXITCODE -eq 0) 'Snapshot de App/Service fallo'
  $restore=CandidateScript 'VIGIA_HP_RESTORE_ADMIN_SAFE.cjs'
  $secure=Read-Host 'Clave postgres para restaurar en base TEMPORAL' -AsSecureString
  $ptr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try{
    $env:VIGIA_PG_ADMIN_PASSWORD=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
    $env:VIGIA_RESTORE_DUMP=$dump
    $env:VIGIA_RESTORE_EXPECTED_SHA=$digest
    [void](NodeChecked $restore 'VIGIA_RESTORE_ADMIN_PASS')
  }finally{
    Remove-Item Env:VIGIA_PG_ADMIN_PASSWORD -ErrorAction SilentlyContinue
    Remove-Item Env:VIGIA_RESTORE_DUMP -ErrorAction SilentlyContinue
    Remove-Item Env:VIGIA_RESTORE_EXPECTED_SHA -ErrorAction SilentlyContinue
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
  }
  $answer=Read-Host 'Respaldo y restauracion verificados. Escribe DESPLEGAR para detener solo SmartInventoryV2'
  Demand ($answer -ceq 'DESPLEGAR') 'Actualizacion cancelada'
  Stop-Service 'SmartInventoryV2' -ErrorAction Stop
  $serviceStopped=$true
  WaitService 'Stopped'
  Demand (@(Get-NetTCPConnection -LocalPort 5190 -State Listen -ErrorAction SilentlyContinue).Count -eq 0) 'Puerto 5190 aun escucha'
  [void](Git @('merge','--ff-only','--no-stat',$TargetSha))
  $codeUpdated=$true
  Demand ((Git @('rev-parse','HEAD')) -ceq $TargetSha) 'Git no alcanzo TargetSha'
  Demand ([string]::IsNullOrWhiteSpace((Git @('status','--porcelain','--untracked-files=all','--','v2/server/migrations')))) 'Migraciones en disco no coinciden con el candidato'
  Push-Location $server
  try{& node.exe scripts/migrate.js; Demand ($LASTEXITCODE -eq 0) 'Migracion 022 fallo'}
  finally{Pop-Location}
  Start-Service 'SmartInventoryV2' -ErrorAction Stop
  WaitService 'Running'
  ApiReady 90
  $post=CandidateScript 'VIGIA_HP_MONITOR_CYCLES_POSTCHECK_READONLY.cjs'
  [void](NodeChecked $post 'VIGIA_MONITOR_CYCLES_POSTCHECK_PASS')
  Write-Host ('VIGIA_MONITOR_CYCLES_DEPLOY_PASS | '+$TargetSha)
  Write-Host 'Verificar en DIOS semana 2026-10-19, 494 decisiones y ticket Preguntar de una copia.'
}catch{
  Write-Host ('BLOQUEADO: '+$_.Exception.Message)
  if($serviceStopped){
    try{
      if((Get-Service 'SmartInventoryV2').Status.ToString() -ne 'Stopped'){
        Stop-Service 'SmartInventoryV2' -ErrorAction Stop; WaitService 'Stopped'
      }
      if($codeUpdated){
        Demand ((Git @('rev-parse','HEAD')) -ceq $TargetSha) 'Rollback manual: HEAD cambió'
        Demand ([string]::IsNullOrWhiteSpace((Git @('status','--porcelain','--untracked-files=no')))) 'Rollback manual: Git modificado'
        [void](Git @('reset','--hard',$base))
      }
      Start-Service 'SmartInventoryV2' -ErrorAction Stop
      WaitService 'Running'; ApiReady 90
      Write-Host 'RECUPERACION_CODIGO_OK; DB 022 aditiva se conserva. No restaurar DB automaticamente.'
    }catch{Write-Host ('RECUPERACION_MANUAL_REQUERIDA: '+$_.Exception.Message)}
  }
  throw
}finally{
  foreach($script in $tempScripts){Remove-Item -LiteralPath $script -Force -ErrorAction SilentlyContinue}
}
