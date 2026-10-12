[CmdletBinding()]
param(
  [string]$Name = "cpms-$(Get-Date -Format 'yyyyMMdd-HHmmss').dump"
)

$ErrorActionPreference = 'Stop'
if ([System.IO.Path]::GetFileName($Name) -ne $Name -or -not $Name.EndsWith('.dump')) {
  throw 'Name must be a plain filename ending in .dump.'
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$backupRoot = Join-Path $repoRoot 'backups'
$resolvedBackupRoot = [System.IO.Path]::GetFullPath($backupRoot)
Set-Location -LiteralPath $repoRoot
New-Item -ItemType Directory -Path $resolvedBackupRoot -Force | Out-Null

. "$PSScriptRoot\runtime.ps1"
$databaseRuntime = Get-CpmsDatabaseRuntime -RepoRoot $repoRoot
if ($databaseRuntime -ne 'DOCKER') {
  throw 'db-backup.ps1 supports DB_RUNTIME=DOCKER only. Use the external database provider backup workflow.'
}
Confirm-CpmsDockerAvailable

docker compose up -d postgres
Assert-CpmsNativeSuccess -Operation 'PostgreSQL container startup'
docker compose exec -T postgres sh -c 'pg_dump --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --format=custom --file "$1"' sh "/backups/$Name"
Assert-CpmsNativeSuccess -Operation 'PostgreSQL backup'

$backupPath = Join-Path $resolvedBackupRoot $Name
if (-not (Test-Path -LiteralPath $backupPath)) {
  throw "Backup command completed but file was not found at $backupPath"
}
Write-Host "Backup created: $backupPath" -ForegroundColor Green
