[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $repoRoot

. "$PSScriptRoot\runtime.ps1"
$databaseRuntime = Get-CpmsDatabaseRuntime -RepoRoot $repoRoot
if ($databaseRuntime -eq 'DOCKER') {
  Confirm-CpmsDockerAvailable
  docker compose stop postgres
  Assert-CpmsNativeSuccess -Operation 'PostgreSQL container stop'
  Write-Host 'PostgreSQL stopped. The named data volume was preserved.' -ForegroundColor Green
} else {
  Write-Host 'DB_RUNTIME=EXTERNAL: no database service was stopped.' -ForegroundColor Green
}
