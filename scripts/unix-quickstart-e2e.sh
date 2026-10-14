#!/usr/bin/env bash
# README quickstart against the bolt that install.sh just installed.
#
# The binary comes from the local release directory (build/ in CI, the same
# artifacts the binaries workflow uploaded). install.sh is fetched with curl
# and piped to sh, which is how the README runs it. BOLT_INSTALL_BASE points
# at that directory over http://127.0.0.1, the override install.sh and
# self-update already accept. A public /releases/latest install is a different
# workflow: it runs after Release, and a pull request is not published yet.
#
# curl does not set com.apple.quarantine. Gatekeeper applies that check to
# files a browser downloaded. This script checks the flag is absent on macOS.
set -euo pipefail

# A final release outranks a prerelease of the same core. See compareVersions.
next_version() {
  local ver="$1" core major rest minor patch
  core=${ver%%-*}
  if [ "$core" != "$ver" ]; then
    printf '%s\n' "$core"
    return
  fi
  major=${core%%.*}
  rest=${core#*.}
  minor=${rest%%.*}
  patch=${rest#*.}
  printf '%s.%s.%s\n' "$major" "$minor" "$((patch + 1))"
}

# Trap state. Globals so the EXIT trap still sees them after main returns.
QS_ROOT=""
QS_SERVE=""
QS_SERVER_PID=""
QS_VERSION_BACKUP=""
QS_WORK=""

main() {
  local root asset log port install_out install_status path_line resolved expected
  local want flag newer before after hash n ready i
  root=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
  QS_ROOT=$root
  cd "$root"

  case "$(uname -s)-$(uname -m)" in
    Linux-x86_64) asset=bolt-linux-x64 ;;
    Darwin-arm64 | Darwin-aarch64) asset=bolt-mac-arm64 ;;
    Darwin-x86_64) asset=bolt-mac-x64 ;;
    *)
      echo "unsupported platform: $(uname -s) $(uname -m)" >&2
      exit 1
      ;;
  esac

  if [ ! -f "build/$asset" ] || [ ! -f build/SHA256SUMS ]; then
    echo "missing build/$asset or build/SHA256SUMS. The binaries job uploads these." >&2
    exit 1
  fi
  chmod +x "build/$asset"
  want=$("build/$asset" version | tr -d '[:space:]')
  flag=$("build/$asset" --version | tr -d '[:space:]')
  if [ "$want" != "$flag" ]; then
    echo "build/$asset version ($want) and --version ($flag) disagree" >&2
    exit 1
  fi

  QS_SERVE=$(mktemp -d "${TMPDIR:-/tmp}/bolt-quickstart-serve.XXXXXX")
  log="$QS_SERVE/http.log"
  cleanup() {
    if [ -n "$QS_SERVER_PID" ]; then
      kill "$QS_SERVER_PID" 2>/dev/null || true
      wait "$QS_SERVER_PID" 2>/dev/null || true
    fi
    if [ -n "$QS_VERSION_BACKUP" ] && [ -f "$QS_VERSION_BACKUP" ]; then
      cp "$QS_VERSION_BACKUP" "$QS_ROOT/src/version.ts"
      rm -f "$QS_VERSION_BACKUP"
    fi
    if [ -n "$QS_WORK" ]; then
      rm -rf "$QS_WORK"
    fi
    if [ -n "$QS_SERVE" ]; then
      rm -rf "$QS_SERVE"
    fi
  }
  trap cleanup EXIT

  mkdir -p "$QS_SERVE/current"
  cp "build/$asset" "$QS_SERVE/current/$asset"
  cp build/SHA256SUMS "$QS_SERVE/current/SHA256SUMS"
  cp install.sh "$QS_SERVE/install.sh"

  if ! command -v python3 >/dev/null 2>&1; then
    echo "python3 is required to serve the local release" >&2
    exit 1
  fi
  port=8766
  n=0
  while [ "$n" -lt 5 ]; do
    python3 -m http.server "$port" --bind 127.0.0.1 --directory "$QS_SERVE" >"$log" 2>&1 &
    QS_SERVER_PID=$!
    sleep 0.3
    if kill -0 "$QS_SERVER_PID" 2>/dev/null; then
      break
    fi
    QS_SERVER_PID=""
    port=$((port + 1))
    n=$((n + 1))
  done
  if [ -z "$QS_SERVER_PID" ]; then
    echo "could not bind a port for the local release" >&2
    cat "$log" >&2 || true
    exit 1
  fi

  ready=0
  for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
    if curl -fsS "http://127.0.0.1:${port}/install.sh" >/dev/null &&
      curl -fsSI "http://127.0.0.1:${port}/current/${asset}" >/dev/null; then
      ready=1
      break
    fi
    sleep 0.2
  done
  if [ "$ready" -ne 1 ]; then
    echo "local release server did not start" >&2
    cat "$log" >&2 || true
    exit 1
  fi

  # curl | sh, same shape as the README. BOLT_INSTALL_BASE is the local release.
  set +e
  install_out=$(
    curl -fsSL "http://127.0.0.1:${port}/install.sh" |
      BOLT_INSTALL_BASE="http://127.0.0.1:${port}/current" sh 2>&1
  )
  install_status=$?
  set -e
  printf '%s\n' "$install_out"
  if [ "$install_status" -ne 0 ]; then
    echo "install.sh exited $install_status" >&2
    exit 1
  fi

  path_line='export PATH="$HOME/.bolt/bin:$PATH"'
  if printf '%s\n' "$install_out" | grep -F "$path_line" >/dev/null; then
    echo "install.sh printed the PATH export"
  elif printf '%s\n' "$install_out" | grep -F "Added ~/.bolt/bin to PATH" >/dev/null; then
    echo "install.sh appended ~/.bolt/bin to the shell rc; this process applies that same export"
  else
    echo "install.sh did not say how to put ~/.bolt/bin on PATH" >&2
    exit 1
  fi
  # The printed hint. A new shell that sourced the rc file gets the same line.
  export PATH="$HOME/.bolt/bin:$PATH"

  resolved=$(command -v bolt || true)
  expected="$HOME/.bolt/bin/bolt"
  if [ "$resolved" != "$expected" ]; then
    echo "PATH bolt is '${resolved}', expected ${expected}" >&2
    exit 1
  fi

  if [ "$(uname -s)" = "Darwin" ]; then
    # curl does not set com.apple.quarantine. A browser download would, and
    # Gatekeeper would then check the signature. xattr exits 1 when the
    # attribute is absent; that is the expected result.
    if xattr -p com.apple.quarantine "$expected" >/dev/null 2>&1; then
      echo "installed bolt has com.apple.quarantine; curl should not set it" >&2
      xattr -l "$expected" >&2 || true
      exit 1
    fi
    echo "note: curl did not set com.apple.quarantine on ${expected}. Gatekeeper does not treat this install as a downloaded app."
  fi

  QS_WORK=$(mktemp -d "${TMPDIR:-/tmp}/bolt-quickstart.XXXXXX")
  (
    cd "$QS_WORK"
    got=$(bolt --version | tr -d '[:space:]')
    printf 'bolt --version: %s\n' "$got"
    if [ "$got" != "$want" ]; then
      echo "bolt --version printed '$got', expected '$want'" >&2
      exit 1
    fi
    bolt init
    test -f bolt.yaml
    dry=$(bolt run demo --dry-run)
    printf '%s\n' "$dry"
    case "$dry" in
      *"would run:"*) ;;
      *)
        echo "bolt run demo --dry-run did not preview the step" >&2
        exit 1
        ;;
    esac
    case "$dry" in
      *"hello from"*) ;;
      *)
        echo "bolt run demo --dry-run did not mention hello from" >&2
        exit 1
        ;;
    esac
    run=$(bolt run demo)
    printf '%s\n' "$run"
    hello=""
    while IFS= read -r line; do
      case "$line" in
        "hello from "*)
          hello=$line
          break
          ;;
      esac
    done <<END_RUN
