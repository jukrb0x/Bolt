# Bolt installer for Windows
# Usage: irm https://raw.githubusercontent.com/jukrb0x/Bolt/main/install.ps1 | iex
# Or: .\install.ps1

$ErrorActionPreference = "Stop"

$REPO = "jukrb0x/Bolt"
$BIN_DIR = "$env:USERPROFILE\.bolt\bin"
$BOLT_HOME = "$env:USERPROFILE\.bolt"

Write-Host "Installing bolt..." -ForegroundColor Cyan

# Fetch latest release
$release = Invoke-RestMethod "https://api.github.com/repos/$REPO/releases/latest"
$version = $release.tag_name

# Find assets
$exeAsset = $release.assets | Where-Object { $_.name -eq "bolt-win-x64.exe" } | Select-Object -First 1
$dtsAsset = $release.assets | Where-Object { $_.name -eq "bolt.d.ts" } | Select-Object -First 1

if (-not $exeAsset) {
    throw "bolt-win-x64.exe not found in release $version"
}

# Create install dirs
New-Item -ItemType Directory -Force -Path $BIN_DIR | Out-Null

# Download binary (rename to bolt.exe — no platform suffix in PATH)
Write-Host "Downloading bolt $version..." -ForegroundColor Cyan
Invoke-WebRequest -Uri $exeAsset.browser_download_url -OutFile "$BIN_DIR\bolt.exe" -UseBasicParsing

# Download bolt.d.ts to ~/.bolt/ (for plugin IDE support)
if ($dtsAsset) {
    Invoke-WebRequest -Uri $dtsAsset.browser_download_url -OutFile "$BOLT_HOME\bolt.d.ts" -UseBasicParsing
    Write-Host "bolt.d.ts placed at $BOLT_HOME\bolt.d.ts"
} else {
    Write-Host "Note: bolt.d.ts not found in release, skipping."
}

# Add ~/.bolt/bin to user PATH if not already present
$currentPath = [Environment]::GetEnvironmentVariable("PATH", "User")
if (-not $currentPath) { $currentPath = "" }
if ($currentPath -notlike "*$BIN_DIR*") {
    [Environment]::SetEnvironmentVariable("PATH", "$currentPath;$BIN_DIR", "User")
    Write-Host "Added $BIN_DIR to user PATH" -ForegroundColor Green
    Write-Host "Restart your terminal for PATH changes to take effect." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "bolt $version installed to $BIN_DIR\bolt.exe" -ForegroundColor Green
Write-Host ""
Write-Host "Run: bolt version"
