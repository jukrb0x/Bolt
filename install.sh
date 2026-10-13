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
# Strip trailing slashes so "$HOME/" and "$HOME" give the same paths.
HOME_DIR=$(printf '%s' "$HOME" | sed 's:/*$::')
DEFAULT_DEST="${HOME_DIR}/.bolt/bin"
DEST="$DEFAULT_DEST"

# Print a directory as an absolute physical path without a trailing slash.
norm_dir() {
  (cd "$1" 2>/dev/null && pwd -P) || printf '%s\n' "$1" | sed 's:/*$::'
}

# Run "<bolt> version" with a timeout. stdin is /dev/null and stderr is discarded. Uses timeout(1) or
# gtimeout (Homebrew coreutils on macOS), else a background job that is killed.
PROBE_TIMEOUT="${BOLT_INSTALL_PROBE_TIMEOUT:-15}"
probe_version() {
  if command -v timeout >/dev/null 2>&1; then
    timeout "$PROBE_TIMEOUT" "$1" version </dev/null 2>/dev/null
  elif command -v gtimeout >/dev/null 2>&1; then
    gtimeout "$PROBE_TIMEOUT" "$1" version </dev/null 2>/dev/null
  else
    probe_out=$(mktemp)
    # Monitor mode puts the probe in its own process group so a timeout kills its children too.
    set -m 2>/dev/null || true
    "$1" version </dev/null >"$probe_out" 2>/dev/null &
    probe_pid=$!
    set +m 2>/dev/null || true
    (
      # set -e from the script must not stop the watcher before it kills the probe.
      set +e
      trap 'kill "$probe_sleep" 2>/dev/null; exit 0' TERM
      sleep "$PROBE_TIMEOUT" &
      probe_sleep=$!
      wait "$probe_sleep"
      # Whole process group when monitor mode gave the probe one, else its children, then it.
      if ! kill -9 -"$probe_pid" 2>/dev/null; then
        pkill -9 -P "$probe_pid" 2>/dev/null
        kill -9 "$probe_pid" 2>/dev/null
      fi
      exit 0
    ) >/dev/null 2>&1 &
    probe_watch=$!
    probe_status=0
    # The shell reports a killed job ("Killed") on wait; keep that off the terminal.
    { wait "$probe_pid"; } 2>/dev/null || probe_status=$?
    kill "$probe_watch" 2>/dev/null || true
    { wait "$probe_watch"; } 2>/dev/null || true
    if [ "$probe_status" -eq 0 ]; then cat "$probe_out"; fi
    rm -f "$probe_out"
    return "$probe_status"
  fi
}

# Package-manager copies (npm, Homebrew, chocolatey) are left to their manager.
is_managed_path() {
  case "$1" in
    */node_modules/* | */Cellar/* | */cellar/* | */homebrew/* | */Homebrew/* | */linuxbrew/* | */chocolatey/*) return 0 ;;
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
      existing_version=$(probe_version "$existing" | tr -d '[:space:]' || true)
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
RECEIPT="${HOME_DIR}/.bolt/install.json"

mkdir -p "$DEST" "${HOME_DIR}/.bolt"
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
if ! version=$("${DEST}/bolt.new" version </dev/null); then
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
if [ "$(norm_dir "$DEST")" = "$(norm_dir "$DEFAULT_DEST")" ]; then
  case "${SHELL:-}" in
    */zsh) SHELL_RC="${HOME_DIR}/.zshrc" ;;
    */bash)
      if [ "$(uname -s)" = "Darwin" ]; then
        # Terminal.app starts bash as a login shell, which reads the first of these.
        SHELL_RC="${HOME_DIR}/.bash_profile"
        for f in "${HOME_DIR}/.bash_profile" "${HOME_DIR}/.bash_login" "${HOME_DIR}/.profile"; do
          if [ -f "$f" ]; then
            SHELL_RC="$f"
            break
          fi
        done
      else
        SHELL_RC="${HOME_DIR}/.bashrc"
      fi
      ;;
    *)
      if [ -f "${HOME_DIR}/.zshrc" ]; then
        SHELL_RC="${HOME_DIR}/.zshrc"
      elif [ -f "${HOME_DIR}/.bashrc" ]; then
        SHELL_RC="${HOME_DIR}/.bashrc"
      elif [ -f "${HOME_DIR}/.profile" ]; then
        SHELL_RC="${HOME_DIR}/.profile"
      fi
      ;;
  esac
  if [ -n "$SHELL_RC" ]; then
    # Accept our exact line or any uncommented line that already mentions .bolt/bin.
    if ! grep -Fx "$PATH_LINE" "$SHELL_RC" >/dev/null 2>&1 &&
      ! grep -E '^[[:space:]]*[^#[:space:]][^#]*\.bolt/bin' "$SHELL_RC" >/dev/null 2>&1; then
      printf '\n%s\n' "$PATH_LINE" >>"$SHELL_RC"
      echo "Added ~/.bolt/bin to PATH in $SHELL_RC"
    fi
  else
    echo "Add this to your shell profile:"
    echo "  $PATH_LINE"
  fi
fi

# Another bolt earlier on PATH would still win. Say so instead of failing silently.
# When the rc file has our PATH line, new shells put ~/.bolt/bin first, so check that PATH.
check_path="$PATH"
if [ -n "$SHELL_RC" ]; then
  check_path="${DEST}:${PATH}"
fi
resolved=$(PATH="$check_path" command -v bolt 2>/dev/null || true)
case "$resolved" in
  /*)
    if [ "$(norm_dir "$(dirname "$resolved")")/$(basename "$resolved")" != "$(norm_dir "$DEST")/bolt" ]; then
      echo "Warning: bolt on your PATH is ${resolved}, not ${installed_path}. It comes first on PATH. Remove it or put $(dirname "$installed_path") ahead of it."
    fi
    ;;
esac

echo "Installed ${ASSET} to ${DEST}/bolt (${version})"
echo "Open a new shell, then run: bolt version"
