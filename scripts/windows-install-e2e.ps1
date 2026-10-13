# Windows install proof. Builds two real bolt binaries, serves them on localhost,
# runs install.ps1, then bolt self-update, then install.ps1 again over a bolt.exe
# that is already on PATH outside %USERPROFILE%\.bolt\bin.
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
$DestDir = Join-Path $env:USERPROFILE ".bolt\bin"
$LegacyDir = Join-Path $env:LOCALAPPDATA "bolt\bin"
# USERPROFILE, not TEMP: TEMP can be an 8.3 short path that install.ps1 expands.
$CustomDir = Join-Path $env:USERPROFILE "bolt-e2e-custom\bin"
$Dest = Join-Path $DestDir "bolt.exe"
$Old = "$Dest.old"
$ReceiptPath = Join-Path $env:USERPROFILE ".bolt\install.json"
$Server = $null
$Failed = $true
# Run the probe under the same PowerShell (5.1 or 7) that runs this script.
$HostExe = (Get-Process -Id $PID).Path
Write-Host "PowerShell $($PSVersionTable.PSVersion) at $HostExe"
$ScratchRoot = Join-Path $env:USERPROFILE "bolt-e2e-cases"
$EnvKeyPath = "Environment"
$MachineKeyPath = "SYSTEM\CurrentControlSet\Control\Session Manager\Environment"

