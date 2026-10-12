[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $repoRoot

if (-not (Test-Path -LiteralPath '.env')) {
  throw 'Missing .env. Run .\scripts\setup.ps1 first.'
}

. "$PSScriptRoot\runtime.ps1"
$databaseRuntime = Get-CpmsDatabaseRuntime -RepoRoot $repoRoot
if ($databaseRuntime -eq 'DOCKER') {
  Confirm-CpmsDockerAvailable
  docker compose up -d postgres
  Assert-CpmsNativeSuccess -Operation 'PostgreSQL container startup'
  Write-Host 'Waiting for local PostgreSQL readiness.' -ForegroundColor Cyan
  $databaseReady = $false
  for ($attempt = 1; $attempt -le 20; $attempt++) {
    docker compose exec -T postgres sh -c 'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"' *> $null
    if ($LASTEXITCODE -eq 0) {
      $databaseReady = $true
      break
    }
    Start-Sleep -Seconds 1
  }
  if (-not $databaseReady) {
    throw 'PostgreSQL did not become ready within 20 seconds.'
  }
  Write-Host 'Local PostgreSQL is ready.' -ForegroundColor Green
} else {
  Write-Host 'Using external PostgreSQL from DATABASE_URL; no local container will be started.' -ForegroundColor Cyan
}

Write-Host 'Web and API will run directly with pnpm.' -ForegroundColor Cyan
Write-Host 'Press Ctrl+C to stop web/API, then run .\scripts\dev-stop.ps1.' -ForegroundColor Yellow
pnpm dev
