[CmdletBinding()]
param([switch]$LiveSmoke, [switch]$Serve)
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $repoRoot
. "$PSScriptRoot\runtime.ps1"
if ((Get-CpmsDatabaseRuntime -RepoRoot $repoRoot) -ne 'DOCKER') {
  throw 'Use a separately approved isolated EXTERNAL target; this harness requires local Docker.'
}
Confirm-CpmsDockerAvailable
$env:CPMS_AI_LIVE_SMOKE = if ($LiveSmoke) { 'true' } else { 'false' }
$env:CPMS_AI_QA_SERVE = if ($Serve) { 'true' } else { 'false' }
pnpm exec tsx --tsconfig apps/api/tsconfig.json apps/api/test/ai-lookup.integration.ts
Assert-CpmsNativeSuccess -Operation 'AI lookup synthetic integration'
