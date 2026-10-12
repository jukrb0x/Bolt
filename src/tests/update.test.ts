import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import {
  cleanupStaleBinary,
  acceptedBinaryVersion,
  isNewer,
  packageManagerForPath,
  parseInstallReceipt,
  parseSha256Sums,
  planSelfUpdate,
  releaseAssetName,
  releasesApiBase,
  replaceInstalledBinary,
  sha256Hex,
} from "../commands/update";

test("isNewer: same version is not newer", () => {
  expect(isNewer("1.2.3", "1.2.3")).toBe(false);
});

test("isNewer: patch bump is newer", () => {
  expect(isNewer("1.2.3", "1.2.4")).toBe(true);
});

test("isNewer: minor bump is newer", () => {
  expect(isNewer("1.2.3", "1.3.0")).toBe(true);
});

test("isNewer: major bump is newer", () => {
  expect(isNewer("1.2.3", "2.0.0")).toBe(true);
});

test("isNewer: older version is not newer", () => {
  expect(isNewer("1.2.3", "1.2.2")).toBe(false);
});

test("isNewer: handles v-prefixed latest tag", () => {
  expect(isNewer("1.2.3", "v1.2.4")).toBe(true);
  expect(isNewer("1.2.3", "v1.2.3")).toBe(false);
});

test("isNewer: dev-suffixed current does not suppress updates", () => {
  expect(isNewer("0.1.0-dev", "0.1.1")).toBe(true);
  expect(isNewer("0.1.0-dev", "0.1.0")).toBe(false);
});

test("releaseAssetName: Intel macOS downloads bolt-mac-x64", () => {
  expect(releaseAssetName("darwin", "x64", "bolt")).toBe("bolt-mac-x64");
});

test("releaseAssetName: Apple Silicon downloads bolt-mac-arm64", () => {
  expect(releaseAssetName("darwin", "arm64", "bolt")).toBe("bolt-mac-arm64");
});

test("releaseAssetName: keeps an installed Intel asset even if arch differs", () => {
  expect(releaseAssetName("darwin", "arm64", "bolt-mac-x64")).toBe("bolt-mac-x64");
});

test("releaseAssetName: the dropped baseline filename is not a separate asset", () => {
  expect(releaseAssetName("win32", "x64", "bolt-win-x64-baseline.exe")).toBe("bolt-win-x64.exe");
});

test("releaseAssetName: linux and windows x64 use their release assets", () => {
  expect(releaseAssetName("linux", "x64", "bolt")).toBe("bolt-linux-x64");
  expect(releaseAssetName("win32", "x64", "bolt.exe")).toBe("bolt-win-x64.exe");
});

test("releaseAssetName: unknown platform has no asset", () => {
  expect(releaseAssetName("freebsd", "x64", "bolt")).toBeUndefined();
});

const SUM_A = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const SUM_B = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

test("parseSha256Sums reads GNU checksum lines and ignores anything else", () => {
  const sums = parseSha256Sums(
    `${SUM_A.toUpperCase()}  bolt-mac-x64\r\n${SUM_B}  bolt-mac-arm64\nnot a checksum\n`,
  );
  expect(sums.get("bolt-mac-x64")).toBe(SUM_A);
  expect(sums.get("bolt-mac-arm64")).toBe(SUM_B);
  expect(sums.has("not")).toBe(false);
});

