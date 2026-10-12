[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $repoRoot
. "$PSScriptRoot\runtime.ps1"

$scriptParseErrors = @()
Get-ChildItem -LiteralPath $PSScriptRoot -Filter '*.ps1' | ForEach-Object {
  $tokens = $null
  $errors = $null
  [System.Management.Automation.Language.Parser]::ParseFile($_.FullName, [ref]$tokens, [ref]$errors) | Out-Null
  if ($errors) {
    $scriptParseErrors += $errors
  }
}
if ($scriptParseErrors.Count -gt 0) {
  throw "PowerShell syntax validation failed: $($scriptParseErrors -join '; ')"
}

pnpm db:generate
Assert-CpmsNativeSuccess -Operation 'Prisma client generation'
pnpm lint
Assert-CpmsNativeSuccess -Operation 'Lint'
pnpm test
Assert-CpmsNativeSuccess -Operation 'Test'
pnpm build
Assert-CpmsNativeSuccess -Operation 'Build'
pnpm exec tsc -p apps/api/tsconfig.pilot-cli.json --noEmit
Assert-CpmsNativeSuccess -Operation 'Pilot administrator CLI typecheck'
pnpm db:validate
Assert-CpmsNativeSuccess -Operation 'Prisma schema validation'
Write-Host 'Verification passed: PowerShell syntax, Prisma generate/validate, lint, test, build, and pilot CLI typecheck. Deployment preflight is not part of this source-review copy.' -ForegroundColor Green
