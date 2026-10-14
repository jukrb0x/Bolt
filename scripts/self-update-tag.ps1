# Validate the release tag for the Windows self-update check and pick the mode.
# Called by .github/workflows/verify-windows-self-update.yml and run by
# src/tests/self-update-tag.test.ts under pwsh.
#
# Writes "prerelease" or "stable" to the pipeline. An invalid tag writes the reason
# to stderr and exits 1. The caller must check $LASTEXITCODE. It uses exit, not
# throw, so the message is not wrapped by pwsh's error view.
# A hyphen marks a prerelease. v2.1.0 strips that suffix before comparing, so
# the workflow passes --force for a prerelease. A stable tag takes the real
# compare-and-upgrade path, with no --force.
#
# -cnotmatch is case-sensitive: "V1.2.3" is rejected. As in SemVer, numbers have
# no leading zeros and the prerelease suffix is dot-separated, non-empty
# [0-9A-Za-z-] identifiers (upper- and lowercase). \z, not $, so a trailing
# newline is rejected.
param(
  [AllowEmptyString()]
  [string]$Tag
)
$ErrorActionPreference = "Stop"

function Fail([string]$Message) {
  [Console]::Error.WriteLine($Message)
  exit 1
}

if ($Tag -cnotmatch '^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?\z') {
  Fail "Tag '$Tag' is invalid: release tags must start with a lowercase 'v' followed by MAJOR.MINOR.PATCH and an optional -prerelease suffix of dot-separated identifiers, with no leading zeros, like v1.2.3 or v1.2.3-rc.1."
}
if ($Tag -ceq "v2.1.0") {
  Fail "Tag 'v2.1.0' is invalid here: it is the starting version, so self-update would not replace the binary. Run this check with a newer release tag."
}
if ($Tag.Contains("-")) { "prerelease" } else { "stable" }
# Set $LASTEXITCODE for the caller, which would otherwise see the last native command's code.
exit 0
