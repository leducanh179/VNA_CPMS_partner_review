[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $repoRoot
. "$PSScriptRoot\runtime.ps1"
if ((Get-CpmsDatabaseRuntime -RepoRoot $repoRoot) -ne 'DOCKER') {
  throw 'This local rehearsal requires the approved Docker database. EXTERNAL needs its own approved isolated test target.'
}
Confirm-CpmsDockerAvailable
# The test harness creates a new, uniquely named database. It never resets/drops an existing database.
pnpm exec tsx --tsconfig apps/api/tsconfig.json apps/api/test/access-identity.integration.ts
Assert-CpmsNativeSuccess -Operation 'PostgreSQL identity migration and security integration tests'
