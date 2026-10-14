# Validate a release tag for the Windows install and self-update checks, and pick
# the self-update mode. Called by .github/workflows/verify-windows-self-update.yml
# and .github/workflows/verify-windows-install.yml; run by
# src/tests/self-update-tag.test.ts under pwsh.
#
# Writes "prerelease" or "stable" to the pipeline. An invalid tag writes the reason
# to stderr and exits 1. The caller must check $LASTEXITCODE. It uses exit, not
# throw, so the message is not wrapped by pwsh's error view.
# A hyphen marks a prerelease. v2.1.0 strips that suffix before comparing, so
# the workflow passes --force for a prerelease. A stable tag takes the real
# compare-and-upgrade path, with no --force.
#
# -AllowBaseline: install only. Self-update rejects v2.1.0 (the starting binary
# would not be replaced). Install verifies that tag's published assets, so it
# passes -AllowBaseline and accepts v2.1.0.
#
# -cnotmatch is case-sensitive: "V1.2.3" is rejected. As in SemVer, numbers have
# no leading zeros and the prerelease suffix is dot-separated, non-empty
# [0-9A-Za-z-] identifiers (upper- and lowercase). \z, not $, so a trailing
# newline is rejected.
param(
  [AllowEmptyString()]
  [string]$Tag,
  [switch]$AllowBaseline
)
$ErrorActionPreference = "Stop"

function Fail([string]$Message) {
  [Console]::Error.WriteLine($Message)
  exit 1
}

# Show control characters as escapes (\n, \r, \t, \x1B) so the error stays on one
# line and a stray trailing newline from the caller is visible.
function Format-Tag([string]$Value) {
  $sb = [System.Text.StringBuilder]::new()
  foreach ($ch in $Value.ToCharArray()) {
    switch ([int]$ch) {
      10 { [void]$sb.Append('\n') }
      13 { [void]$sb.Append('\r') }
      9 { [void]$sb.Append('\t') }
      0 { [void]$sb.Append('\0') }
      default {
        if ([char]::IsControl($ch)) { [void]$sb.Append(('\x{0:X2}' -f [int]$ch)) }
        else { [void]$sb.Append($ch) }
      }
    }
  }
  $sb.ToString()
}

if ($Tag -cnotmatch '^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?\z') {
  Fail "Tag '$(Format-Tag $Tag)' is invalid: release tags must start with a lowercase 'v' followed by MAJOR.MINOR.PATCH and an optional -prerelease suffix of dot-separated identifiers, with no leading zeros, like v1.2.3 or v1.2.3-rc.1."
}
if ($Tag -ceq "v2.1.0" -and -not $AllowBaseline) {
  Fail "Tag 'v2.1.0' is invalid here: it is the starting version, so self-update would not replace the binary. Run this check with a newer release tag."
}
if ($Tag.Contains("-")) { "prerelease" } else { "stable" }
# Set $LASTEXITCODE for the caller, which would otherwise see the last native command's code.
exit 0
