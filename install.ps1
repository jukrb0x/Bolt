# Install bolt for Windows.
#   irm https://raw.githubusercontent.com/jukrb0x/Bolt/main/install.ps1 | iex
# The binary is bolt-win-x64.exe, installed as %USERPROFILE%\.bolt\bin\bolt.exe.
# If a bolt.exe is already on PATH, that copy is updated in place instead.
# Re-running this script renames a running bolt.exe aside before replacing it.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
# Registry, .NET, and Win32 calls below need FullLanguage. Constrained Language Mode
# (AppLocker/WDAC) blocks them, so stop with a clear message instead of failing halfway.
if ($ExecutionContext.SessionState.LanguageMode -ne 'FullLanguage') {
  throw ("install.ps1 needs PowerShell FullLanguage mode, but this session is in " +
    "$($ExecutionContext.SessionState.LanguageMode). Download bolt-win-x64.exe and SHA256SUMS from " +
    "https://github.com/jukrb0x/Bolt/releases/latest, check the hash, save it as " +
    "%USERPROFILE%\.bolt\bin\bolt.exe, and add that directory to your user Path.")
}
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

if (-not ('BoltInstall.Native' -as [type])) {
  try {
    Add-Type -Namespace BoltInstall -Name Native -MemberDefinition @'
[DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
public static extern uint GetLongPathName(string shortPath, System.Text.StringBuilder longPath, uint bufferSize);
[DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
public static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint msg, UIntPtr wParam, string lParam, uint flags, uint timeout, out UIntPtr result);
'@ -ErrorAction Stop
  } catch {
    Write-Host "Note: could not load Win32 helpers ($($_.Exception.Message)). Continuing without them."
  }
}

# Compare directories by their expanded, absolute, long-name form, without a trailing '\'.
function Get-NormalDir([string]$Path) {
  if (-not $Path -or -not $Path.Trim()) { return '' }
  $p = [Environment]::ExpandEnvironmentVariables($Path.Trim().Trim('"'))
  try { $p = [System.IO.Path]::GetFullPath($p) } catch { return $p.TrimEnd('\').ToLowerInvariant() }
  if (('BoltInstall.Native' -as [type]) -and (Test-Path -LiteralPath $p)) {
    $sb = New-Object System.Text.StringBuilder 1024
    $n = [BoltInstall.Native]::GetLongPathName($p, $sb, 1024)
    if ($n -gt 0 -and $n -lt 1024) { $p = $sb.ToString() }
  }
  return $p.TrimEnd('\').ToLowerInvariant()
}

# Run `<exe> version` with a timeout. Returns the trimmed stdout, or $null on failure.
# stderr is captured separately so it never counts as an error or as output.
function Invoke-VersionProbe([string]$Exe, [int]$TimeoutMs = 15000) {
  $ErrorActionPreference = 'Continue'
  try {
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $Exe
    $psi.Arguments = 'version'
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.RedirectStandardInput = $true
    $psi.CreateNoWindow = $true
    $proc = [System.Diagnostics.Process]::Start($psi)
    $proc.StandardInput.Close()
    $stdout = $proc.StandardOutput.ReadToEndAsync()
    $null = $proc.StandardError.ReadToEndAsync()
    if (-not $proc.WaitForExit($TimeoutMs)) {
      # Kill the whole tree so a child of the probed exe cannot keep running.
      try {
        if ($PSVersionTable.PSVersion.Major -ge 7) { $proc.Kill($true) }
        else { & taskkill.exe /PID $proc.Id /T /F 2>&1 | Out-Null }
      } catch {
        try { $proc.Kill() } catch { }
      }
      return $null
    }
    $proc.WaitForExit()
    if ($proc.ExitCode -ne 0) { return $null }
    $text = [regex]::Replace($stdout.Result, [char]27 + '\[[0-9;]*m', '')
    return $text.Trim()
  } catch {
    return $null
  }
}

# True for a symlink or junction at $Path or any ancestor directory. Other reparse
# points (OneDrive placeholders, dedup) are normal files and do not count.
function Test-LinkedPath([string]$Path) {
  $cur = $Path
  while ($cur) {
    try {
      $item = Get-Item -LiteralPath $cur -Force -ErrorAction Stop
      if ($item.LinkType -eq 'SymbolicLink' -or $item.LinkType -eq 'Junction') { return $true }
    } catch { }
    $parent = [System.IO.Path]::GetDirectoryName($cur)
    if (-not $parent -or $parent -eq $cur) { break }
    $cur = $parent
  }
  return $false
}

# Update a bolt.exe that is already on PATH instead of installing a second copy.
# Package-manager copies (npm, winget, scoop, chocolatey) are left to their manager.
function Test-ManagedPath([string]$Path) {
  $p = $Path.Replace('\', '/').ToLower()
  return ($p.Contains('/node_modules/') -or $p.Contains('/winget/packages/') -or
    $p.Contains('/microsoft/winget/') -or $p.Contains('/scoop/apps/') -or $p.Contains('/scoop/shims/') -or
    $p.Contains('/chocolatey/'))
}
$Existing = Get-Command bolt -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
if ($Existing -and $Existing.Source) {
  $ExistingPath = [System.IO.Path]::GetFullPath($Existing.Source)
  $ExistingDir = [System.IO.Path]::GetDirectoryName($ExistingPath)
  if ([System.IO.Path]::GetFileName($ExistingPath) -ine 'bolt.exe') {
    Write-Host "Ignoring $ExistingPath on PATH: not bolt.exe."
  } elseif ($env:LOCALAPPDATA -and ((Get-NormalDir $ExistingDir) -eq (Get-NormalDir (Join-Path $env:LOCALAPPDATA 'bolt\bin')))) {
    Write-Host "Found the v2.1.x install at $ExistingPath. Installing to $DefaultDir instead."
  } elseif (Test-ManagedPath $ExistingPath) {
    Write-Host "Ignoring $ExistingPath on PATH: it belongs to a package manager. Update it with that manager."
  } elseif (Test-LinkedPath $ExistingPath) {
    Write-Host "Ignoring $ExistingPath on PATH: it is a symlink or junction, or sits under one. Installing to $DefaultDir."
  } else {
    $ExistingVersion = Invoke-VersionProbe $ExistingPath
    if ($ExistingVersion -and $ExistingVersion -match '^[0-9]+\.[0-9]+\.[0-9]+[0-9A-Za-z.+-]*$') {
      $Probe = Join-Path $ExistingDir ("bolt-install-probe-" + [guid]::NewGuid().ToString('n'))
      try {
        [System.IO.File]::WriteAllText($Probe, '')
        Remove-Item -LiteralPath $Probe -Force -ErrorAction SilentlyContinue
        $DestDir = $ExistingDir
        Write-Host "Found bolt $ExistingVersion at $ExistingPath. Updating it in place."
      } catch {
        Write-Host "Ignoring $ExistingPath on PATH: $ExistingDir is not writable. Installing to $DefaultDir."
      }
    } else {
      Write-Host "Ignoring $ExistingPath on PATH: it did not print a bolt version."
    }
  }
}
$IsDefaultDir = ((Get-NormalDir $DestDir) -eq (Get-NormalDir $DefaultDir))
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
  $Version = Invoke-VersionProbe $DownloadPath
  if (-not $Version -or $Version -notmatch '^[0-9A-Za-z.+-]+$') {
    throw "Downloaded bolt failed to run or printed an unexpected version. The existing bolt was not replaced."
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

if ($IsDefaultDir) {
  # Put the install dir first so it wins over a v2.1.x %LOCALAPPDATA%\bolt\bin entry.
  # Read and write the raw registry value: GetEnvironmentVariable expands %VAR% entries
  # and SetEnvironmentVariable writes REG_SZ, which would break entries like %USERPROFILE%\x.
  $EnvKey = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment', $true)
  if (-not $EnvKey) { $EnvKey = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Environment') }
  try {
    $UserPath = [string]$EnvKey.GetValue('Path', '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
    $Want = Get-NormalDir $DestDir
    $PathEntries = @()
    if ($UserPath) { $PathEntries = @($UserPath -split ';') }
    $First = @($PathEntries | Where-Object { $_.Trim() } | Select-Object -First 1)
    if ($First.Count -eq 0 -or (Get-NormalDir $First[0]) -ne $Want) {
      # Keep every other entry as written, including %VAR% text, duplicates, and empties.
      $Rest = @($PathEntries | Where-Object { -not $_.Trim() -or (Get-NormalDir $_) -ne $Want })
      while ($Rest.Count -gt 0 -and -not $Rest[0].Trim()) { $Rest = @($Rest | Select-Object -Skip 1) }
      $NewPath = (@($DestDir) + $Rest) -join ';'
      if ($NewPath -cne $UserPath) {
        $EnvKey.SetValue('Path', $NewPath, [Microsoft.Win32.RegistryValueKind]::ExpandString)
        $Broadcast = $false
        if ('BoltInstall.Native' -as [type]) {
          try {
            $res = [UIntPtr]::Zero
            # HWND_BROADCAST, WM_SETTINGCHANGE, SMTO_ABORTIFHUNG, 5 s.
            $null = [BoltInstall.Native]::SendMessageTimeout([IntPtr]0xffff, 0x1A, [UIntPtr]::Zero, 'Environment', 2, 5000, [ref]$res)
            $Broadcast = $true
          } catch { }
        }
        if (-not $Broadcast) {
          # Setting a user variable through .NET broadcasts WM_SETTINGCHANGE for us.
          [Environment]::SetEnvironmentVariable('BOLT_INSTALL_PATH_REFRESH', '1', 'User')
          [Environment]::SetEnvironmentVariable('BOLT_INSTALL_PATH_REFRESH', $null, 'User')
        }
        Write-Host "Added $DestDir to the front of your user Path. Open a new terminal."
      }
    }
  } finally {
    $EnvKey.Close()
  }
}

# Windows puts the system Path before the user Path, so a bolt there wins in a new terminal.
$FreshPath = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
$Exts = @('.exe')
if ($env:PATHEXT) { $Exts = @($env:PATHEXT -split ';' | Where-Object { $_ }) }
$Resolved = $null
foreach ($Dir in @($FreshPath -split ';' | Where-Object { $_.Trim() })) {
  foreach ($Ext in $Exts) {
    try { $Candidate = Join-Path ([Environment]::ExpandEnvironmentVariables($Dir.Trim().Trim('"'))) ("bolt" + $Ext) } catch { continue }
    if (Test-Path -LiteralPath $Candidate -PathType Leaf) { $Resolved = $Candidate; break }
  }
  if ($Resolved) { break }
}
if ($Resolved -and ((Get-NormalDir $Resolved) -ne (Get-NormalDir $Dest))) {
  Write-Host "Warning: a new terminal will run $Resolved, not $Dest. It comes first on your system or user Path. Remove it or move $DestDir ahead of it."
}

# v2.1.0 to v2.1.2 installed to %LOCALAPPDATA%\bolt\bin. Do not delete it, just say so.
if ($env:LOCALAPPDATA) {
  $LegacyDir = Join-Path $env:LOCALAPPDATA 'bolt\bin'
  if ((Test-Path -LiteralPath $LegacyDir) -and ((Get-NormalDir $LegacyDir) -ne (Get-NormalDir $DestDir))) {
    Write-Host "Note: $LegacyDir is from bolt v2.1.x and is no longer used. You can delete it and remove it from your user Path."
  }
}

Write-Host "Installed $Asset to $Dest ($Version)"
