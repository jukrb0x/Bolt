#!/usr/bin/env bash
# Bolt installer for macOS (Apple Silicon)
# Usage: curl -fsSL https://raw.githubusercontent.com/jukrb0x/Bolt/main/install.sh | bash
# Or: ./install.sh

set -euo pipefail

REPO="jukrb0x/Bolt"
BIN_DIR="$HOME/.bolt/bin"
BOLT_HOME="$HOME/.bolt"

echo "Installing bolt..."

# Fetch latest release JSON
RELEASE=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest")

# Parse release JSON — prefer jq when available, fall back to grep/sed
if command -v jq &>/dev/null; then
    VERSION=$(echo "$RELEASE" | jq -r '.tag_name')
    BINARY_URL=$(echo "$RELEASE" | jq -r '.assets[] | select(.name == "bolt-mac-arm64") | .browser_download_url')
else
    VERSION=$(echo "$RELEASE" | grep '"tag_name"' | sed 's/.*"tag_name": *"\([^"]*\)".*/\1/')
    BINARY_URL=$(echo "$RELEASE" | grep '"browser_download_url"' | grep 'bolt-mac-arm64"' | sed 's/.*"browser_download_url": *"\([^"]*\)".*/\1/' | head -1)
fi

if [ -z "$VERSION" ] || [ -z "$BINARY_URL" ]; then
    echo "Error: bolt-mac-arm64 not found in latest release. Is this macOS Apple Silicon?" >&2
    exit 1
fi

# Create dirs
mkdir -p "$BIN_DIR"

# Download binary — rename to 'bolt' (no platform suffix in PATH)
echo "Downloading bolt $VERSION..."
curl -fsSL "$BINARY_URL" -o "$BIN_DIR/bolt"
chmod +x "$BIN_DIR/bolt"


# Add ~/.bolt/bin to PATH in shell rc
# Prefer the rc file matching the running shell, fall back to file existence
SHELL_RC=""
case "${SHELL:-}" in
    */zsh)  SHELL_RC="$HOME/.zshrc" ;;
    */bash) SHELL_RC="$HOME/.bashrc" ;;
    *)
        if [ -f "$HOME/.zshrc" ]; then
            SHELL_RC="$HOME/.zshrc"
        elif [ -f "$HOME/.bashrc" ]; then
            SHELL_RC="$HOME/.bashrc"
        fi
        ;;
esac

PATH_LINE='export PATH="$HOME/.bolt/bin:$PATH"'
if [ -n "$SHELL_RC" ]; then
    if ! grep -q '.bolt/bin' "$SHELL_RC" 2>/dev/null; then
        echo "" >> "$SHELL_RC"
        echo "# bolt" >> "$SHELL_RC"
        echo "$PATH_LINE" >> "$SHELL_RC"
        echo "Added ~/.bolt/bin to PATH in $SHELL_RC"
    fi
else
    echo ""
    echo "Warning: Could not detect shell rc file."
    echo "Add the following line to your shell profile manually:"
    echo "  $PATH_LINE"
fi

echo ""
echo "bolt $VERSION installed to $BIN_DIR/bolt"
echo ""
if [ -n "$SHELL_RC" ]; then
    echo "Run: source $SHELL_RC && bolt version"
else
    echo "Open a new terminal and run: bolt version"
fi
