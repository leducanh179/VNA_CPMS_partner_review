[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $repoRoot
. "$PSScriptRoot/runtime.ps1"
if ((Get-CpmsDatabaseRuntime -RepoRoot $repoRoot) -ne 'DOCKER') { throw 'Use an explicitly approved isolated PostgreSQL test target for EXTERNAL runtime.' }
Confirm-CpmsDockerAvailable
pnpm exec tsx --tsconfig apps/api/tsconfig.json apps/api/test/booking.integration.ts
Assert-CpmsNativeSuccess -Operation 'Booking PostgreSQL and HTTP tests'
