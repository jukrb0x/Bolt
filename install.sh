#!/usr/bin/env bash
# Bolt installer for macOS/Linux
# Usage: curl -fsSL https://raw.githubusercontent.com/jukrb0x/Bolt/main/install.sh | bash
# Or: ./install.sh

set -euo pipefail

REPO="jukrb0x/Bolt"
BIN_DIR="$HOME/.bolt/bin"
BOLT_HOME="$HOME/.bolt"

echo "Installing bolt..."

# Fetch latest release JSON
RELEASE=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest")
VERSION=$(echo "$RELEASE" | grep '"tag_name"' | sed 's/.*"tag_name": *"\([^"]*\)".*/\1/')

# Find download URLs
BINARY_URL=$(echo "$RELEASE" | grep '"browser_download_url"' | grep 'bolt-mac-arm64"' | sed 's/.*"browser_download_url": *"\([^"]*\)".*/\1/')
DTS_URL=$(echo "$RELEASE" | grep '"browser_download_url"' | grep 'bolt\.d\.ts"' | sed 's/.*"browser_download_url": *"\([^"]*\)".*/\1/')

if [ -z "$BINARY_URL" ]; then
    echo "Error: bolt-mac-arm64 not found in release $VERSION" >&2
    exit 1
fi

# Create dirs
mkdir -p "$BIN_DIR"

# Download binary — rename to 'bolt' (no platform suffix in PATH)
echo "Downloading bolt $VERSION..."
curl -fsSL "$BINARY_URL" -o "$BIN_DIR/bolt"
chmod +x "$BIN_DIR/bolt"

# Download bolt.d.ts to ~/.bolt/ (for plugin IDE support)
if [ -n "$DTS_URL" ]; then
    curl -fsSL "$DTS_URL" -o "$BOLT_HOME/bolt.d.ts"
    echo "bolt.d.ts placed at $BOLT_HOME/bolt.d.ts"
fi

# Add ~/.bolt/bin to PATH in shell rc
SHELL_RC=""
if [ -f "$HOME/.zshrc" ]; then
    SHELL_RC="$HOME/.zshrc"
elif [ -f "$HOME/.bashrc" ]; then
    SHELL_RC="$HOME/.bashrc"
fi

PATH_LINE='export PATH="$HOME/.bolt/bin:$PATH"'
if [ -n "$SHELL_RC" ] && ! grep -q '.bolt/bin' "$SHELL_RC" 2>/dev/null; then
    echo "" >> "$SHELL_RC"
    echo "# bolt" >> "$SHELL_RC"
    echo "$PATH_LINE" >> "$SHELL_RC"
    echo "Added ~/.bolt/bin to PATH in $SHELL_RC"
fi

echo ""
echo "bolt $VERSION installed to $BIN_DIR/bolt"
echo ""
echo "Run: source $SHELL_RC && bolt version"
