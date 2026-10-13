# Install bolt for Windows.
#   irm https://raw.githubusercontent.com/jukrb0x/Bolt/main/install.ps1 | iex
# The binary is bolt-win-x64.exe, installed as %USERPROFILE%\.bolt\bin\bolt.exe.
# If a bolt.exe is already on PATH, that copy is updated in place instead.
# Re-running this script renames a running bolt.exe aside before replacing it.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Repo = 'jukrb0x/Bolt'
# Download directory containing SHA256SUMS and bolt-win-x64.exe.
# Unset, this is the public GitHub latest release. A local release sets BOLT_INSTALL_BASE.
$Base = "https://github.com/$Repo/releases/latest/download"
if ($env:BOLT_INSTALL_BASE) { $Base = $env:BOLT_INSTALL_BASE.TrimEnd('/') }
$Asset = 'bolt-win-x64.exe'

# A 32-bit PowerShell on 64-bit Windows reports x86 in PROCESSOR_ARCHITECTURE.
$Arch = $env:PROCESSOR_ARCHITECTURE
if ($env:PROCESSOR_ARCHITEW6432) { $Arch = $env:PROCESSOR_ARCHITEW6432 }
if ($Arch -eq 'ARM64') {
  throw 'Bolt publishes Windows x64 only (bolt-win-x64.exe). Native Windows ARM64 is not available.'
}
if ($Arch -ne 'AMD64') {
  throw "Unsupported Windows architecture: $Arch"
}

$ReceiptDir = Join-Path $env:USERPROFILE '.bolt'
$DefaultDir = Join-Path $ReceiptDir 'bin'
$DestDir = $DefaultDir

