[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $repoRoot
. "$PSScriptRoot\runtime.ps1"
if ((Get-CpmsDatabaseRuntime -RepoRoot $repoRoot) -ne 'DOCKER') {
  throw 'This rehearsal requires local Docker. EXTERNAL must use a separately approved isolated target.'
}
Confirm-CpmsDockerAvailable
# Harness creates uniquely named synthetic databases; never migrates/resets the configured CPMS database.
pnpm exec tsx --tsconfig apps/api/tsconfig.json apps/api/test/material-sharing.integration.ts
Assert-CpmsNativeSuccess -Operation 'Material sharing migration, restore and authenticated/anonymous integration rehearsal'
