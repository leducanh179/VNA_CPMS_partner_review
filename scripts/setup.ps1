[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $repoRoot

$missingCommands = @(
  foreach ($commandName in @('node', 'pnpm')) {
    if (-not (Get-Command $commandName -ErrorAction SilentlyContinue)) {
      $commandName
    }
  }
)
if ($missingCommands.Count -gt 0) {
  $missingList = $missingCommands -join ', '
  throw "Missing required command(s): $missingList. Install prerequisites manually as documented in README.md, open a new PowerShell window, and retry. This script does not install operating-system software."
}

$nodeVersion = [System.Version](node -p "process.versions.node")
if ($nodeVersion -lt [System.Version]'22.12.0' -or $nodeVersion -ge [System.Version]'25.0.0') {
  throw "Unsupported Node.js version $nodeVersion. CPMS requires >=22.12 and <25; Node.js 24 LTS is recommended."
}

$pnpmVersion = [System.Version](pnpm --version)
if ($pnpmVersion -lt [System.Version]'10.0.0' -or $pnpmVersion -ge [System.Version]'12.0.0') {
  throw "Unsupported pnpm version $pnpmVersion. CPMS requires pnpm >=10 and <12; version 11.19.0 is pinned."
}

if (-not (Test-Path -LiteralPath '.env')) {
  Copy-Item -LiteralPath '.env.example' -Destination '.env'
  Write-Host 'Created .env from safe development defaults.' -ForegroundColor Green
} else {
  Write-Host 'Keeping existing .env unchanged.' -ForegroundColor Yellow
}

. "$PSScriptRoot\runtime.ps1"
$databaseRuntime = Get-CpmsDatabaseRuntime -RepoRoot $repoRoot
if ($databaseRuntime -eq 'DOCKER') {
  Confirm-CpmsDockerAvailable
}

pnpm install --frozen-lockfile
Assert-CpmsNativeSuccess -Operation 'Frozen dependency installation'

if ($databaseRuntime -eq 'DOCKER') {
  docker compose up -d postgres
  Assert-CpmsNativeSuccess -Operation 'PostgreSQL container startup'

  $healthy = $false
  for ($attempt = 1; $attempt -le 30; $attempt++) {
    docker compose exec -T postgres sh -c 'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"' *> $null
    if ($LASTEXITCODE -eq 0) {
      $healthy = $true
      break
    }
    Start-Sleep -Seconds 2
  }
  if (-not $healthy) {
    throw 'PostgreSQL did not become ready within 60 seconds.'
  }
} else {
  Write-Host 'DB_RUNTIME=EXTERNAL: using the PostgreSQL server configured by DATABASE_URL.' -ForegroundColor Cyan
}

pnpm db:generate
Assert-CpmsNativeSuccess -Operation 'Prisma client generation'
pnpm db:migrate:deploy
Assert-CpmsNativeSuccess -Operation 'Database migration deployment'
pnpm db:seed
Assert-CpmsNativeSuccess -Operation 'Database seed'
& "$PSScriptRoot\verify.ps1"

Write-Host ''
Write-Host 'CPMS setup completed. Run .\scripts\dev-start.ps1' -ForegroundColor Green