# Update a bolt.exe that is already on PATH instead of installing a second copy.
# Package-manager copies (npm, winget, scoop) are left to their manager.
function Test-ManagedPath([string]$Path) {
  $p = $Path.Replace('\', '/').ToLower()
  return ($p.Contains('/node_modules/') -or $p.Contains('/winget/packages/') -or
    $p.Contains('/microsoft/winget/') -or $p.Contains('/scoop/apps/') -or $p.Contains('/scoop/shims/'))
}
$Existing = Get-Command bolt -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
if ($Existing -and $Existing.Source) {
  $ExistingPath = [System.IO.Path]::GetFullPath($Existing.Source)
  if ([System.IO.Path]::GetFileName($ExistingPath) -ine 'bolt.exe') {
    Write-Host "Ignoring $ExistingPath on PATH: not bolt.exe."
  } elseif ($env:LOCALAPPDATA -and ([System.IO.Path]::GetDirectoryName($ExistingPath).TrimEnd('\').ToLower() -eq (Join-Path $env:LOCALAPPDATA 'bolt\bin').TrimEnd('\').ToLower())) {
    Write-Host "Found the v2.1.x install at $ExistingPath. Installing to $DefaultDir instead."
  } elseif (Test-ManagedPath $ExistingPath) {
    Write-Host "Ignoring $ExistingPath on PATH: it belongs to a package manager. Update it with that manager."
  } else {
    $ExistingVersion = ''
    $global:LASTEXITCODE = 1
    try { $ExistingVersion = (& $ExistingPath version 2>$null | Out-String).Trim() } catch { $ExistingVersion = '' }
    if ($LASTEXITCODE -eq 0 -and $ExistingVersion -match '^[0-9]+\.[0-9]+\.[0-9]+[0-9A-Za-z.+-]*$') {
      $DestDir = [System.IO.Path]::GetDirectoryName($ExistingPath)
      Write-Host "Found bolt $ExistingVersion at $ExistingPath. Updating it in place."
    } else {
      Write-Host "Ignoring $ExistingPath on PATH: it did not print a bolt version."
    }
  }
}
New-Item -ItemType Directory -Force -Path $DestDir | Out-Null
New-Item -ItemType Directory -Force -Path $ReceiptDir | Out-Null

$Tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("bolt-install-" + [guid]::NewGuid().ToString('n'))
New-Item -ItemType Directory -Force -Path $Tmp | Out-Null

try {
  $SumsPath = Join-Path $Tmp 'SHA256SUMS'
  $DownloadPath = Join-Path $Tmp $Asset
  Invoke-WebRequest -Uri "$Base/SHA256SUMS" -OutFile $SumsPath -UseBasicParsing
  Invoke-WebRequest -Uri "$Base/$Asset" -OutFile $DownloadPath -UseBasicParsing

  $Expected = $null
  foreach ($Line in @(Get-Content -Path $SumsPath)) {
    if ($Line -match '^([a-fA-F0-9]{64})  (\S+)$' -and $Matches[2] -eq $Asset) {
      $Expected = $Matches[1].ToLower()
    }
  }
  if (-not $Expected) {
    throw "SHA256SUMS has no entry for $Asset"
  }
  $Actual = (Get-FileHash -Algorithm SHA256 -Path $DownloadPath).Hash.ToLower()
  if ($Actual -ne $Expected) {
    throw "Checksum mismatch for $Asset. bolt was not installed."
  }

  Unblock-File -LiteralPath $DownloadPath
  $Version = (& $DownloadPath version | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or $Version -notmatch '^[0-9A-Za-z.+-]+$') {
    throw "Downloaded bolt printed an unexpected version (exit $LASTEXITCODE). The existing bolt was not replaced."
  }

  $Dest = Join-Path $DestDir 'bolt.exe'
  $Old = "$Dest.old"
  $Staged = Join-Path $DestDir 'bolt.exe.new'
  # Copy onto the install volume before the live exe is renamed.
  if (Test-Path -LiteralPath $Staged) {
    Remove-Item -LiteralPath $Staged -Force -ErrorAction SilentlyContinue
  }
  Copy-Item -LiteralPath $DownloadPath -Destination $Staged -Force
  Unblock-File -LiteralPath $Staged
  $StagedHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $Staged).Hash.ToLower()
  if ($StagedHash -ne $Expected) {
    Remove-Item -LiteralPath $Staged -Force -ErrorAction SilentlyContinue
    throw "Staged bolt.exe did not match SHA256SUMS. The existing bolt was not replaced."
  }

  $RenamedAside = $false
  if (Test-Path -LiteralPath $Dest) {
    if (Test-Path -LiteralPath $Old) {
      Remove-Item -LiteralPath $Old -Force -ErrorAction SilentlyContinue
    }
    Rename-Item -LiteralPath $Dest -NewName 'bolt.exe.old'
    $RenamedAside = $true
  }
  try {
    Rename-Item -LiteralPath $Staged -NewName 'bolt.exe'
  } catch {
    if (Test-Path -LiteralPath $Dest) {
      Remove-Item -LiteralPath $Dest -Force -ErrorAction SilentlyContinue
    }
    if ($RenamedAside -and -not (Test-Path -LiteralPath $Dest) -and (Test-Path -LiteralPath $Old)) {
      Rename-Item -LiteralPath $Old -NewName 'bolt.exe'
    }
    if (Test-Path -LiteralPath $Staged) {
      Remove-Item -LiteralPath $Staged -Force -ErrorAction SilentlyContinue
    }
    throw
  }
  Unblock-File -LiteralPath $Dest

  $Json = (@{
      channel = 'github'
      asset   = $Asset
      version = $Version
      path    = $Dest
    } | ConvertTo-Json)
  $Utf8 = New-Object System.Text.UTF8Encoding $false
  [System.IO.File]::WriteAllText((Join-Path $ReceiptDir 'install.json'), ($Json.Trim() + "`n"), $Utf8)
}
finally {
  if (Test-Path -LiteralPath $Tmp) {
    Remove-Item -LiteralPath $Tmp -Recurse -Force -ErrorAction SilentlyContinue
  }
}

if ($DestDir -eq $DefaultDir) {
  # Put the install dir first so it wins over a v2.1.x %LOCALAPPDATA%\bolt\bin entry.
  $UserPath = [Environment]::GetEnvironmentVariable('Path', 'User')
  if (-not $UserPath) { $UserPath = '' }
  $Want = $DestDir.TrimEnd('\').ToLower()
  $PathEntries = @($UserPath -split ';' | Where-Object { $_ })
  $First = ''
  if ($PathEntries.Count -gt 0) { $First = $PathEntries[0].TrimEnd('\').ToLower() }
  if ($First -ne $Want) {
    $Rest = @($PathEntries | Where-Object { $_.TrimEnd('\').ToLower() -ne $Want })
    [Environment]::SetEnvironmentVariable('Path', ((@($DestDir) + $Rest) -join ';'), 'User')
    Write-Host "Added $DestDir to the front of your user Path. Open a new terminal."
  }
}

# v2.1.0 to v2.1.2 installed to %LOCALAPPDATA%\bolt\bin. Do not delete it, just say so.
if ($env:LOCALAPPDATA) {
  $LegacyDir = Join-Path $env:LOCALAPPDATA 'bolt\bin'
  if ((Test-Path -LiteralPath $LegacyDir) -and ($LegacyDir.TrimEnd('\').ToLower() -ne $DestDir.TrimEnd('\').ToLower())) {
    Write-Host "Note: $LegacyDir is from bolt v2.1.x and is no longer used. You can delete it and remove it from your user Path."
  }
}

Write-Host "Installed $Asset to $Dest ($Version)"
