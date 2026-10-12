#!/bin/sh
bun "$BOLT_FAKE_RECORD" "$0" "$@"
status=$?
if [ "$status" -ne 0 ]; then
  exit "$status"
fi
here=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
ubt="$here/../../Binaries/DotNET/UnrealBuildTool.sh"
if [ -x "$ubt" ]; then
  exec "$ubt" "$@"
fi
echo "UnrealBuildTool.sh is not executable: $ubt" >&2
exit 1
