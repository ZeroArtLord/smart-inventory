# VIGIA MONITOR - Descubrimiento seguro de PostgreSQL y respaldos (LECTURA).
# No ejecuta pg_dump, pg_restore sobre bases, migraciones, reinicios ni cambios.
# No imprime DATABASE_URL, claves ni contenido de .env. Solo un TXT en TEMP.
param(
  [string]$BackupDirectory='F:\SmartInventoryBackups',
  [string]$AppRoot='C:\SmartInventory\App',
  [string]$OutputDirectory="$env:TEMP\VIGIA_PRECHECK"
)
$ErrorActionPreference='Continue'
$ProgressPreference='SilentlyContinue'
$stamp=Get-Date -Format 'yyyyMMdd_HHmmss'
New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
$report=Join-Path $OutputDirectory ("VIGIA_PG_BACKUP_DISCOVERY_"+$stamp+".txt")
$entries=New-Object 'System.Collections.Generic.List[string]'
function Say([string]$text) { $entries.Add($text);Write-Host $text }
function Show-Exe([string]$dir){
  if(-not (Test-Path -LiteralPath $dir -PathType Container)){return}
  $dump=Join-Path $dir 'pg_dump.exe'
  $restore=Join-Path $dir 'pg_restore.exe'
  $psql=Join-Path $dir 'psql.exe'
  if(-not (Test-Path -LiteralPath $dump)){return}
  Say ("[ENCONTRADO] PostgreSQL bin: {0}" -f $dir)
  foreach($exe in @($dump,$restore,$psql)) {
    if(Test-Path -LiteralPath $exe) {
      try {
        $v=& $exe --version 2>$null
        Say ("  {0}: {1}" -f (Split-Path $exe -Leaf), ($v -join ' '))
      } catch {
        Say ("  {0}: existe, no se pudo consultar version" -f (Split-Path $exe -Leaf))
      }
    }else{
      Say ("  [FALTA] {0}" -f (Split-Path $exe -Leaf))
    }
  }
}
Say "=============================================================="
Say " VIGIA - RESPALDOS Y HERRAMIENTAS HP (SOLO LECTURA)"
Say (" Fecha: {0}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'))
Say " Clave de continuidad: VIGIA-FARO-1011"
Say "=============================================================="
Say ""
Say "1) REVISION DE VERSION ACTUAL"
if(Test-Path -LiteralPath (Join-Path $AppRoot '.git')){
  $git=Get-Command git -ErrorAction SilentlyContinue
  if($git){
    $sha=& git -C $AppRoot rev-parse HEAD 2>$null
    Say ("Git HEAD: {0}" -f (($sha -join ' ').Trim()))
    $dirty=@(& git -C $AppRoot status --porcelain --untracked-files=no 2>$null | Where-Object {$_})
    Say ("Archivos rastreados modificados localmente: {0}" -f $dirty.Count)
    if($dirty.Count -gt 0){Say "[ATENCION] No hacer git reset ni git pull automatico sin revisar cambios."}
  }
}else{ Say "[NOTA] No se encontraron metadatos git en la ruta indicada." }
Say ""
Say "2) UBICACION DE POSTGRESQL (SIN LEER LA BASE)"
$dirs=New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
foreach($cmd in @('pg_dump','pg_restore','psql')){
  $found=Get-Command $cmd -ErrorAction SilentlyContinue
  if($found){[void]$dirs.Add((Split-Path $found.Source -Parent))}
}
foreach($base in @(
  "$env:ProgramFiles\PostgreSQL",
  "$([Environment]::GetFolderPath('ProgramFilesX86'))\PostgreSQL",
  'C:\PostgreSQL','D:\PostgreSQL','F:\PostgreSQL',
  'D:\Program Files\PostgreSQL','F:\Program Files\PostgreSQL'
)){
  if(Test-Path -LiteralPath $base -PathType Container){
    Get-ChildItem -LiteralPath $base -Directory -ErrorAction SilentlyContinue |
      ForEach-Object {[void]$dirs.Add((Join-Path $_.FullName 'bin'))}
  }
}
foreach($reg in @('HKLM:\SOFTWARE\PostgreSQL\Installations','HKLM:\SOFTWARE\WOW6432Node\PostgreSQL\Installations')){
  if(Test-Path $reg){
    Get-ChildItem $reg -ErrorAction SilentlyContinue | ForEach-Object {
      $props=Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue
      if($props.'Base Directory') {[void]$dirs.Add((Join-Path $props.'Base Directory' 'bin'))}
    }
  }
}
$foundAny=$false
foreach($dir in $dirs){
  if(Test-Path -LiteralPath (Join-Path $dir 'pg_dump.exe')){$foundAny=$true}
  Show-Exe $dir
}
if(-not $foundAny){Say "[PENDIENTE] No se encontro pg_dump.exe en rutas usuales."}
Say ""
Say "3) SERVICIOS POSTGRESQL"
Get-Service -Name 'postgresql*' -ErrorAction SilentlyContinue |
  ForEach-Object {Say ("  {0} | {1}" -f $_.Name,$_.Status)}
Say ""
Say "4) RESPALDOS EN F:"
Say ("Directorio configurado: {0}" -f $BackupDirectory)
if(-not (Test-Path -LiteralPath $BackupDirectory -PathType Container)){
 Say "[PENDIENTE] Directorio de respaldos no accesible con este usuario."
}else{
 try{
  $drive=Get-PSDrive -Name 'F' -ErrorAction SilentlyContinue
  if($drive){Say ("Unidad F: libre: {0:N2} GB" -f ($drive.Free/1GB))}
  $backups=@(Get-ChildItem -LiteralPath $BackupDirectory -File -Recurse -Depth 1 -ErrorAction SilentlyContinue |
    Where-Object { $_.Extension -in @('.dump','.backup','.bak','.sql') } |
    Sort-Object LastWriteTime -Descending)
  Say ("Archivos candidatos (carpeta y un nivel): {0}" -f $backups.Count)
  foreach($b in ($backups | Select-Object -First 12)){
    Say ("  {0} | {1:N2} MB | {2}" -f $b.FullName,($b.Length/1MB),$b.LastWriteTime.ToString('yyyy-MM-dd HH:mm:ss'))
  }
  if($backups.Count -eq 0){Say "[PENDIENTE] No se encontraron dumps con extensiones conocidas."}
  if($backups.Count -gt 0){Say "[NO VERIFICADO] La presencia de un archivo NO demuestra que sea restaurable."}
 } catch {Say ("[PENDIENTE] No fue posible listar respaldos: {0}" -f $_.Exception.Message)}
}
Say ""
Say "5) LIMITES Y PENDIENTES"
Say "[SEGURIDAD] No se ha ejecutado backup, restore, migrate, pull, reinicio o cambios de datos."
Say "[PENDIENTE] Crear copia nueva sin purgar backups existentes y verificar restaurabilidad."
Say "[PENDIENTE] Revisar eventos offline de cada telefono antes de actualizar la PWA."
[IO.File]::WriteAllLines($report,$entries,[Text.Encoding]::UTF8)
Write-Host ""
Write-Host ("INFORME GUARDADO: {0}" -f $report) -ForegroundColor Cyan
