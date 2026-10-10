<#
.SYNOPSIS
  Installs Suara Studio on Windows.

.DESCRIPTION
  Downloads the Windows installer from the Suara Studio release on GitHub, checks it against
  the release's SHA256SUMS.txt and installs it for the current user (no administrator rights
  needed). Run it in PowerShell:

    irm https://github.com/tenmaryut/suara-studio/releases/latest/download/install.ps1 | iex

  Options are read from environment variables so they also work with "irm | iex":

    $env:SUARA_VERSION = 'v0.1.0'   Install a specific release instead of the latest
    $env:SUARA_DRY_RUN = '1'        Download and verify only
    $env:SUARA_UNINSTALL = '1'      Remove Suara Studio
    $env:SUARA_ARCH = 'x64'         Install the build for this architecture (x64 or arm64)
#>

function Get-SuaraArchitecture {
  # SUARA_ARCH overrides detection, e.g. to install the x64 build on Windows on Arm.
  $arch = $env:SUARA_ARCH
  if (-not $arch) {
    try {
      # The operating system's architecture, even when this PowerShell runs as a 32-bit process.
      $arch = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString()
    } catch {
      $arch = $null
    }
  }
  if (-not $arch) { $arch = $env:PROCESSOR_ARCHITEW6432 }
  if (-not $arch) { $arch = $env:PROCESSOR_ARCHITECTURE }
  switch ($arch) {
    { $_ -in 'x64', 'AMD64' } { return 'x64' }
    { $_ -in 'arm64' } { return 'arm64' }
    default { throw "Unsupported processor architecture: $arch" }
  }
}

function Get-SuaraReleaseUrl {
  param([string] $Repo, [string] $Version, [string] $BaseUrl)
  if ($BaseUrl) { return $BaseUrl.TrimEnd('/') }
  if (-not $Version) {
    try {
      $release = Invoke-RestMethod -UseBasicParsing -Uri "https://api.github.com/repos/$Repo/releases/latest" `
        -Headers @{ 'User-Agent' = 'suara-studio-installer'; 'Accept' = 'application/vnd.github+json' }
      $Version = $release.tag_name
    } catch {
      $Version = $null
    }
    if (-not $Version) { throw 'Could not find a published release of Suara Studio.' }
  }
  if (-not $Version.StartsWith('v')) { $Version = "v$Version" }
  return "https://github.com/$Repo/releases/download/$Version"
}

function Get-SuaraChecksums {
  param([string] $Path)
  foreach ($line in Get-Content -LiteralPath $Path) {
    $parts = $line.Trim() -split '\s+', 2
    if ($parts.Count -eq 2) {
      [pscustomobject]@{ Hash = $parts[0].ToLowerInvariant(); Name = $parts[1].TrimStart('*') }
    }
  }
}

function Uninstall-SuaraStudio {
  $keys = @(
    'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
    'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
    'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*'
  )
  $entry = Get-ItemProperty -Path $keys -ErrorAction SilentlyContinue |
    Where-Object { $_.DisplayName -like 'Suara Studio*' } |
    Select-Object -First 1
  if (-not $entry) {
    Write-Warning 'Suara Studio is not installed.'
    return
  }
  $command = $entry.QuietUninstallString
  if (-not $command) { $command = "$($entry.UninstallString) /S" }
  Write-Host '==> Removing Suara Studio'
  $process = Start-Process -FilePath 'cmd.exe' -ArgumentList '/d', '/s', '/c', "`"$command`"" -Wait -PassThru -WindowStyle Hidden
  if ($process.ExitCode -ne 0) { throw "The uninstaller exited with code $($process.ExitCode)." }
  Write-Host '==> Suara Studio was removed. Your recordings were not touched.'
}

function Install-SuaraStudio {
  [CmdletBinding()]
  param(
    [string] $Version = $env:SUARA_VERSION,
    [string] $BaseUrl = $env:SUARA_BASE_URL,
    [bool] $DryRun = ($env:SUARA_DRY_RUN -eq '1'),
    [bool] $Uninstall = ($env:SUARA_UNINSTALL -eq '1')
  )
  # Scoped to this function so "irm | iex" leaves the caller's session settings alone.
  $ErrorActionPreference = 'Stop'
  $ProgressPreference = 'SilentlyContinue'
  $repo = 'tenmaryut/suara-studio'

  if ($PSVersionTable.PSVersion.Major -lt 6) {
    # Windows PowerShell 5.1 does not enable TLS 1.2 by default.
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
  }

  if ($Uninstall) {
    Uninstall-SuaraStudio
    return
  }

  $arch = Get-SuaraArchitecture
  $releaseUrl = Get-SuaraReleaseUrl -Repo $repo -Version $Version -BaseUrl $BaseUrl
  $temp = Join-Path ([IO.Path]::GetTempPath()) ('suara-studio-' + [Guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $temp | Out-Null
  try {
    Write-Host "==> Installing Suara Studio from $releaseUrl"
    $sumsPath = Join-Path $temp 'SHA256SUMS.txt'
    Invoke-WebRequest -UseBasicParsing -Uri "$releaseUrl/SHA256SUMS.txt" -OutFile $sumsPath
    $checksums = @(Get-SuaraChecksums -Path $sumsPath)

    $entry = $checksums | Where-Object { $_.Name -match "-win-$arch-setup\.exe$" } | Select-Object -First 1
    if (-not $entry -and $arch -eq 'arm64') {
      # Windows on Arm runs x64 apps through emulation.
      $entry = $checksums | Where-Object { $_.Name -match '-win-x64-setup\.exe$' } | Select-Object -First 1
    }
    if (-not $entry) { throw "This release has no Windows installer for $arch." }

    $installer = Join-Path $temp $entry.Name
    Write-Host "==> Downloading $($entry.Name)"
    Invoke-WebRequest -UseBasicParsing -Uri "$releaseUrl/$($entry.Name)" -OutFile $installer
    $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $installer).Hash.ToLowerInvariant()
    if ($actual -ne $entry.Hash) {
      throw "Checksum mismatch for $($entry.Name) (expected $($entry.Hash), got $actual)."
    }
    Write-Host '==> Checksum verified'

    if ($DryRun) {
      Write-Host "==> Dry run: $($entry.Name) was downloaded and verified, nothing was installed"
      return
    }

    Write-Host '==> Installing (this takes a few seconds)'
    $process = Start-Process -FilePath $installer -ArgumentList '/S' -Wait -PassThru
    if ($process.ExitCode -ne 0) { throw "The installer exited with code $($process.ExitCode)." }
    Write-Host '==> Suara Studio is installed. Start it from the Start menu.'
  }
  finally {
    Remove-Item -LiteralPath $temp -Recurse -Force -ErrorAction SilentlyContinue
  }
}

Install-SuaraStudio
