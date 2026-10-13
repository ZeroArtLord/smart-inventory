# VIGIA Monitor - Fase A: preparacion de ventana en el HP REAL
# SAFE: NO detiene servicio, NO cambia worktree, NO migra base, NO activa Monitor.
# SO puede crear backup nuevo no destructivo y git fetch en .git; genera reporte en TEMP.
[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$root = 'C:\SmartInventory\App'
$server = Join-Path $root 'v2\server'
$node = 'C:\Program Files\nodejs\node.exe'
$old = '067eb9f94e1441836c67f26c97f0c34a5e4745b8'
$target = 'e8cdedac21cf372261049543644ec2b1d68cfa9f'
$branch = 'feature/vigia-monitor-review-v1'
$backupToolUrl = 'https://raw.githubusercontent.com/ZeroArtLord/smart-inventory/3d976b1137cc04c3db0202e115acba11a6b3a915/docs/VIGIA/VIGIA_HP_BACKUP_MANUAL_SAFE.cjs'
$preflightUrl = 'https://raw.githubusercontent.com/ZeroArtLord/smart-inventory/3a5bfc802d540ca8d36539b14e57633afd78d926/docs/VIGIA/VIGIA_HP_MONITOR_PREDEPLOY_READONLY.cjs'
$base = Join-Path $env:TEMP 'VIGIA_MONITOR_PREPARE'
New-Item -ItemType Directory -Path $base -Force | Out-Null
$stamp=Get-Date -Format 'yyyyMMdd_HHmmss'
$prepFile=Join-Path $base ('VIGIA_MONITOR_STAGE_'+$stamp+'.txt')
$log=New-Object 'System.Collections.Generic.List[string]'
function Say([string]$message) {$log.Add($message);Write-Host $message}
function Need([bool]$ok,[string]$message) {if(-not $ok){throw $message}}
function Git([string[]]$arguments){
    $v= & git -C $root @arguments 2>&1
    if($LASTEXITCODE -ne 0){throw ('Git fallo: '+($arguments -join ' '))}
    return (($v -join [Environment]::NewLine).Trim())
}
$passed=$false
try {
    Say '===================================================='
    Say ' VIGIA MONITOR HP - PREPARACION SIN CAMBIO PRODUCTIVO'
    Say '===================================================='
    Say ('Fecha local: '+(Get-Date -Format 'yyyy-MM-dd HH:mm:ss'))
    Say 'Autorizacion: ventana de mantenimiento solicitada por el usuario'
    Say '[1/7] Servicio y archivos...'
    Need (Test-Path -LiteralPath (Join-Path $server '.env') -PathType Leaf) 'Falta .env en servidor'
    Need (Test-Path -LiteralPath $node -PathType Leaf) 'Node no encontrado'
    Need ([bool](Get-Command git -ErrorAction SilentlyContinue)) 'Git no encontrado'
    $svc=Get-Service -Name 'SmartInventoryV2' -ErrorAction Stop
    Need ($svc.Status -eq 'Running') 'SmartInventoryV2 no esta ejecutandose'
    $pg=Get-Service -Name 'postgresql-x64-18' -ErrorAction Stop
    Need ($pg.Status -eq 'Running') 'PostgreSQL 18 no esta ejecutandose'
    $health=Invoke-RestMethod 'http://127.0.0.1:5190/health' -TimeoutSec 8
    $ready=Invoke-RestMethod 'http://127.0.0.1:5190/ready' -TimeoutSec 8
    Need ($health.ok -eq $true -and $ready.ok -eq $true) '/health o /ready no estan OK'
    Say '[OK] VIGIA y PostgreSQL en ejecucion; API lista.'
    Say '[2/7] Version local y modificaciones rastreadas...'
    $head=Git @('rev-parse','HEAD')
    Need ($head -eq $old) 'El HP no esta en el SHA esperado. No instalar.'
    $dirty=Git @('status','--porcelain','--untracked-files=no')
    Need ([string]::IsNullOrWhiteSpace($dirty)) 'Existen cambios locales rastreados. No instalar.'
    Say ('[OK] Git HEAD '+$head.Substring(0,12)+' | tracked clean')
    Say '[3/7] Descargando codigo aprobado solo a .git (SIN cambiar el runtime)...'
    [void](Git @('fetch','--no-tags','origin',$branch))
    $remote=Git @('rev-parse','FETCH_HEAD')
    [void](Git @('cat-file','-e',($target+'^{commit}')))
    & git -C $root merge-base --is-ancestor $old $target
    Need ($LASTEXITCODE -eq 0) 'El SHA del candidato NO desciende del actual'
    & git -C $root merge-base --is-ancestor $target $remote
    Need ($LASTEXITCODE -eq 0) 'El SHA aprobado ya no es antecesor del remoto'
    $deps=Git @('diff','--name-only',$old,$target,'--','v2/server/package.json','v2/server/package-lock.json')
    Need ([string]::IsNullOrWhiteSpace($deps)) 'Cambios en dependencias del servidor: analizar antes'
    Say ('[OK] SHA aprobado '+$target.Substring(0,12)+'; remoto '+$remote.Substring(0,12))
    Say '[4/7] Repitiendo preflight real de SOLO LECTURA...'
    [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12
    $pre=Join-Path $base 'VIGIA_HP_MONITOR_PREDEPLOY_READONLY.cjs'
    Invoke-WebRequest -UseBasicParsing -Uri $preflightUrl -OutFile $pre
    & $node --check $pre
    Need ($LASTEXITCODE -eq 0) 'Preflight JS no valido'
    & $node $pre
    Need ($LASTEXITCODE -eq 0) 'El estado real del HP no paso el preflight'
    Say '[OK] Preflight real sin cambios.'
    Say '[5/7] Preparando copia NUEVA sin purgar backups existentes...'
    $back=Join-Path $base 'VIGIA_HP_BACKUP_MANUAL_SAFE.cjs'
    Invoke-WebRequest -UseBasicParsing -Uri $backupToolUrl -OutFile $back
    & $node --check $back
    Need ($LASTEXITCODE -eq 0) 'Helper de backup JS no valido'
    & $node $back
    Need ($LASTEXITCODE -eq 0) 'Backup de PostgreSQL no completado/verificado'
    Say '[OK] Dump nuevo generado, TOC y lectura completa verificados.'
    Say '[6/7] Comprobacion final de servicio y Git...'
    Need ((Get-Service -Name 'SmartInventoryV2').Status -eq 'Running') 'Servicio no esta en ejecucion'
    $after=Git @('rev-parse','HEAD')
    Need ($after -eq $old) 'Git HEAD cambio inesperadamente'
    $changes=Git @('status','--porcelain','--untracked-files=no')
    Need ([string]::IsNullOrWhiteSpace($changes)) 'Cambios locales posteriores al preflight'
    $r=Invoke-RestMethod 'http://127.0.0.1:5190/ready' -TimeoutSec 8
    Need ($r.ok -eq $true) '/ready dejo de estar OK'
    Say '[OK] El servicio sigue con codigo antiguo, sin cambios.'
    Say '[7/7] Cierre de preparacion...'
    Say ('CANDIDATO_FIJADO: '+$target)
    Say 'STAGE_PASS_SIN_PARAR_SERVICIO'
    Say 'SIGUIENTE: revisar reporte y ejecutar la migracion/despliegue bajo ventana de mantenimiento.'
    $passed=$true
}catch{
    Say ('STAGE_BLOCKED: '+$_.Exception.Message)
    Say 'NO detener SmartInventoryV2, NO migrar, NO instalar.'
}finally{
    Say ('Reporte: '+$prepFile)
    [IO.File]::WriteAllLines($prepFile,$log,[Text.Encoding]::UTF8)
}
if(-not $passed){exit 1}
