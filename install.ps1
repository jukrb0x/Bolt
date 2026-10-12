# Install bolt for Windows.
#   irm https://raw.githubusercontent.com/jukrb0x/Bolt/main/install.ps1 | iex
# The binary is bolt-win-x64.exe, installed as %LOCALAPPDATA%\bolt\bin\bolt.exe.
# Re-running this script renames a running bolt.exe aside before replacing it.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Repo = 'jukrb0x/Bolt'
$Base = "https://github.com/$Repo/releases/latest/download"
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

$DestDir = Join-Path $env:LOCALAPPDATA 'bolt\bin'
$ReceiptDir = Join-Path $env:USERPROFILE '.bolt'
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

  $Dest = Join-Path $DestDir 'bolt.exe'
  $Old = "$Dest.old"
  $RenamedAside = $false
  if (Test-Path -LiteralPath $Dest) {
    if (Test-Path -LiteralPath $Old) {
      Remove-Item -LiteralPath $Old -Force -ErrorAction SilentlyContinue
    }
    Rename-Item -LiteralPath $Dest -NewName 'bolt.exe.old'
    $RenamedAside = $true
  }
  try {
    Move-Item -LiteralPath $DownloadPath -Destination $Dest -Force
  } catch {
    if ($RenamedAside -and -not (Test-Path -LiteralPath $Dest) -and (Test-Path -LiteralPath $Old)) {
      Rename-Item -LiteralPath $Old -NewName 'bolt.exe'
    }
    throw
  }

  $Version = (& $Dest version | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or $Version -notmatch '^[0-9A-Za-z.+-]+$') {
    throw "Installed bolt printed an unexpected version (exit $LASTEXITCODE)"
  }
  $Json = (@{
      channel = 'github'
      asset   = $Asset
      version = $Version
    } | ConvertTo-Json)
  $Utf8 = New-Object System.Text.UTF8Encoding $false
  [System.IO.File]::WriteAllText((Join-Path $ReceiptDir 'install.json'), ($Json.Trim() + "`n"), $Utf8)
}
finally {
  if (Test-Path -LiteralPath $Tmp) {
    Remove-Item -LiteralPath $Tmp -Recurse -Force -ErrorAction SilentlyContinue
  }
}

$UserPath = [Environment]::GetEnvironmentVariable('Path', 'User')
if (-not $UserPath) { $UserPath = '' }
$PathEntries = $UserPath -split ';'
$Already = $false
foreach ($Entry in $PathEntries) {
  if ($Entry.TrimEnd('\').ToLower() -eq $DestDir.TrimEnd('\').ToLower()) { $Already = $true }
}
if (-not $Already) {
  $Prefix = $DestDir
  if ($UserPath) { $Prefix = "$DestDir;$UserPath" }
  [Environment]::SetEnvironmentVariable('Path', $Prefix, 'User')
  Write-Host "Added $DestDir to your user Path. Open a new terminal."
}

Write-Host "Installed $Asset to $Dest ($Version)"
