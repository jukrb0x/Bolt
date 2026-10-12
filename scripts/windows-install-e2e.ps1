# Windows install proof. Builds two real bolt binaries, serves them on localhost,
# runs install.ps1, then bolt self-update.
# The public `irm https://.../install.ps1 | iex` run is a later job, after a GitHub Release exists.
param(
  [ValidateSet("main", "probe")]
  [string]$Mode = "main",
  [string]$ExpectedVersion = "",
  [string]$ExpectedPath = ""
)

$ErrorActionPreference = "Stop"

function Strip-Ansi([string]$Text) {
  return [regex]::Replace($Text, [char]27 + '\[[0-9;]*m', '')
}

if ($Mode -eq "probe") {
  try {
    $machine = [Environment]::GetEnvironmentVariable("Path", "Machine")
    $user = [Environment]::GetEnvironmentVariable("Path", "User")
    if (-not $machine) { $machine = "" }
    if (-not $user) { $user = "" }
    $env:Path = "$machine;$user"
    $found = (Get-Command bolt -ErrorAction Stop).Path
    $want = $ExpectedPath.TrimEnd("\").ToLower()
    $got = $found.TrimEnd("\").ToLower()
    if ($got -ne $want) {
      throw "PATH resolved bolt to '$found', expected '$ExpectedPath'. PATH=$env:Path"
    }
    $version = Strip-Ansi ((& bolt --version | Out-String).Trim())
    if ($LASTEXITCODE -ne 0) { throw "bolt --version exited $LASTEXITCODE" }
    if ($version -ne $ExpectedVersion) {
      throw "bolt --version printed '$version', expected '$ExpectedVersion'"
    }
    Write-Host "PATH bolt is $found ($version)"
    exit 0
  } catch {
    Write-Host $_.Exception.Message
    exit 1
  }
}

$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root
$Port = 8765
$PublicBase = "http://127.0.0.1:$Port"
$ServeRoot = Join-Path $Root "build\e2e\serve"
$LogOut = Join-Path $env:TEMP "bolt-release-server.out"
$LogErr = Join-Path $env:TEMP "bolt-release-server.err"
$DestDir = Join-Path $env:LOCALAPPDATA "bolt\bin"
$Dest = Join-Path $DestDir "bolt.exe"
$Old = "$Dest.old"
$ReceiptPath = Join-Path $env:USERPROFILE ".bolt\install.json"
$Server = $null
$Failed = $true

function Get-Sha256([string]$Path) {
  return (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash.ToLower()
}

function Set-BoltVersion([string]$Version) {
  $path = Join-Path $Root "src\version.ts"
  $text = [System.IO.File]::ReadAllText($path)
  $updated = [regex]::Replace($text, 'export const VERSION = "[^"]*"', "export const VERSION = `"$Version`"")
  if ($updated -eq $text) { throw "src/version.ts has no VERSION constant" }
  $utf8 = New-Object System.Text.UTF8Encoding $false
  [System.IO.File]::WriteAllText($path, $updated, $utf8)
}

function Write-Sums([string]$ExePath, [string]$SumsPath) {
  $hash = Get-Sha256 $ExePath
  $utf8 = New-Object System.Text.UTF8Encoding $false
  [System.IO.File]::WriteAllText($SumsPath, "$hash  bolt-win-x64.exe`n", $utf8)
}

function Build-One([string]$Version, [string]$RelOut) {
  Set-BoltVersion $Version
  & bun run scripts/build-binary.ts bun-windows-x64 $RelOut
  if ($LASTEXITCODE -ne 0) { throw "build $Version failed with exit $LASTEXITCODE" }
  $abs = Join-Path $Root ($RelOut -replace '/', '\')
  if (-not (Test-Path -LiteralPath $abs)) {
    if (Test-Path -LiteralPath "$abs.exe") { $abs = "$abs.exe" } else { throw "missing build output $abs" }
  }
  $printed = Strip-Ansi ((& $abs --version | Out-String).Trim())
  if ($LASTEXITCODE -ne 0) { throw "built $Version --version exited $LASTEXITCODE" }
  if ($printed -ne $Version) { throw "built binary printed '$printed', expected $Version" }
  Write-Host "built $abs ($printed)"
  return $abs
}

function Invoke-Probe([string]$Version) {
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $PSCommandPath -Mode probe -ExpectedVersion $Version -ExpectedPath $Dest
  if ($LASTEXITCODE -ne 0) { throw "PATH probe for $Version failed" }
}

function Get-FreshPath {
  $machine = [Environment]::GetEnvironmentVariable("Path", "Machine")
  $user = [Environment]::GetEnvironmentVariable("Path", "User")
  if (-not $machine) { $machine = "" }
  if (-not $user) { $user = "" }
  return "$machine;$user"
}

try {
  if (Test-Path -LiteralPath $DestDir) { Remove-Item -LiteralPath $DestDir -Recurse -Force }
  if (Test-Path -LiteralPath $ReceiptPath) { Remove-Item -LiteralPath $ReceiptPath -Force }
  New-Item -ItemType Directory -Force -Path (Join-Path $ServeRoot "current") | Out-Null
  New-Item -ItemType Directory -Force -Path (Join-Path $ServeRoot "newer") | Out-Null

  $currentExe = Build-One "2.0.0" "build/e2e/bolt-2.0.0.exe"
  $newerExe = Build-One "2.0.1" "build/e2e/bolt-2.0.1.exe"
  $currentHash = Get-Sha256 $currentExe
  $newerHash = Get-Sha256 $newerExe
  if ($currentHash -eq $newerHash) { throw "the two builds are the same file" }

  Copy-Item -LiteralPath $currentExe -Destination (Join-Path $ServeRoot "current\bolt-win-x64.exe") -Force
  Copy-Item -LiteralPath $newerExe -Destination (Join-Path $ServeRoot "newer\bolt-win-x64.exe") -Force
  Write-Sums (Join-Path $ServeRoot "current\bolt-win-x64.exe") (Join-Path $ServeRoot "current\SHA256SUMS")
  Write-Sums (Join-Path $ServeRoot "newer\bolt-win-x64.exe") (Join-Path $ServeRoot "newer\SHA256SUMS")

  # Start-Process does not search PATH, so resolve bun.exe first.
  $bunExe = (Get-Command bun -ErrorAction Stop).Source
  $Server = Start-Process -FilePath $bunExe -WorkingDirectory $Root `
    -ArgumentList @("scripts/serve-release-fixture.ts", $ServeRoot, "$Port", $PublicBase) `
    -PassThru -WindowStyle Hidden -RedirectStandardOutput $LogOut -RedirectStandardError $LogErr

  $deadline = (Get-Date).AddSeconds(30)
  $healthy = $false
  do {
    try {
      $client = New-Object System.Net.WebClient
      if ($client.DownloadString("$PublicBase/health") -eq "ok") { $healthy = $true }
    } catch {
      Start-Sleep -Milliseconds 200
    }
  } while (-not $healthy -and (Get-Date) -lt $deadline)
  if (-not $healthy) { throw "local release server did not start" }

  $env:BOLT_INSTALL_BASE = "$PublicBase/current"
  Write-Host "running install.ps1 against $env:BOLT_INSTALL_BASE"
  & (Join-Path $Root "install.ps1")
  Remove-Item Env:BOLT_INSTALL_BASE

  if (-not (Test-Path -LiteralPath $Dest)) { throw "install.ps1 did not write $Dest" }
  if ((Get-Sha256 $Dest) -ne $currentHash) { throw "installed bolt.exe is not the 2.0.0 build" }
  $receipt = Get-Content -Raw -LiteralPath $ReceiptPath | ConvertFrom-Json
  if ($receipt.channel -ne "github" -or $receipt.asset -ne "bolt-win-x64.exe" -or $receipt.version -ne "2.0.0") {
    throw "unexpected receipt: $(Get-Content -Raw -LiteralPath $ReceiptPath)"
  }
  $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
  $onPath = $false
  foreach ($entry in ($userPath -split ";")) {
    if ($entry.TrimEnd("\").ToLower() -eq $DestDir.TrimEnd("\").ToLower()) { $onPath = $true }
  }
  if (-not $onPath) { throw "User Path does not contain $DestDir. Path=$userPath" }

  $env:Path = Get-FreshPath
  Invoke-Probe "2.0.0"
  if (Test-Path -LiteralPath $Old) { throw "bolt.exe.old existed before self-update" }

  $env:BOLT_RELEASES_API = "$PublicBase/repos/jukrb0x/Bolt/releases"
  Write-Host "running bolt self-update against $env:BOLT_RELEASES_API"
  & bolt self-update
  if ($LASTEXITCODE -ne 0) { throw "bolt self-update exited $LASTEXITCODE" }
  Remove-Item Env:BOLT_RELEASES_API

  if (-not (Test-Path -LiteralPath $Old)) { throw "self-update did not rename the running exe to bolt.exe.old" }
  if ((Get-Sha256 $Old) -ne $currentHash) { throw "bolt.exe.old is not the exe that was running" }
  if ((Get-Sha256 $Dest) -ne $newerHash) { throw "bolt.exe on PATH is not the newer build" }
  $receipt = Get-Content -Raw -LiteralPath $ReceiptPath | ConvertFrom-Json
  if ($receipt.version -ne "2.0.1" -or $receipt.asset -ne "bolt-win-x64.exe") {
    throw "self-update left receipt $(Get-Content -Raw -LiteralPath $ReceiptPath)"
  }

  Invoke-Probe "2.0.1"
  if (Test-Path -LiteralPath $Old) { throw "the next launch left bolt.exe.old in place" }
  if ((Get-Sha256 $Dest) -ne $newerHash) { throw "cleanup replaced or removed the newer bolt.exe" }

  Write-Host "windows install and self-update ok"
  $Failed = $false
} finally {
  if ($Server -and -not $Server.HasExited) {
    Stop-Process -Id $Server.Id -Force -ErrorAction SilentlyContinue
  }
  if ($Failed) {
    Write-Host "---- release server stdout ----"
    if (Test-Path -LiteralPath $LogOut) { Get-Content -LiteralPath $LogOut -Tail 80 }
    Write-Host "---- release server stderr ----"
    if (Test-Path -LiteralPath $LogErr) { Get-Content -LiteralPath $LogErr -Tail 80 }
    if (Test-Path -LiteralPath $DestDir) {
      Write-Host "---- $DestDir ----"
      Get-ChildItem -LiteralPath $DestDir -Force | Format-Table Name, Length -AutoSize | Out-String | Write-Host
    }
  }
}
