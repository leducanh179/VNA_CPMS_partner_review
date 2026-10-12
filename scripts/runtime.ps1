function Get-CpmsEnvironmentValue {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)]
    [string]$RepoRoot,
    [Parameter(Mandatory = $true)]
    [string]$Name,
    [string]$DefaultValue = ''
  )

  $environmentPath = Join-Path $RepoRoot '.env'
  if (-not (Test-Path -LiteralPath $environmentPath)) {
    return $DefaultValue
  }

  $pattern = '^\s*' + [System.Text.RegularExpressions.Regex]::Escape($Name) + '\s*='
  $line = Get-Content -LiteralPath $environmentPath |
    Where-Object { $_ -match $pattern } |
    Select-Object -Last 1

  if ($null -eq $line) {
    return $DefaultValue
  }

  $value = ($line -split '=', 2)[1].Trim()
  if ($value.Length -ge 2) {
    $isDoubleQuoted = $value.StartsWith('"') -and $value.EndsWith('"')
    $isSingleQuoted = $value.StartsWith("'") -and $value.EndsWith("'")
    if ($isDoubleQuoted -or $isSingleQuoted) {
      $value = $value.Substring(1, $value.Length - 2)
    }
  }
  return $value
}

function Assert-CpmsNativeSuccess {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)]
    [string]$Operation
  )

  if ($LASTEXITCODE -ne 0) {
    throw "$Operation failed with exit code $LASTEXITCODE."
  }
}

function Get-CpmsDatabaseRuntime {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)]
    [string]$RepoRoot
  )

  $runtime = (Get-CpmsEnvironmentValue -RepoRoot $RepoRoot -Name 'DB_RUNTIME' -DefaultValue 'DOCKER').ToUpperInvariant()
  if ($runtime -notin @('DOCKER', 'EXTERNAL')) {
    throw "Unsupported DB_RUNTIME '$runtime'. Use DOCKER or EXTERNAL."
  }
  return $runtime
}

function Confirm-CpmsDockerAvailable {
  [CmdletBinding()]
  param()

  if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw 'DB_RUNTIME=DOCKER requires a Docker-compatible CLI. Install and start an approved runtime, then retry.'
  }

  docker compose version *> $null
  if ($LASTEXITCODE -ne 0) {
    throw 'DB_RUNTIME=DOCKER requires Docker Compose v2 compatibility.'
  }

  docker info *> $null
  if ($LASTEXITCODE -ne 0) {
    throw 'Docker CLI is present but its daemon is unavailable. Start the approved container runtime, then retry.'
  }
}
