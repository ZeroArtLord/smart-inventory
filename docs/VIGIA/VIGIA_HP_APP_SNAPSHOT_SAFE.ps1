# VIGIA / ByteMind Solutions - respaldo de archivos en el HP.
# Copia fuentes productivas sin reiniciar servicios ni escribir en la aplicacion.
# NO /MIR, /MOVE, /PURGE, migraciones ni git pull.
[CmdletBinding()]
param(
    [string]$AppRoot = 'C:\SmartInventory\App',
    [string]$ServiceRoot = 'C:\SmartInventory\Service',
    [string]$BackupRoot = 'F:\SmartInventoryBackups\VIGIA_MANUAL_PREDEPLOY'
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
function Check-Hash([string]$src, [string]$dest) {
    if (-not (Test-Path -LiteralPath $src -PathType Leaf) -or
        -not (Test-Path -LiteralPath $dest -PathType Leaf)) {
        throw ('Archivo critico faltante: ' + (Split-Path $src -Leaf))
    }
    if ((Get-FileHash -LiteralPath $src -Algorithm SHA256).Hash -ne
        (Get-FileHash -LiteralPath $dest -Algorithm SHA256).Hash) {
        throw ('SHA256 diferente: ' + (Split-Path $src -Leaf))
    }
}
function Copy-Folder([string]$src, [string]$dest, [string]$log) {
    if (-not (Test-Path -LiteralPath $src -PathType Container)) {
        throw ('Carpeta no encontrada: ' + $src)
    }
    New-Item -ItemType Directory -Path $dest -Force | Out-Null
    $flags = @('/E','/COPY:DAT','/DCOPY:DAT','/XJ','/R:1','/W:1',
               '/NFL','/NDL','/NJH','/NJS','/NP',('/LOG:' + $log))
    & robocopy.exe $src $dest @flags | Out-Null
    $rc = $LASTEXITCODE
    if ($rc -ge 8) { throw ('Robocopy fallo, codigo ' + $rc + '. Revisar log restringido.') }
    Write-Host ('Robocopy OK: ' + $src + ', codigo ' + $rc)
}
$mustExist = @(
  (Join-Path $AppRoot 'v2\server\src\app.js'),
  (Join-Path $AppRoot 'v2\server\.env'),
  (Join-Path $AppRoot 'v2\sw.js'),
  (Join-Path $ServiceRoot 'SmartInventoryService.exe')
)
foreach ($file in $mustExist) {
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) {
        throw ('No se encontro archivo obligatorio: ' + $file)
    }
}
if (-not (Test-Path -LiteralPath $BackupRoot -PathType Container)) {
    throw 'No existe la carpeta de respaldos manuales. No crear snapshot.'
}
$stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
$unique = ([guid]::NewGuid().ToString('N')).Substring(0,8)
$dest = Join-Path $BackupRoot ('HP_APP_SNAPSHOT_' + $stamp + '_' + $unique)
New-Item -ItemType Directory -Path $dest -ErrorAction Stop | Out-Null
# Solo dentro de la carpeta nueva; NO cambia ACL de App ni Service.
& icacls.exe $dest '/inheritance:r' '/grant:r' '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Fallo al restringir el acceso: NO COPIAR SECRETOS.' }
try {
    Write-Host 'VIGIA: copia previa a actualizacion (SIN DETENER SERVICIO)'
    Write-Host '[1/3] Copiando carpeta App ...'
    Copy-Folder $AppRoot (Join-Path $dest 'App') (Join-Path $dest 'robocopy_app.log')
    Write-Host '[2/3] Copiando carpeta Service ...'
    Copy-Folder $ServiceRoot (Join-Path $dest 'Service') (Join-Path $dest 'robocopy_service.log')
    Write-Host '[3/3] Verificando hashes SHA256 ...'
    foreach ($relative in @('v2\server\src\app.js','v2\index.html','v2\sw.js','v2\server\.env')) {
        Check-Hash (Join-Path $AppRoot $relative) (Join-Path (Join-Path $dest 'App') $relative)
    }
    Check-Hash (Join-Path $ServiceRoot 'SmartInventoryService.exe') (Join-Path (Join-Path $dest 'Service') 'SmartInventoryService.exe')
    $head = '(no disponible)'
    if (Get-Command git -ErrorAction SilentlyContinue) {
        $gitHead = & git -C $AppRoot rev-parse HEAD 2>$null
        if ($LASTEXITCODE -eq 0) { $head = ($gitHead -join '').Trim() }
    }
    $receipt = Join-Path $dest 'VIGIA_SNAPSHOT_RECEIPT.txt'
    $lines = @(
      'VIGIA HP - APPLICATION/SERVICE SNAPSHOT',
      ('FECHA_LOCAL: ' + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')),
      ('GIT_HEAD: ' + $head),
      ('SNAPSHOT: ' + $dest),
      'HASH_CRITICOS: COINCIDEN (app.js, index.html, sw.js, .env, wrapper exe)',
      'POSTGRESQL: SIN CAMBIOS',
      'SERVICIO: NO DETENIDO NI REINICIADO',
      'RESPALDOS_PREVIOS: NO ELIMINADOS',
      'CONTENIDO: PRIVADO (NO SUBIR EL ZIP NI LA CARPETA)'
    )
    [IO.File]::WriteAllLines($receipt,$lines,[Text.Encoding]::UTF8)
    Write-Host 'SNAPSHOT_OK'
    Write-Host ('Git HEAD: ' + $head)
    Write-Host ('Carpeta: ' + $dest)
    Write-Host ('Comprobante: ' + $receipt)
    Write-Host 'La copia contiene secretos de .env; no la compartas.'
} catch {
    Write-Host 'SNAPSHOT_INCOMPLETO: NO ACTUALIZAR VIGIA.'
    Write-Host ('Detalle: ' + $_.Exception.Message)
    Write-Host ('Carpeta parcial preservada: ' + $dest)
    throw
}
