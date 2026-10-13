#!/bin/sh
# Install bolt for macOS or Linux.
#   curl -fsSL https://raw.githubusercontent.com/jukrb0x/Bolt/main/install.sh | sh
# Intel macOS installs bolt-mac-x64. Apple Silicon installs bolt-mac-arm64.
# Installs to ~/.bolt/bin/bolt. If a bolt is already on PATH, that copy is updated in place.
set -eu

REPO="jukrb0x/Bolt"
BASE="https://github.com/${REPO}/releases/latest/download"
# Tests point BOLT_INSTALL_BASE at a local release directory.
if [ -n "${BOLT_INSTALL_BASE:-}" ]; then
  BASE="${BOLT_INSTALL_BASE%/}"
fi

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
DEFAULT_DEST="${HOME}/.bolt/bin"
DEST="$DEFAULT_DEST"

# Package-manager copies (npm, Homebrew) are left to their manager.
is_managed_path() {
  case "$1" in
    */node_modules/* | */Cellar/* | */cellar/* | */homebrew/* | */Homebrew/* | */linuxbrew/*) return 0 ;;
  esac
  return 1
}

# Update a bolt that is already on PATH instead of installing a second copy.
existing=$(command -v bolt 2>/dev/null || true)
case "$existing" in
  /*)
    existing_dir=$(dirname "$existing")
    if [ -L "$existing" ]; then
      echo "Ignoring ${existing} on PATH: it is a symlink. Installing to ${DEFAULT_DEST}."
    elif is_managed_path "$existing"; then
      echo "Ignoring ${existing} on PATH: it belongs to a package manager. Update it with that manager."
    elif [ ! -f "$existing" ] || [ ! -w "$existing_dir" ]; then
      echo "Ignoring ${existing} on PATH: ${existing_dir} is not writable. Installing to ${DEFAULT_DEST}."
    else
      existing_version=$("$existing" version 2>/dev/null | tr -d '[:space:]' || true)
      case "$existing_version" in
        [0-9]*.[0-9]*.[0-9]*)
          case "$existing_version" in
            *[!0-9A-Za-z.+-]*) echo "Ignoring ${existing} on PATH: it did not print a bolt version." ;;
            *)
              DEST="$existing_dir"
              echo "Found bolt ${existing_version} at ${existing}. Updating it in place."
              ;;
          esac
          ;;
        *) echo "Ignoring ${existing} on PATH: it did not print a bolt version." ;;
      esac
    fi
    ;;
esac
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

# Run the download before replacing a working bolt. A bad version leaves the old file in place.
cp "${TMP}/${ASSET}" "${DEST}/bolt.new"
chmod 755 "${DEST}/bolt.new"
if ! version=$("${DEST}/bolt.new" version); then
  rm -f "${DEST}/bolt.new"
  echo "Downloaded bolt failed to run. The existing bolt was not replaced." >&2
  exit 1
fi
version=$(printf '%s' "$version" | tr -d '[:space:]')
case "$version" in
  "" | *[!0-9A-Za-z.+-]*)
    rm -f "${DEST}/bolt.new"
    echo "Downloaded bolt printed an unexpected version. The existing bolt was not replaced." >&2
    exit 1
    ;;
esac
mv -f "${DEST}/bolt.new" "${DEST}/bolt"

installed_path="${DEST}/bolt"
escaped_path=$(printf '%s' "$installed_path" | sed 's/\\/\\\\/g; s/"/\\"/g')
cat >"$RECEIPT" <<EOF
{
  "channel": "github",
  "asset": "${ASSET}",
  "version": "${version}",
  "path": "${escaped_path}"
}
EOF

PATH_LINE='export PATH="$HOME/.bolt/bin:$PATH"'
SHELL_RC=""
if [ "$DEST" = "$DEFAULT_DEST" ]; then
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
fi

echo "Installed ${ASSET} to ${DEST}/bolt (${version})"
echo "Open a new shell, then run: bolt version"
