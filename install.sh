#!/bin/sh
# Install bolt for macOS or Linux.
#   curl -fsSL https://raw.githubusercontent.com/jukrb0x/Bolt/main/install.sh | sh
# Intel macOS installs bolt-mac-x64. Apple Silicon installs bolt-mac-arm64.
set -eu

REPO="jukrb0x/Bolt"
BASE="https://github.com/${REPO}/releases/latest/download"

# Print the release asset for an OS and machine, or return 1.
resolve_asset() {
  case "$1" in
    Darwin)
      case "$2" in
        x86_64) printf '%s\n' "bolt-mac-x64" ;;
        arm64 | aarch64) printf '%s\n' "bolt-mac-arm64" ;;
        *)
          echo "Unsupported macOS architecture: $2" >&2
          return 1
          ;;
      esac
      ;;
    Linux)
      case "$2" in
        x86_64) printf '%s\n' "bolt-linux-x64" ;;
        *)
          echo "Unsupported Linux architecture: $2" >&2
          return 1
          ;;
      esac
      ;;
    *)
      echo "On Windows, install with: irm https://raw.githubusercontent.com/jukrb0x/Bolt/main/install.ps1 | iex" >&2
      return 1
      ;;
  esac
}

# Tests set BOLT_INSTALL_PRINT_ASSET=1. A normal install always uses uname.
if [ "${BOLT_INSTALL_PRINT_ASSET:-}" = "1" ]; then
  resolve_asset "${BOLT_INSTALL_OS:-$(uname -s)}" "${BOLT_INSTALL_ARCH:-$(uname -m)}"
  exit 0
fi

ASSET=$(resolve_asset "$(uname -s)" "$(uname -m)")
DEST="${HOME}/.bolt/bin"
RECEIPT="${HOME}/.bolt/install.json"

mkdir -p "$DEST" "${HOME}/.bolt"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

curl -fsSL "${BASE}/SHA256SUMS" -o "${TMP}/SHA256SUMS"
curl -fsSL "${BASE}/${ASSET}" -o "${TMP}/${ASSET}"

expected=$(awk -v asset="$ASSET" '$2 == asset { print $1; exit }' "${TMP}/SHA256SUMS" | tr 'ABCDEF' 'abcdef')
if [ -z "$expected" ]; then
  echo "SHA256SUMS has no entry for ${ASSET}" >&2
  exit 1
fi
if command -v sha256sum >/dev/null 2>&1; then
  actual=$(sha256sum "${TMP}/${ASSET}" | awk '{ print $1 }')
else
  actual=$(shasum -a 256 "${TMP}/${ASSET}" | awk '{ print $1 }')
fi
actual=$(printf '%s' "$actual" | tr 'ABCDEF' 'abcdef')
if [ "$expected" != "$actual" ]; then
  echo "Checksum mismatch for ${ASSET}" >&2
  exit 1
fi

# Copy then rename in the install directory. Replacing the inode keeps a running bolt alive.
cp "${TMP}/${ASSET}" "${DEST}/bolt.new"
chmod 755 "${DEST}/bolt.new"
mv -f "${DEST}/bolt.new" "${DEST}/bolt"
version=$("${DEST}/bolt" version)
version=$(printf '%s' "$version" | tr -d '[:space:]')
case "$version" in
  "" | *[!0-9A-Za-z.+-]*)
    echo "Installed binary printed an unexpected version" >&2
    exit 1
    ;;
esac

cat >"$RECEIPT" <<EOF
{
  "channel": "github",
  "asset": "${ASSET}",
  "version": "${version}"
}
EOF

PATH_LINE='export PATH="$HOME/.bolt/bin:$PATH"'
SHELL_RC=""
case "${SHELL:-}" in
  */zsh) SHELL_RC="$HOME/.zshrc" ;;
  */bash) SHELL_RC="$HOME/.bashrc" ;;
  *)
    if [ -f "$HOME/.zshrc" ]; then
      SHELL_RC="$HOME/.zshrc"
    elif [ -f "$HOME/.bashrc" ]; then
      SHELL_RC="$HOME/.bashrc"
    elif [ -f "$HOME/.profile" ]; then
      SHELL_RC="$HOME/.profile"
    fi
    ;;
esac
if [ -n "$SHELL_RC" ]; then
  if ! grep -F '.bolt/bin' "$SHELL_RC" >/dev/null 2>&1; then
    printf '\n%s\n' "$PATH_LINE" >>"$SHELL_RC"
    echo "Added ~/.bolt/bin to PATH in $SHELL_RC"
  fi
else
  echo "Add this to your shell profile:"
  echo "  $PATH_LINE"
fi

echo "Installed ${ASSET} to ${DEST}/bolt (${version})"
echo "Open a new shell, then run: bolt version"
