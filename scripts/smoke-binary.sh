#!/usr/bin/env bash
# Run a bolt binary: print version, then load a TypeScript plugin.
# Usage: scripts/smoke-binary.sh <binary> [expected-version]
set -euo pipefail

bin=${1:?binary path required}
expected=${2:-}
bin="$(cd "$(dirname "$bin")" && pwd)/$(basename "$bin")"

if [ ! -f "$bin" ]; then
  echo "binary not found: $bin" >&2
  exit 1
fi
chmod +x "$bin" 2>/dev/null || true

version=$("$bin" version | tr -d '\r\n')
echo "version: $version"
if [ -n "$expected" ]; then
  if [ "$version" != "$expected" ]; then
    echo "expected version $expected, got $version" >&2
    exit 1
  fi
else
  printf '%s\n' "$version" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]+)?$'
fi

dir=$(mktemp -d)
trap 'rm -rf "$dir"' EXIT
mkdir -p "$dir/plugin"

cat >"$dir/bolt.yaml" <<'EOF'
version: 1
project:
  name: Smoke
plugins:
  - namespace: smoke
    path: ./plugin/index.ts
EOF

cat >"$dir/plugin/index.ts" <<'EOF'
import { defineHandler, definePlugin } from "boltstack";

export default definePlugin({
  namespace: "smoke",
  version: "0.0.1",
  description: "CI smoke plugin",
  handlers: {
    ping: defineHandler({ description: "ping" }, async () => {}),
  },
});
EOF

list=$(cd "$dir" && "$bin" plugin list | sed $'s/\x1b\[[0-9;]*m//g')
printf '%s\n' "$list"
printf '%s\n' "$list" | grep -q 'smoke/ping'
echo "smoke plugin loaded"
