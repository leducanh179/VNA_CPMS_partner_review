[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][ValidateSet('preview', 'apply')][string]$Mode,
  [Parameter(Mandatory = $true)][string]$Source,
  [Parameter(Mandatory = $true)][string]$Configuration
)
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $repoRoot
$privateRoot = Join-Path $repoRoot 'private-local\access-demo'
$acl = Get-Acl -LiteralPath $privateRoot
$currentSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
if (-not $acl.AreAccessRulesProtected) { throw 'Private directory must have restricted, non-inherited ACLs.' }
foreach ($rule in $acl.Access) {
  $sid = $rule.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value
  if ($rule.AccessControlType -eq 'Allow' -and $sid -notin @($currentSid, 'S-1-5-18')) { throw 'Unexpected identity can access the private output directory.' }
}
pnpm exec tsx --tsconfig apps/api/tsconfig.json apps/api/scripts/provision-personnel.ts $Mode $Source $Configuration
if ($LASTEXITCODE -ne 0) { throw 'Personnel provisioning did not complete. Stop before enabling authentication.' }
