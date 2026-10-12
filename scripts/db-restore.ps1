[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$BackupName,
  [switch]$ConfirmRestore
)

$ErrorActionPreference = 'Stop'
if (-not $ConfirmRestore) {
  throw 'Restore replaces matching objects in the local CPMS database. Re-run with -ConfirmRestore.'
}
if ([System.IO.Path]::GetFileName($BackupName) -ne $BackupName -or -not $BackupName.EndsWith('.dump')) {
  throw 'BackupName must be a plain filename ending in .dump.'
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$backupRoot = [System.IO.Path]::GetFullPath((Join-Path $repoRoot 'backups'))
$backupPath = [System.IO.Path]::GetFullPath((Join-Path $backupRoot $BackupName))
if (-not $backupPath.StartsWith($backupRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw 'Backup path must remain inside the repository backups directory.'
}
if (-not (Test-Path -LiteralPath $backupPath)) {
  throw "Backup not found: $backupPath"
}

Set-Location -LiteralPath $repoRoot
. "$PSScriptRoot\runtime.ps1"
$databaseRuntime = Get-CpmsDatabaseRuntime -RepoRoot $repoRoot
if ($databaseRuntime -ne 'DOCKER') {
  throw 'db-restore.ps1 supports DB_RUNTIME=DOCKER only. Use an IT-approved external database restore workflow.'
}
Confirm-CpmsDockerAvailable

docker compose up -d postgres
Assert-CpmsNativeSuccess -Operation 'PostgreSQL container startup'
docker compose exec -T postgres sh -c 'pg_restore --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --clean --if-exists --no-owner --exit-on-error "$1"' sh "/backups/$BackupName"
Assert-CpmsNativeSuccess -Operation 'PostgreSQL restore'
Write-Host "Database restored from: $backupPath" -ForegroundColor Green
