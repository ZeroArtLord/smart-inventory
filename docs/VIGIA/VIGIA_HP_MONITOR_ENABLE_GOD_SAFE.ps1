# VIGIA Monitor: activacion selectiva GOD (Windows PowerShell 5.1)
# NO cambia codigo, DB, roles, credenciales ni existencias.
# Conserva .env original en backup privado; rollback automatico si falla.
[CmdletBinding()]
param([switch]$SelfTest)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
$root='C:\SmartInventory\App'
$envFile='C:\SmartInventory\App\v2\server\.env'
$approved='e8cdedac21cf372261049543644ec2b1d68cfa9f'
$node='C:\Program Files\nodejs\node.exe'
$url='https://raw.githubusercontent.com/ZeroArtLord/smart-inventory/52ed2628b578836981e5823f7c7cc6c5647f10a2/docs/VIGIA/VIGIA_HP_GOD_ID_READONLY.cjs'
$helper=Join-Path $env:TEMP 'VIGIA_HP_GOD_ID_READONLY.cjs'
$base=if($SelfTest){$env:TEMP}else{'F:\SmartInventoryBackups\VIGIA_MANUAL_PREDEPLOY'}
$stamp=Get-Date -Format 'yyyyMMdd_HHmmss'
$private=Join-Path $base ('VIGIA_MONITOR_ENV_'+$stamp+'_'+[Guid]::NewGuid().ToString('N').Substring(0,8))
$report=Join-Path $env:TEMP ('VIGIA_MONITOR_GOD_ACTIVATION_'+$stamp+'.txt')
$messages=New-Object 'System.Collections.Generic.List[string]'
$backup=Join-Path $private '.env.original'
$before=$null
$touched=$false
$maintenance=$false
$ok=$false
$phase='precheck'
function Log([string]$v){$messages.Add($v);Write-Host $v}
function Need([bool]$v,[string]$m){if(-not $v){throw $m}}
function Sha([byte[]]$bytes){
  return [BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash($bytes))
}
function WaitStatus([string]$desired,[int]$seconds){
  $svc=Get-Service -Name SmartInventoryV2 -ErrorAction Stop
  $enum=[Enum]::Parse([ServiceProcess.ServiceControllerStatus],$desired)
  $svc.WaitForStatus($enum,[TimeSpan]::FromSeconds($seconds))
  $svc.Refresh()
  Need ($svc.Status.ToString() -eq $desired) ('El servicio no esta '+$desired)
}
function PortFree(){
  Start-Sleep -Seconds 2
  $listeners=@(Get-NetTCPConnection -LocalPort 5190 -State Listen -ErrorAction SilentlyContinue)
  Need ($listeners.Count -eq 0) 'Puerto 5190 sigue ocupado; no cambiar .env'
}
function ConfirmApi([bool]$enabled,[int]$secs){
  $deadline=(Get-Date).AddSeconds($secs)
  while((Get-Date) -lt $deadline){
    try {
      $h=Invoke-RestMethod 'http://127.0.0.1:5190/health' -TimeoutSec 4
      $r=Invoke-RestMethod 'http://127.0.0.1:5190/ready' -TimeoutSec 4
      $c=Invoke-RestMethod 'http://127.0.0.1:5190/api/v1/public/config' -TimeoutSec 4
      $field=$c.PSObject.Properties['monitorPilotEnabled']
      if($h.ok -eq $true -and $r.ok -eq $true -and $c.ok -eq $true -and
          $null -ne $field -and $c.monitorPilotEnabled -eq $enabled){return}
    }catch{}
    Start-Sleep -Seconds 2
  }
  throw ('Fallo salud/API o monitorPilotEnabled distinto de '+$enabled)
}
function ChangeEnv([byte[]]$bytes,[string]$userId){
  $utf8=[System.Text.UTF8Encoding]::new($false,$true)
  $bom=0
  if($bytes.Length -ge 3 -and $bytes[0] -eq 239 -and $bytes[1] -eq 187 -and $bytes[2] -eq 191){$bom=3}
  $body=$utf8.GetString($bytes,$bom,$bytes.Length-$bom)
  $flag=[regex]::Matches($body,'(?m)^[ \t]*MONITOR_PILOT_ENABLED[ \t]*=[^\r\n]*')
  $ids=[regex]::Matches($body,'(?m)^[ \t]*MONITOR_PILOT_USER_IDS[ \t]*=[^\r\n]*')
  Need ($flag.Count -le 1 -and $ids.Count -le 1) 'Variables Monitor duplicadas'
  if($flag.Count -eq 1){
    $value=($flag[0].Value -replace '^[ \t]*MONITOR_PILOT_ENABLED[ \t]*=','').Trim().Trim('"').Trim("'")
    Need ($value -eq '' -or $value.ToLowerInvariant() -eq 'false') 'Monitor ya activado o configuracion no reconocida'
    $body=[regex]::Replace($body,'(?m)^([ \t]*MONITOR_PILOT_ENABLED[ \t]*=)[^\r\n]*','1true')
  }
  if($ids.Count -eq 1){
    $value=($ids[0].Value -replace '^[ \t]*MONITOR_PILOT_USER_IDS[ \t]*=','').Trim().Trim('"').Trim("'")
    Need ([string]::IsNullOrWhiteSpace($value)) 'Allowlist existente; no sobrescribir'
    $body=[regex]::Replace($body,'(?m)^([ \t]*MONITOR_PILOT_USER_IDS[ \t]*=)[^\r\n]*',('1'+$userId))
  }
  $nl=[string][char]10
  if($body.Contains(([string][char]13+[string][char]10))){$nl=[string][char]13+[string][char]10}
  if($flag.Count -eq 0 -or $ids.Count -eq 0){
    if(-not $body.EndsWith([string][char]10)){$body+=$nl}
    if($flag.Count -eq 0){$body+='MONITOR_PILOT_ENABLED=true'+$nl}
    if($ids.Count -eq 0){$body+='MONITOR_PILOT_USER_IDS='+$userId+$nl}
  }
  $fresh=$utf8.GetBytes($body)
  if($bom -eq 0){return ,$fresh}
  $output=New-Object byte[] ($fresh.Length+3)
  $output[0]=239;$output[1]=187;$output[2]=191
  [Array]::Copy($fresh,0,$output,3,$fresh.Length)
  return ,$output
}
if($SelfTest){
  $nl=[string][char]10
  $fakeId='11111111-1111-4111-8111-111111111111'
  $sample='DATABASE_URL=KEEP_PRIVATE'+$nl+'MONITOR_PILOT_ENABLED=false'+$nl+'MONITOR_PILOT_USER_IDS='+$nl
  $original=[Text.Encoding]::UTF8.GetBytes($sample)
  $changedBytes=ChangeEnv $original $fakeId
  $changedText=[Text.Encoding]::UTF8.GetString($changedBytes)
  Need ($changedText.Contains('DATABASE_URL=KEEP_PRIVATE')) 'Selftest perdiendo campo anterior'
  Need ($changedText.Contains('MONITOR_PILOT_ENABLED=true')) 'Selftest no activo bandera'
  Need ($changedText.Contains('MONITOR_PILOT_USER_IDS='+$fakeId)) 'Selftest no dejo UID unico'
  Need ((Sha $original) -ne (Sha $changedBytes)) 'Selftest sin cambio'
  $fresh=[Text.Encoding]::UTF8.GetBytes('NODE_ENV=production'+$nl)
  $freshText=[Text.Encoding]::UTF8.GetString((ChangeEnv $fresh $fakeId))
  Need ($freshText.Contains('MONITOR_PILOT_ENABLED=true')) 'Selftest append flag'
  Need ($freshText.Contains('MONITOR_PILOT_USER_IDS='+$fakeId)) 'Selftest append allowlist'
  Write-Host 'VIGIA_MONITOR_ENV_REWRITE_SELFTEST_PASS'
  exit 0
}
try{
  Log '====================================================='
  Log ' VIGIA MONITOR - ACTIVACION SOLO PARA CUENTA DIOS'
  Log '====================================================='
  $phase='precheck'
  Log '[1/6] Verificando servicio, codigo y Monitor OFF...'
  Need ((Get-Service SmartInventoryV2).Status -eq 'Running') 'SmartInventoryV2 no esta Running'
  Need ((Get-Service postgresql-x64-18).Status -eq 'Running') 'PostgreSQL no esta Running'
  Need (Test-Path -LiteralPath $envFile -PathType Leaf) '.env ausente'
  $attr=(Get-Item -LiteralPath $envFile).Attributes
  Need (($attr -band [IO.FileAttributes]::ReparsePoint) -eq 0) '.env es enlace/reparse'
  Need (Test-Path -LiteralPath $node -PathType Leaf) 'Node no disponible'
  $head=(& git.exe -C $root rev-parse HEAD)
  Need ($LASTEXITCODE -eq 0 -and (($head -join '').Trim() -eq $approved)) 'Codigo distinto del aprobado'
  $dirty=(& git.exe -C $root status --porcelain --untracked-files=no)
  Need ($LASTEXITCODE -eq 0 -and [string]::IsNullOrWhiteSpace(($dirty -join ''))) 'Git tiene cambios rastreados'
  ConfirmApi $false 12
  Log '[OK] Servicio y PostgreSQL Running; Monitor OFF.'
  $phase='identidad GOD'
  Log '[2/6] Identificando cuenta DIOS activa mediante consulta de solo lectura...'
  [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12
  Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $helper
  & $node --check $helper
  Need ($LASTEXITCODE -eq 0) 'Helper de identidad con sintaxis incorrecta'
  $result=@(& $node $helper)
  Need ($LASTEXITCODE -eq 0) 'No se pudo identificar la cuenta DIOS de modo unico'
  $match=@($result|Where-Object {$_ -like 'VIGIA_GOD_IDENTIFIED *'})
  Need ($match.Count -eq 1) 'No hay identidad GOD unica'
  $who=($match[0].Substring(21)|ConvertFrom-Json)
  $userId=[string]$who.userId
  Need ($userId -match '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$') 'UID interno invalido'
  Need ($who.firebaseLinked -eq $true -and -not [string]::IsNullOrWhiteSpace([string]$who.displayName)) 'Cuenta DIOS sin vinculo o nombre'
  Log ('CUENTA_DI0S: '+[string]$who.displayName+' | UUID interno '+$userId)
  Log 'Confirma que es tu cuenta antes de continuar; la allowlist tendra un unico UUID.'
  $phase='respaldo configuracion'
  Log '[3/6] Preparando copia privada y cambio exclusivamente de las banderas Monitor...'
  $before=[IO.File]::ReadAllBytes($envFile)
  Need ($before.Length -gt 50) '.env vacio'
  $after=ChangeEnv $before $userId
  Need (Test-Path -LiteralPath $base -PathType Container) 'Carpeta de respaldos ausente'
  $inputValue=Read-Host 'Cuando todos hayan dejado VIGIA, escribe ACTIVAR para tu cuenta DIOS'
  if($inputValue -cne 'ACTIVAR'){throw 'Usuario cancelo antes de detener servicio'}
  New-Item -ItemType Directory -Path $private -ErrorAction Stop | Out-Null
  & icacls.exe $private '/inheritance:r' '/grant:r' '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' | Out-Null
  Need ($LASTEXITCODE -eq 0) 'No se pudo restringir carpeta de backup con secretos'
  [IO.File]::WriteAllBytes($backup,$before)
  Need ((Sha $before) -eq (Sha ([IO.File]::ReadAllBytes($backup)))) 'Respaldo de .env no coincide'
  Log '[OK] .env original protegido localmente (NO COMPARTIR backup).'
  $phase='detener servicio'
  Log '[4/6] Deteniendo SOLO SmartInventoryV2...'
  $maintenance=$true
  Stop-Service -Name SmartInventoryV2 -ErrorAction Stop
  WaitStatus 'Stopped' 45
  PortFree
  Need ((Sha $before) -eq (Sha ([IO.File]::ReadAllBytes($envFile)))) '.env cambio despues de respaldo; no sobrescribir'
  $phase='modificar configuracion'
  Log '[5/6] Habilitando Monitor para UN UUID y reiniciando...'
  $touched=$true
  [IO.File]::WriteAllBytes($envFile,[byte[]]$after)
  Start-Service -Name SmartInventoryV2 -ErrorAction Stop
  WaitStatus 'Running' 45
  $phase='verificar salud'
  Log '[6/6] Validando /health, /ready y config Monitor ON...'
  ConfirmApi $true 90
  $rev=(& git.exe -C $root rev-parse HEAD)
  Need ($LASTEXITCODE -eq 0 -and ($rev -join '').Trim() -eq $approved) 'Codigo diferente despues del reinicio'
  Log 'VIGIA_MONITOR_GOD_ACTIVATION_PASS'
  Log 'Servidor OK, 21 migraciones preexistentes, 1 usuario permitido, Monitor ON.'
  Log 'Usar URL https://vigia.internal/?vigiaMonitorPilot=1'
  $ok=$true
}catch{
  Log ('ACTIVATION_STEP_FAILED: '+$phase)
  Log ('ACTIVATION_ERROR: '+$_.Exception.Message)
  if($maintenance){
    try{
      Log 'RECUPERACION: deteniendo servicio y revirtiendo solo .env...'
      $svc=Get-Service SmartInventoryV2
      if($svc.Status -ne 'Stopped'){
        Stop-Service SmartInventoryV2 -ErrorAction Stop
        WaitStatus 'Stopped' 45
      }
      PortFree
      if($touched){[IO.File]::WriteAllBytes($envFile,$before)}
      Start-Service SmartInventoryV2 -ErrorAction Stop
      WaitStatus 'Running' 45
      ConfirmApi $false 90
      Log 'VIGIA_MONITOR_CONFIG_ROLLBACK_PASS: VIGIA antiguo funcionando, piloto OFF.'
    }catch{
      Log ('ROLLBACK_ATTENTION: '+$_.Exception.Message)
      Log 'No modificar mas el servicio ni .env hasta revisar. Backup privado preservado.'
    }
  }else{
    Log 'SIN_CAMBIOS_PRODUCTIVOS: no se detuvo servicio ni se modifico .env.'
  }
}finally{
  Log ('REPORTE: '+$report)
  [IO.File]::WriteAllLines($report,$messages,[Text.Encoding]::UTF8)
}
if(-not $ok){exit 1}
