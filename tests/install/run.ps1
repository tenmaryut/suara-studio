# Tests scripts/install.ps1 against a fake release served over HTTP from the local disk.
# Usage: pwsh -NoProfile -File tests/install/run.ps1   (needs Python for the test server)
$ErrorActionPreference = 'Stop'

$root = Resolve-Path (Join-Path $PSScriptRoot '../..')
$installer = Join-Path $root 'scripts/install.ps1'
$pwsh = (Get-Process -Id $PID).Path
$work = Join-Path ([IO.Path]::GetTempPath()) ('suara-ps-test-' + [Guid]::NewGuid().ToString('N'))
$release = Join-Path $work 'release'
New-Item -ItemType Directory -Path $release -Force | Out-Null
$script:count = 0

function Pass([string] $Message) {
  $script:count++
  Write-Host "ok $($script:count) - $Message"
}

function Invoke-Installer([hashtable] $Environment, [switch] $ViaIex) {
  $saved = @{}
  foreach ($key in $Environment.Keys) {
    $saved[$key] = [Environment]::GetEnvironmentVariable($key)
    [Environment]::SetEnvironmentVariable($key, $Environment[$key])
  }
  try {
    if ($ViaIex) {
      $command = "Get-Content -Raw -LiteralPath '$installer' | Invoke-Expression"
      $output = & $pwsh -NoProfile -NonInteractive -Command $command 2>&1 | Out-String
    } else {
      $output = & $pwsh -NoProfile -NonInteractive -File $installer 2>&1 | Out-String
    }
    return [pscustomobject]@{ ExitCode = $LASTEXITCODE; Output = $output }
  } finally {
    foreach ($key in $saved.Keys) { [Environment]::SetEnvironmentVariable($key, $saved[$key]) }
  }
}

function Assert-Contains($Result, [string] $Text) {
  if (-not $Result.Output.Contains($Text)) {
    throw "Expected output to contain '$Text'. Output was:`n$($Result.Output)"
  }
}

# ---- Fake release ------------------------------------------------------------------------------

$setupName = 'suara-studio-9.9.9-win-x64-setup.exe'
[IO.File]::WriteAllText((Join-Path $release $setupName), 'not really an installer')
$hash = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $release $setupName)).Hash.ToLowerInvariant()
[IO.File]::WriteAllText((Join-Path $release 'SHA256SUMS.txt'), "$hash  $setupName`n")

$python = @('python3', 'python') | Where-Object { Get-Command $_ -ErrorAction SilentlyContinue } | Select-Object -First 1
if (-not $python) { throw 'Python is required to run the test HTTP server.' }
$port = Get-Random -Minimum 20000 -Maximum 40000
$serverArgs = @{
  FilePath = (Get-Command $python).Source
  ArgumentList = @('-m', 'http.server', "$port", '--bind', '127.0.0.1', '--directory', $release)
  PassThru = $true
}
# -WindowStyle only exists on Windows.
if ($IsWindows -or $PSVersionTable.PSVersion.Major -lt 6) { $serverArgs.WindowStyle = 'Hidden' }
$server = Start-Process @serverArgs
try {
  $baseUrl = "http://127.0.0.1:$port"
  $deadline = (Get-Date).AddSeconds(15)
  while ($true) {
    try {
      Invoke-WebRequest -UseBasicParsing -Uri "$baseUrl/SHA256SUMS.txt" | Out-Null
      break
    } catch {
      if ((Get-Date) -gt $deadline) { throw 'The test HTTP server did not start.' }
      Start-Sleep -Milliseconds 200
    }
  }

  $common = @{ SUARA_BASE_URL = $baseUrl; SUARA_DRY_RUN = '1'; PROCESSOR_ARCHITECTURE = 'AMD64'; PROCESSOR_ARCHITEW6432 = $null }

  $result = Invoke-Installer $common
  if ($result.ExitCode -ne 0) { throw "Dry run failed:`n$($result.Output)" }
  Assert-Contains $result 'Checksum verified'
  Assert-Contains $result 'Dry run'
  Pass 'dry run downloads and verifies the installer'

  $result = Invoke-Installer $common -ViaIex
  Assert-Contains $result 'Dry run'
  Pass 'works when piped into Invoke-Expression'

  $arm = $common.Clone()
  $arm.PROCESSOR_ARCHITECTURE = 'ARM64'
  $result = Invoke-Installer $arm
  if ($result.ExitCode -ne 0) { throw "ARM64 fallback failed:`n$($result.Output)" }
  Assert-Contains $result $setupName
  Pass 'Windows on Arm falls back to the x64 installer'

  $x86 = $common.Clone()
  $x86.PROCESSOR_ARCHITECTURE = 'x86'
  $result = Invoke-Installer $x86
  if ($result.ExitCode -eq 0) { throw 'An unsupported architecture should fail.' }
  Assert-Contains $result 'Unsupported processor architecture'
  Pass 'unsupported architectures are rejected'

  Add-Content -LiteralPath (Join-Path $release $setupName) -Value 'tampered'
  $result = Invoke-Installer $common
  if ($result.ExitCode -eq 0) { throw 'A tampered installer must not pass.' }
  Assert-Contains $result 'Checksum mismatch'
  Pass 'a tampered download is refused'
} finally {
  Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host "$($script:count) PowerShell installer tests passed"