function Get-RawPath([Microsoft.Win32.RegistryKey]$Hive, [string]$Sub) {
  $key = $Hive.OpenSubKey($Sub)
  try {
    $names = $key.GetValueNames()
    if ($names -notcontains "Path") { return @{ Exists = $false; Value = ""; Kind = [Microsoft.Win32.RegistryValueKind]::ExpandString } }
    return @{
      Exists = $true
      Value  = [string]$key.GetValue("Path", "", [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
      Kind   = $key.GetValueKind("Path")
    }
  } finally { $key.Close() }
}

function Set-RawPath([Microsoft.Win32.RegistryKey]$Hive, [string]$Sub, $Saved) {
  $key = $Hive.OpenSubKey($Sub, $true)
  try {
    if ($Saved.Exists) { $key.SetValue("Path", $Saved.Value, $Saved.Kind) }
    else { $key.DeleteValue("Path", $false) }
  } finally { $key.Close() }
}

function Invoke-Install([string]$Base, [string]$SessionPath) {
  $env:Path = $SessionPath
  $env:BOLT_INSTALL_BASE = $Base
  try {
    $out = (& (Join-Path $Root "install.ps1") *>&1 | Out-String)
  } finally {
    Remove-Item Env:BOLT_INSTALL_BASE -ErrorAction SilentlyContinue
  }
  Write-Host $out
  # Windows PowerShell 5.1 wraps captured host output at the console width.
  return ($out -replace '\s+', ' ')
}

$SavedUserPath = Get-RawPath ([Microsoft.Win32.Registry]::CurrentUser) $EnvKeyPath
$SavedMachinePath = Get-RawPath ([Microsoft.Win32.Registry]::LocalMachine) $MachineKeyPath

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
  $buildOut = Join-Path $env:TEMP "bolt-build-$Version.out"
  $buildErr = Join-Path $env:TEMP "bolt-build-$Version.err"
  $bunExe = (Get-Command bun -ErrorAction Stop).Source
  # Start-Process keeps the compiler log out of this function's return value.
  $proc = Start-Process -FilePath $bunExe -WorkingDirectory $Root -ArgumentList @(
    "run", "scripts/build-binary.ts", "bun-windows-x64", $RelOut
  ) -Wait -PassThru -WindowStyle Hidden -RedirectStandardOutput $buildOut -RedirectStandardError $buildErr
  if ($proc.ExitCode -ne 0) {
    Write-Host "---- build $Version stdout ----"
    if (Test-Path -LiteralPath $buildOut) { Get-Content -LiteralPath $buildOut -Tail 40 | Out-Host }
    Write-Host "---- build $Version stderr ----"
    if (Test-Path -LiteralPath $buildErr) { Get-Content -LiteralPath $buildErr -Tail 40 | Out-Host }
    throw "build $Version failed with exit $($proc.ExitCode)"
  }
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
  & $HostExe -NoProfile -ExecutionPolicy Bypass -File $PSCommandPath -Mode probe -ExpectedVersion $Version -ExpectedPath $Dest
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
  if (Test-Path -LiteralPath $LegacyDir) { Remove-Item -LiteralPath $LegacyDir -Recurse -Force }
  if (Test-Path -LiteralPath $CustomDir) { Remove-Item -LiteralPath $CustomDir -Recurse -Force }
  New-Item -ItemType Directory -Force -Path (Join-Path $ServeRoot "current") | Out-Null
  New-Item -ItemType Directory -Force -Path (Join-Path $ServeRoot "newer") | Out-Null

  $currentExe = [string](Build-One "2.0.0" "build/e2e/bolt-2.0.0.exe")
  $newerExe = [string](Build-One "2.0.1" "build/e2e/bolt-2.0.1.exe")
  if ($currentExe -notmatch '\.exe$' -or $newerExe -notmatch '\.exe$') {
    throw "build did not return an exe path. current='$currentExe' newer='$newerExe'"
  }
  Write-Host "current exe path: $currentExe"
  Write-Host "newer exe path: $newerExe"
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

  # The first install starts from a v2.1.x bolt.exe first on PATH and a user Path
  # with a %VAR% entry, duplicates, an empty entry, and a trailing-'\' copy of the
  # install dir. Only the install dir may move; every other entry keeps its text.
  New-Item -ItemType Directory -Force -Path $LegacyDir | Out-Null
  Copy-Item -LiteralPath $currentExe -Destination (Join-Path $LegacyDir "bolt.exe") -Force
  $VarEntry = '%USERPROFILE%\foo'
  $Seed = @($LegacyDir, $VarEntry, "", "$DestDir\", "C:\bolt-e2e-dup", "C:\bolt-e2e-dup", '%USERPROFILE%\.bolt\bin', "") -join ";"
  $userKey = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($EnvKeyPath, $true)
  $userKey.SetValue("Path", $Seed, [Microsoft.Win32.RegistryValueKind]::ExpandString)
  $userKey.Close()
  Write-Host "running install.ps1 against $PublicBase/current with $LegacyDir first on PATH"
  $firstOut = Invoke-Install "$PublicBase/current" ("$LegacyDir;" + (Get-FreshPath))
  if ($firstOut -notmatch "Found the v2.1.x install") { throw "install.ps1 did not recognise the v2.1.x bolt.exe" }
  if ($firstOut -notmatch "Added .* to the front of your user Path") { throw "install.ps1 did not update the user Path" }
  $raw = Get-RawPath ([Microsoft.Win32.Registry]::CurrentUser) $EnvKeyPath
  if ($raw.Kind -ne [Microsoft.Win32.RegistryValueKind]::ExpandString) { throw "user Path kind is $($raw.Kind), expected ExpandString" }
  $wantRaw = @($DestDir, $LegacyDir, $VarEntry, "", "C:\bolt-e2e-dup", "C:\bolt-e2e-dup", "") -join ";"
  if ($raw.Value -cne $wantRaw) { throw "user Path is '$($raw.Value)', expected '$wantRaw'" }
  Write-Host "user Path kept '$VarEntry' as text and stayed ExpandString: $($raw.Value)"

  if (-not (Test-Path -LiteralPath $Dest)) { throw "install.ps1 did not write $Dest" }
  if ((Get-Sha256 $Dest) -ne $currentHash) { throw "installed bolt.exe is not the 2.0.0 build" }
  $receipt = Get-Content -Raw -LiteralPath $ReceiptPath | ConvertFrom-Json
  if ($receipt.channel -ne "github" -or $receipt.asset -ne "bolt-win-x64.exe" -or $receipt.version -ne "2.0.0") {
    throw "unexpected receipt: $(Get-Content -Raw -LiteralPath $ReceiptPath)"
  }
  if ($receipt.path.TrimEnd("\").ToLower() -ne $Dest.TrimEnd("\").ToLower()) {
    throw "receipt path is '$($receipt.path)', expected '$Dest'"
  }
  $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
  if ($userPath -notmatch [regex]::Escape((Join-Path $env:USERPROFILE "foo"))) { throw "expanded user Path lost $VarEntry" }
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
  Write-Host "self-update renamed the running exe to bolt.exe.old"
  $receipt = Get-Content -Raw -LiteralPath $ReceiptPath | ConvertFrom-Json
  if ($receipt.version -ne "2.0.1" -or $receipt.asset -ne "bolt-win-x64.exe") {
    throw "self-update left receipt $(Get-Content -Raw -LiteralPath $ReceiptPath)"
  }

  Invoke-Probe "2.0.1"
  if (Test-Path -LiteralPath $Old) { throw "the next launch left bolt.exe.old in place" }
  Write-Host "later launch removed bolt.exe.old"
  if ((Get-Sha256 $Dest) -ne $newerHash) { throw "cleanup replaced or removed the newer bolt.exe" }

  # A bolt.exe already on PATH elsewhere is updated in place, and a v2.1.x
  # %LOCALAPPDATA%\bolt\bin directory is reported but left alone.
  New-Item -ItemType Directory -Force -Path $CustomDir | Out-Null
  New-Item -ItemType Directory -Force -Path $LegacyDir | Out-Null
  $customExe = Join-Path $CustomDir "bolt.exe"
  Copy-Item -LiteralPath $currentExe -Destination $customExe -Force
  $defaultStamp = (Get-Item -LiteralPath $Dest).LastWriteTimeUtc
  $userPathBefore = [Environment]::GetEnvironmentVariable("Path", "User")
  $env:Path = "$CustomDir;" + (Get-FreshPath)
  $env:BOLT_INSTALL_BASE = "$PublicBase/newer"
  Write-Host "running install.ps1 with $customExe first on PATH"
  $installOut = ((& (Join-Path $Root "install.ps1") *>&1 | Out-String) -replace '\s+', ' ')
  Remove-Item Env:BOLT_INSTALL_BASE
  Write-Host $installOut
  if ((Get-Sha256 $customExe) -ne $newerHash) { throw "install.ps1 did not update $customExe in place" }
  if ((Get-Item -LiteralPath $Dest).LastWriteTimeUtc -ne $defaultStamp) { throw "install.ps1 also wrote $Dest" }
  if ($installOut -notmatch "Updating it in place") { throw "install.ps1 did not report the in-place update" }
  if ($installOut -notmatch "no longer used") { throw "install.ps1 did not mention $LegacyDir" }
  if (-not (Test-Path -LiteralPath $LegacyDir)) { throw "install.ps1 deleted $LegacyDir" }
  if ([Environment]::GetEnvironmentVariable("Path", "User") -ne $userPathBefore) { throw "in-place update changed the user Path" }
  $receipt = Get-Content -Raw -LiteralPath $ReceiptPath | ConvertFrom-Json
  if ($receipt.path.TrimEnd("\").ToLower() -ne $customExe.ToLower() -or $receipt.version -ne "2.0.1") {
    throw "receipt after in-place update: $(Get-Content -Raw -LiteralPath $ReceiptPath)"
  }
  Write-Host "install.ps1 updated the bolt.exe on PATH in place"

  New-Item -ItemType Directory -Force -Path $ScratchRoot | Out-Null

  # Re-running the default install with a clean Path must not rewrite it.
  $before = Get-RawPath ([Microsoft.Win32.Registry]::CurrentUser) $EnvKeyPath
  $out = Invoke-Install "$PublicBase/newer" (Get-FreshPath)
  if ($out -match "Added ") { throw "install.ps1 rewrote a user Path that already had $DestDir first" }
  $after = Get-RawPath ([Microsoft.Win32.Registry]::CurrentUser) $EnvKeyPath
  if ($after.Value -cne $before.Value -or $after.Kind -ne $before.Kind) { throw "re-run changed the user Path" }

  # A bolt.exe that is not bolt (where.exe) first on the system Path: ignored, and the
  # installer warns that a new terminal would still run it.
  $shadowDir = Join-Path $ScratchRoot "shadow"
  New-Item -ItemType Directory -Force -Path $shadowDir | Out-Null
  Copy-Item -LiteralPath (Join-Path $env:SystemRoot "System32\where.exe") -Destination (Join-Path $shadowDir "bolt.exe") -Force
  $machineKey = [Microsoft.Win32.Registry]::LocalMachine.OpenSubKey($MachineKeyPath, $true)
  $machineKey.SetValue("Path", "$shadowDir;" + $SavedMachinePath.Value, $SavedMachinePath.Kind)
  $machineKey.Close()
  try {
    # Copy-Item keeps mtimes, so mark the default install with the old build and check the hash.
    Copy-Item -LiteralPath $currentExe -Destination $Dest -Force
    $out = Invoke-Install "$PublicBase/newer" (Get-FreshPath)
    if ($out -notmatch "did not print a bolt version") { throw "install.ps1 did not reject the non-bolt bolt.exe" }
    if ($out -notmatch "Warning: a new terminal will run") { throw "install.ps1 did not warn about system Path precedence" }
    if ((Get-Sha256 $Dest) -ne $newerHash) { throw "install.ps1 did not reinstall $Dest" }
  } finally {
    Set-RawPath ([Microsoft.Win32.Registry]::LocalMachine) $MachineKeyPath $SavedMachinePath
  }
  Write-Host "non-bolt bolt.exe ignored and system Path precedence reported"

  # A real bolt.exe in a directory this user cannot write: default dir instead.
  # Deny only WD,AD: the generic W right also denies SYNCHRONIZE and hides the dir.
  $roDir = Join-Path $ScratchRoot "ro\bin"
  New-Item -ItemType Directory -Force -Path $roDir | Out-Null
  Copy-Item -LiteralPath $currentExe -Destination (Join-Path $roDir "bolt.exe") -Force
  $me = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
  & icacls.exe $roDir /deny "${me}:(WD,AD)" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "icacls deny failed" }
  try {
    # Copy-Item keeps mtimes, so mark the default install with the old build and check the hash.
    Copy-Item -LiteralPath $currentExe -Destination $Dest -Force
    $out = Invoke-Install "$PublicBase/newer" ("$roDir;" + (Get-FreshPath))
    if ($out -notmatch "is not writable") { throw "install.ps1 did not skip the unwritable directory" }
    if ((Get-Sha256 (Join-Path $roDir "bolt.exe")) -ne $currentHash) { throw "install.ps1 changed the bolt.exe in $roDir" }
    if ((Get-Sha256 $Dest) -ne $newerHash) { throw "install.ps1 did not install to $Dest" }
  } finally {
    & icacls.exe $roDir /remove:d $me | Out-Null
  }
  Write-Host "unwritable directory skipped"

  # Package-managed copies are left alone.
  $chocoDir = Join-Path $ScratchRoot "chocolatey\bin"
  New-Item -ItemType Directory -Force -Path $chocoDir | Out-Null
  Copy-Item -LiteralPath $currentExe -Destination (Join-Path $chocoDir "bolt.exe") -Force
  $out = Invoke-Install "$PublicBase/newer" ("$chocoDir;" + (Get-FreshPath))
  if ($out -notmatch "belongs to a package manager") { throw "install.ps1 did not skip the chocolatey copy" }
  if ((Get-Sha256 (Join-Path $chocoDir "bolt.exe")) -ne $currentHash) { throw "install.ps1 changed the chocolatey bolt.exe" }
  Write-Host "package-managed copy skipped"

  # A symlinked bolt.exe is not replaced in place.
  $linkDir = Join-Path $ScratchRoot "link"
  $linkTargetDir = Join-Path $ScratchRoot "link-target"
  New-Item -ItemType Directory -Force -Path $linkDir, $linkTargetDir | Out-Null
  $linkTarget = Join-Path $linkTargetDir "bolt.exe"
  Copy-Item -LiteralPath $currentExe -Destination $linkTarget -Force
  New-Item -ItemType SymbolicLink -Path (Join-Path $linkDir "bolt.exe") -Target $linkTarget | Out-Null
  $out = Invoke-Install "$PublicBase/newer" ("$linkDir;" + (Get-FreshPath))
  if ($out -notmatch "symlink or junction") { throw "install.ps1 did not skip the symlinked bolt.exe" }
  if ((Get-Sha256 $linkTarget) -ne $currentHash) { throw "install.ps1 wrote through the symlink" }
  Write-Host "symlinked bolt.exe skipped"

  # A real bolt.exe reached through a junctioned ancestor directory is not replaced in place.
  $junctionTarget = Join-Path $ScratchRoot "junction-target"
  New-Item -ItemType Directory -Force -Path (Join-Path $junctionTarget "bin") | Out-Null
  $junctionExe = Join-Path $junctionTarget "bin\bolt.exe"
  Copy-Item -LiteralPath $currentExe -Destination $junctionExe -Force
  $junction = Join-Path $ScratchRoot "junction"
  New-Item -ItemType Junction -Path $junction -Target $junctionTarget | Out-Null
  $out = Invoke-Install "$PublicBase/newer" ((Join-Path $junction "bin") + ";" + (Get-FreshPath))
  if ($out -notmatch "symlink or junction") { throw "install.ps1 did not skip the bolt.exe under a junction" }
  if ((Get-Sha256 $junctionExe) -ne $currentHash) { throw "install.ps1 wrote through the junction" }
  Write-Host "bolt.exe under a junction skipped"

  # Constrained Language Mode: stop early with a clear message.
  $clmScript = Join-Path $ScratchRoot "clm.ps1"
  $installText = Join-Path $Root "install.ps1"
  [System.IO.File]::WriteAllText($clmScript, "`$ExecutionContext.SessionState.LanguageMode = 'ConstrainedLanguage'`nInvoke-Expression (Get-Content -Raw -LiteralPath '$installText')`n")
  # Windows PowerShell 5.1 turns redirected native stderr into an error under Stop.
  $savedEap = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $clmOut = (& $HostExe -NoProfile -ExecutionPolicy Bypass -File $clmScript 2>&1 | Out-String) -replace '\s+', ' '
  } finally {
    $ErrorActionPreference = $savedEap
  }
  Write-Host $clmOut
  if ($LASTEXITCODE -eq 0) { throw "install.ps1 succeeded in Constrained Language Mode" }
  if ($clmOut -notmatch "needs PowerShell FullLanguage mode") { throw "install.ps1 did not explain Constrained Language Mode" }
  Write-Host "Constrained Language Mode reported"

  $raw = Get-RawPath ([Microsoft.Win32.Registry]::CurrentUser) $EnvKeyPath
  if ($raw.Value -cne $wantRaw -or $raw.Kind -ne [Microsoft.Win32.RegistryValueKind]::ExpandString) {
    throw "user Path changed during the later cases: $($raw.Value) ($($raw.Kind))"
  }

  Write-Host "windows install and self-update ok"
  $Failed = $false
} finally {
  Set-RawPath ([Microsoft.Win32.Registry]::CurrentUser) $EnvKeyPath $SavedUserPath
  Set-RawPath ([Microsoft.Win32.Registry]::LocalMachine) $MachineKeyPath $SavedMachinePath
  foreach ($dir in @($LegacyDir, (Split-Path -Parent $CustomDir), $ScratchRoot)) {
    if (Test-Path -LiteralPath $dir) { Remove-Item -LiteralPath $dir -Recurse -Force -ErrorAction SilentlyContinue }
  }
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
