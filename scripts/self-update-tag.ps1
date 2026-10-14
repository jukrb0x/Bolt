# Validate the release tag for the Windows self-update check and pick the mode.
# Called by .github/workflows/verify-windows-self-update.yml and run by
# src/tests/self-update-tag.test.ts under pwsh.
#
# Writes "prerelease" or "stable" to the pipeline. Throws when the tag is invalid.
# A hyphen marks a prerelease. v2.1.0 strips that suffix before comparing, so
# the workflow passes --force for a prerelease. A stable tag takes the real
# compare-and-upgrade path, with no --force.
#
# -cnotmatch is case-sensitive: "V1.2.3" is rejected. The prerelease suffix
# accepts upper- and lowercase letters, as SemVer identifiers do.
param(
  [AllowEmptyString()]
  [string]$Tag
)
$ErrorActionPreference = "Stop"

if ($Tag -cnotmatch '^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]+)?$') {
  throw "Tag '$Tag' is invalid: release tags must start with a lowercase 'v' followed by MAJOR.MINOR.PATCH and an optional -prerelease suffix, like v1.2.3 or v1.2.3-rc.1."
}
if ($Tag -ceq "v2.1.0") {
  throw "Tag 'v2.1.0' is invalid here: it is the starting version, so self-update would not replace the binary. Run this check with a newer release tag."
}
if ($Tag.Contains("-")) { "prerelease" } else { "stable" }