test("sha256Hex matches a known digest", () => {
  expect(sha256Hex(new TextEncoder().encode("abc"))).toBe(
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
});

test("acceptedBinaryVersion rejects a binary that does not print a version", () => {
  expect(acceptedBinaryVersion(0, "2.1.0\n")).toBe("2.1.0");
  expect(acceptedBinaryVersion(0, "2.0.0-dev")).toBe("2.0.0-dev");
  expect(acceptedBinaryVersion(1, "2.1.0")).toBeNull();
  expect(acceptedBinaryVersion(0, '2.1.0"; rm')).toBeNull();
  expect(acceptedBinaryVersion(0, "")).toBeNull();
  expect(acceptedBinaryVersion(null, "")).toBeNull();
});

test("releasesApiBase stays on GitHub unless a local release is set", () => {
  expect(releasesApiBase(undefined)).toBe("https://api.github.com/repos/jukrb0x/Bolt/releases");
  expect(releasesApiBase("  ")).toBe("https://api.github.com/repos/jukrb0x/Bolt/releases");
  expect(releasesApiBase("http://127.0.0.1:8765/repos/jukrb0x/Bolt/releases/")).toBe(
    "http://127.0.0.1:8765/repos/jukrb0x/Bolt/releases",
  );
});

test("parseInstallReceipt accepts a github receipt and strips a BOM", () => {
  expect(parseInstallReceipt('\uFEFF{"channel":"github","asset":"bolt-mac-x64"}')).toEqual({
    channel: "github",
    asset: "bolt-mac-x64",
  });
  expect(parseInstallReceipt("not json")).toBeNull();
  expect(parseInstallReceipt('{"asset":"bolt-mac-x64"}')).toBeNull();
});

test("planSelfUpdate keeps an Intel receipt asset on an arm64 report", () => {
  expect(
    planSelfUpdate({
      execPath: "/Users/me/.bolt/bin/bolt",
      platform: "darwin",
      arch: "arm64",
      receipt: { channel: "github", asset: "bolt-mac-x64" },
    }),
  ).toEqual({ kind: "update", asset: "bolt-mac-x64" });
});

test("planSelfUpdate uses arch when a github receipt has no asset", () => {
  expect(
    planSelfUpdate({
      execPath: "/Users/me/.bolt/bin/bolt",
      platform: "darwin",
      arch: "x64",
      receipt: { channel: "github" },
    }),
  ).toEqual({ kind: "update", asset: "bolt-mac-x64" });
});

test("planSelfUpdate refuses a script install with no receipt", () => {
  const plan = planSelfUpdate({
    execPath: "/Users/me/.bolt/bin/bolt",
    platform: "darwin",
    arch: "x64",
    receipt: null,
  });
  expect(plan.kind).toBe("refuse");
});

test("planSelfUpdate lets a package-manager path win over a github receipt", () => {
  expect(packageManagerForPath("/opt/homebrew/bin/bolt")).toBe("brew");
  expect(packageManagerForPath("/home/linuxbrew/.linuxbrew/bin/bolt")).toBe("brew");
  expect(
    planSelfUpdate({
      execPath: "/proj/node_modules/.bin/bolt",
      platform: "linux",
      arch: "x64",
      receipt: { channel: "github", asset: "bolt-linux-x64" },
    }),
  ).toEqual({
    kind: "delegate",
    manager: "npm",
    command: "Upgrade it with: npm install -g boltstack@latest",
  });
  expect(
    planSelfUpdate({
      execPath: "C:/Users/me/scoop/shims/bolt.exe",
      platform: "win32",
      arch: "x64",
      receipt: { channel: "github", asset: "bolt-win-x64.exe" },
    }),
  ).toEqual({
    kind: "delegate",
    manager: "scoop",
    command: "No Scoop app name is published yet. Upgrade the app that installed this bolt.",
  });
});

test("planSelfUpdate delegates a non-github receipt", () => {
  expect(
    planSelfUpdate({
      execPath: "/Users/me/.bolt/bin/bolt",
      platform: "darwin",
      arch: "arm64",
      receipt: { channel: "winget" },
    }),
  ).toEqual({
    kind: "delegate",
    manager: "winget",
    command: "No winget package id is published yet. Upgrade the package that installed this bolt.",
  });
});

test("replaceInstalledBinary on win32 renames the running exe aside", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "bolt-update-"));
  try {
    const execPath = path.join(dir, "bolt.exe");
    const nextPath = path.join(dir, "bolt-win-x64.exe.new");
    writeFileSync(execPath, "old");
    writeFileSync(nextPath, "new");
    replaceInstalledBinary("win32", execPath, nextPath);
    expect(readFileSync(execPath, "utf8")).toBe("new");
    expect(readFileSync(`${execPath}.old`, "utf8")).toBe("old");
    cleanupStaleBinary(execPath);
    expect(readFileSync(execPath, "utf8")).toBe("new");
    expect(() => readFileSync(`${execPath}.old`)).toThrow();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("replaceInstalledBinary on win32 restores the exe if the new file cannot be moved", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "bolt-update-"));
  try {
    const execPath = path.join(dir, "bolt.exe");
    writeFileSync(execPath, "old");
    expect(() => replaceInstalledBinary("win32", execPath, path.join(dir, "missing"))).toThrow();
    expect(readFileSync(execPath, "utf8")).toBe("old");
    expect(() => readFileSync(`${execPath}.old`)).toThrow();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

function installAsset(
  osName: string,
  arch: string,
): { status: number; stdout: string; stderr: string } {
  const result = Bun.spawnSync(["sh", "./install.sh"], {
    env: {
      ...process.env,
      BOLT_INSTALL_PRINT_ASSET: "1",
      BOLT_INSTALL_OS: osName,
      BOLT_INSTALL_ARCH: arch,
    },
  });
  return {
    status: result.exitCode ?? 1,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}

test("install.sh runs the download before it replaces bolt", () => {
  const text = readFileSync("install.sh", "utf8");
  const probe = text.indexOf('"${DEST}/bolt.new" version');
  const move = text.indexOf('mv -f "${DEST}/bolt.new" "${DEST}/bolt"');
  expect(probe).toBeGreaterThan(-1);
  expect(move).toBeGreaterThan(probe);
});

test("install.sh selects bolt-mac-x64 for Intel macOS", () => {
  const intel = installAsset("Darwin", "x86_64");
  expect(intel.status).toBe(0);
  expect(intel.stdout.trim()).toBe("bolt-mac-x64");
  expect(installAsset("Darwin", "arm64").stdout.trim()).toBe("bolt-mac-arm64");
  expect(installAsset("Linux", "x86_64").stdout.trim()).toBe("bolt-linux-x64");
  const windows = installAsset("Windows_NT", "x86_64");
  expect(windows.status).not.toBe(0);
  expect(windows.stderr).toContain("install.ps1");
});

test("install.ps1 targets the windows x64 asset and renames a running exe", () => {
  const text = readFileSync("install.ps1", "utf8");
  expect(text).toContain("$Asset = 'bolt-win-x64.exe'");
  expect(text).not.toContain("bolt-mac-");
  expect(text).toContain("Get-FileHash");
  expect(text).toContain("Rename-Item");
  expect(text).toContain("LOCALAPPDATA");
  const hash = text.indexOf("Get-FileHash");
  const probe = text.indexOf("& $DownloadPath version");
  const rename = text.indexOf("Rename-Item");
  expect(hash).toBeGreaterThan(-1);
  expect(probe).toBeGreaterThan(hash);
  expect(rename).toBeGreaterThan(probe);
});
