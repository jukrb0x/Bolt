#!/bin/sh
bun "$BOLT_FAKE_RECORD" "$0" "$@"
status=$?
if [ "$status" -ne 0 ]; then
  exit "$status"
fi
here=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
# UE5 keeps UnrealBuildTool in its own folder. UE4 has it directly in DotNET.
ubt="$here/../../Binaries/DotNET/UnrealBuildTool/UnrealBuildTool.sh"
if [ ! -e "$ubt" ]; then
  ubt="$here/../../Binaries/DotNET/UnrealBuildTool.sh"
fi
if [ -x "$ubt" ]; then
  exec "$ubt" "$@"
fi
echo "UnrealBuildTool.sh is not executable: $ubt" >&2
exit 1
