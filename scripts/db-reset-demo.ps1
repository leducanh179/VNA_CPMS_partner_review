[CmdletBinding()]
param(
  [switch]$ConfirmReset
)

$ErrorActionPreference = 'Stop'
if (-not $ConfirmReset) {
  throw 'This replaces all local CPMS database data. Re-run with -ConfirmReset.'
}

$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $repoRoot
. "$PSScriptRoot\runtime.ps1"
$databaseRuntime = Get-CpmsDatabaseRuntime -RepoRoot $repoRoot
if ($databaseRuntime -ne 'DOCKER') {
  throw 'Refusing reset: db-reset-demo.ps1 is restricted to DB_RUNTIME=DOCKER. External databases require an IT-approved reset workflow.'
}
Confirm-CpmsDockerAvailable

$expectedCompose = Join-Path $repoRoot 'compose.yaml'
if (-not (Test-Path -LiteralPath $expectedCompose)) {
  throw "Refusing reset: expected compose file not found at $expectedCompose"
}

docker compose up -d postgres
Assert-CpmsNativeSuccess -Operation 'PostgreSQL container startup'
pnpm db:migrate:reset
Assert-CpmsNativeSuccess -Operation 'Demo database reset'
Write-Host 'Local CPMS database reset and demo seed restored.' -ForegroundColor Green
