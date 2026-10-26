# Ejecuta el precheck real con comandos de infraestructura simulados.
# No conecta con HP, GitHub, PostgreSQL ni impresoras.
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$fixtureBase='cfc1fe1fa9429c778a1028fff154a1770a0f930d'
$fixtureTarget='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
$fixtureChanges=@('.github/workflows/v2-tests.yml',
  'docs/VIGIA/VIGIA_HP_MONITOR_TOUCH_UNITS_SAFE.ps1',
  'docs/VIGIA/tests/monitorTouchPrecheck.Tests.ps1',
  'v2/css/monitor-pilot.css','v2/scripts/monitorPilotBrowserSmoke.mjs',
  'v2/src/ui/monitorNormalMirrorUi.js','v2/src/ui/monitorReviewPilotUi.js',
  'v2/sw.js','v2/test/monitorPrintFlow.test.js','v2/test/monitorReviewWeeks.test.js')
$fixtureScript=Join-Path $PSScriptRoot '..\VIGIA_HP_MONITOR_TOUCH_UNITS_SAFE.ps1'
function git.exe {
  $gitArgs=@($args)
  $global:LASTEXITCODE=0
  switch($gitArgs[2]){
    'rev-parse' {
      if($gitArgs[3] -eq 'HEAD'){$fixtureBase}
      elseif($gitArgs[3] -eq 'FETCH_HEAD'){$fixtureTarget}
      else{throw 'Unexpected rev-parse'}
    }
    'diff' { $fixtureChanges -join "`r`n" }
    'status' {}
    'fetch' {}
    'merge-base' {}
    default {throw ('Unexpected Git command: '+($gitArgs -join ' '))}
  }
}
function Test-Path {return $true}
function Get-Service {return [pscustomobject]@{Status='Running'}}
function Invoke-RestMethod {return [pscustomobject]@{ok=$true}}
function New-Item {throw 'Precheck attempted to write files'}
function Copy-Item {throw 'Precheck attempted to copy files'}
function Invoke-WebRequest {throw 'Precheck attempted a deploy-only request'}
$output=@(& $fixtureScript -TargetSha $fixtureTarget 6>&1)
if(($output -join "`n") -notmatch 'MONITOR_TOUCH_PRECHECK_PASS'){
  throw 'Real precheck did not accept the approved CRLF diff'
}
Write-Host 'VIGIA_MONITOR_TOUCH_CRLF_PRECHECK_PASS'
$fixtureChanges+= 'v2/server/src/app.js'
$blocked=$false
try{& $fixtureScript -TargetSha $fixtureTarget 6>&1 | Out-Null}
catch{
  if($_.Exception.Message -like 'Archivo fuera del alcance: v2/server/src/app.js'){$blocked=$true}
  else{throw}
}
if(-not $blocked){throw 'Precheck accepted a server change'}
Write-Host 'VIGIA_MONITOR_TOUCH_SERVER_CHANGE_BLOCKED_PASS'