$run
END_RUN
    if [ -z "$hello" ]; then
      echo "bolt run demo did not print a 'hello from' line" >&2
      exit 1
    fi
    echo "quickstart: $hello"
  )

  if [ "${BOLT_QUICKSTART_SELF_UPDATE:-}" != "1" ]; then
    exit 0
  fi
  if [ "$(uname -s)" != "Linux" ]; then
    echo "self-update check runs on Linux" >&2
    exit 1
  fi
  if ! command -v bun >/dev/null 2>&1; then
    echo "bun is required to build the self-update target" >&2
    exit 1
  fi
  newer=$(next_version "$want")
  QS_VERSION_BACKUP=$(mktemp)
  cp src/version.ts "$QS_VERSION_BACKUP"
  sed -i "s/export const VERSION = \"[^\"]*\"/export const VERSION = \"${newer}\"/" src/version.ts
  grep -q "export const VERSION = \"${newer}\"" src/version.ts
  # build-binary.ts joins this path onto the repo root. An absolute path would
  # land under the repo instead of the serve directory.
  mkdir -p build/quickstart-newer "$QS_SERVE/newer"
  bun run scripts/build-binary.ts bun-linux-x64 "build/quickstart-newer/$asset"
  cp "build/quickstart-newer/$asset" "$QS_SERVE/newer/$asset"
  rm -rf build/quickstart-newer
  hash=$(sha256sum "$QS_SERVE/newer/$asset" | awk '{ print $1 }')
  printf '%s  %s\n' "$hash" "$asset" >"$QS_SERVE/newer/SHA256SUMS"
  before=$(bolt --version | tr -d '[:space:]')
  BOLT_INSTALL_BASE="http://127.0.0.1:${port}/newer" bolt self-update
  after=$(bolt --version | tr -d '[:space:]')
  printf 'self-update %s -> %s\n' "$before" "$after"
  if [ "$after" = "$before" ] || [ "$after" != "$newer" ]; then
    echo "self-update left version '$after' (was '$before', target '$newer')" >&2
    exit 1
  fi
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  main "$@"
fi
