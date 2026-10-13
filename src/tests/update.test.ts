import { expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "fs";
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
  // Semver: the final release outranks its prerelease.
  expect(isNewer("0.1.0-dev", "0.1.0")).toBe(true);
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
      receipt: {
        channel: "github",
        asset: "bolt-mac-x64",
        path: "/Users/me/.bolt/bin/bolt",
      },
    }),
  ).toEqual({ kind: "update", asset: "bolt-mac-x64" });
});

test("planSelfUpdate uses arch when a github receipt has no asset", () => {
  expect(
    planSelfUpdate({
      execPath: "/Users/me/.bolt/bin/bolt",
      platform: "darwin",
      arch: "x64",
      receipt: { channel: "github", path: "/Users/me/.bolt/bin/bolt" },
    }),
  ).toEqual({ kind: "update", asset: "bolt-mac-x64" });
});

test("planSelfUpdate refuses a github receipt for a different bolt", () => {
  const plan = planSelfUpdate({
    execPath: "/usr/local/bin/bolt",
    platform: "darwin",
    arch: "x64",
    receipt: {
      channel: "github",
      asset: "bolt-mac-x64",
      path: "/Users/me/.bolt/bin/bolt",
    },
  });
  expect(plan.kind).toBe("refuse");
});

test("planSelfUpdate refuses a github receipt that does not record a path", () => {
  const plan = planSelfUpdate({
    execPath: "/Users/me/.bolt/bin/bolt",
    platform: "darwin",
    arch: "x64",
    receipt: { channel: "github", asset: "bolt-mac-x64" },
  });
  expect(plan.kind).toBe("refuse");
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
      execPath: "/opt/homebrew/bin/bolt",
      platform: "darwin",
      arch: "arm64",
      receipt: null,
    }),
  ).toEqual({
    kind: "delegate",
    manager: "brew",
    command: "No Homebrew formula is published yet. Upgrade the formula that installed this bolt.",
  });
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
    cleanupStaleBinary(execPath, execPath);
    expect(readFileSync(execPath, "utf8")).toBe("new");
    expect(() => readFileSync(`${execPath}.old`)).toThrow();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("cleanupStaleBinary deletes only the installed bolt.exe.old", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "bolt-update-"));
  try {
    const bolt = path.join(dir, "bolt.exe");
    const bunExe = path.join(dir, "bun.exe");
    const otherDir = path.join(dir, "other");
    writeFileSync(bolt, "new");
    writeFileSync(`${bolt}.old`, "old");
    writeFileSync(`${bunExe}.old`, "bun-old");
    mkdirSync(otherDir);
    const other = path.join(otherDir, "bolt.exe");
    writeFileSync(other, "other");
    writeFileSync(`${other}.old`, "other-old");

    cleanupStaleBinary(bunExe, bolt);
    cleanupStaleBinary(other, bolt);
    expect(readFileSync(`${bolt}.old`, "utf8")).toBe("old");
    expect(readFileSync(`${bunExe}.old`, "utf8")).toBe("bun-old");
    expect(readFileSync(`${other}.old`, "utf8")).toBe("other-old");

    cleanupStaleBinary(bolt, bolt);
    expect(readFileSync(bolt, "utf8")).toBe("new");
    expect(() => readFileSync(`${bolt}.old`)).toThrow();
    expect(readFileSync(`${bunExe}.old`, "utf8")).toBe("bun-old");
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
  expect(text).toContain("Join-Path $ReceiptDir 'bin'");
  expect(text).not.toContain("$DestDir = Join-Path $env:LOCALAPPDATA");
  const hash = text.indexOf("Get-FileHash");
  const probe = text.indexOf("Invoke-VersionProbe $DownloadPath");
  const rename = text.indexOf("Rename-Item");
  expect(hash).toBeGreaterThan(-1);
  expect(probe).toBeGreaterThan(hash);
  expect(rename).toBeGreaterThan(probe);
});

test("install.ps1 updates a bolt.exe on PATH and only notes the v2.1.x directory", () => {
  const text = readFileSync("install.ps1", "utf8");
  expect(text).toContain("Get-Command bolt -CommandType Application");
  expect(text).toContain("Updating it in place");
  expect(text).toContain("no longer used. You can delete it");
  expect(text).not.toMatch(/Remove-Item[^\n]*LegacyDir/);
});

const runInstallSh = process.platform === "linux" && process.arch === "x64" ? test : test.skip;

function fakeRelease(root: string, version: string): string {
  const rel = path.join(root, "release");
  mkdirSync(rel, { recursive: true });
  const asset = path.join(rel, "bolt-linux-x64");
  writeFileSync(asset, `#!/bin/sh\necho ${version}\n`);
  chmodSync(asset, 0o755);
  const sum = new Bun.CryptoHasher("sha256").update(readFileSync(asset)).digest("hex");
  writeFileSync(path.join(rel, "SHA256SUMS"), `${sum}  bolt-linux-x64\n`);
  return `file://${rel}`;
}

function runInstall(home: string, base: string, extraPath: string[], shell = "/bin/bash") {
  const result = Bun.spawnSync(["sh", path.resolve("install.sh")], {
    env: {
      HOME: home,
      SHELL: shell,
      PATH: [...extraPath, "/usr/bin", "/bin"].join(":"),
      BOLT_INSTALL_BASE: base,
    },
  });
  return { status: result.exitCode, out: result.stdout.toString() + result.stderr.toString() };
}

runInstallSh("install.sh installs to ~/.bolt/bin when no bolt is on PATH", () => {
  const root = mkdtempSync(path.join(tmpdir(), "bolt-install-"));
  try {
    const home = path.join(root, "home");
    mkdirSync(home);
    const res = runInstall(home, fakeRelease(root, "9.9.9"), []);
    expect(res.status).toBe(0);
    expect(readFileSync(path.join(home, ".bolt/bin/bolt"), "utf8")).toContain("9.9.9");
    const receipt = JSON.parse(readFileSync(path.join(home, ".bolt/install.json"), "utf8"));
    expect(receipt.path).toBe(path.join(home, ".bolt/bin/bolt"));
    expect(readFileSync(path.join(home, ".bashrc"), "utf8")).toContain(".bolt/bin");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

runInstallSh("install.sh updates a bolt already on PATH in place", () => {
  const root = mkdtempSync(path.join(tmpdir(), "bolt-install-"));
  try {
    const home = path.join(root, "home");
    const custom = path.join(root, "custom-bin");
    mkdirSync(home);
    mkdirSync(custom);
    writeFileSync(path.join(custom, "bolt"), "#!/bin/sh\necho 2.0.0\n");
    chmodSync(path.join(custom, "bolt"), 0o755);
    const res = runInstall(home, fakeRelease(root, "9.9.9"), [custom]);
    expect(res.status).toBe(0);
    expect(res.out).toContain("Updating it in place");
    expect(readFileSync(path.join(custom, "bolt"), "utf8")).toContain("9.9.9");
    expect(existsSync(path.join(home, ".bolt/bin/bolt"))).toBe(false);
    expect(existsSync(path.join(home, ".bashrc"))).toBe(false);
    const receipt = JSON.parse(readFileSync(path.join(home, ".bolt/install.json"), "utf8"));
    expect(receipt.path).toBe(path.join(custom, "bolt"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

runInstallSh("install.sh ignores a bolt on PATH that is not a bolt binary", () => {
  const root = mkdtempSync(path.join(tmpdir(), "bolt-install-"));
  try {
    const home = path.join(root, "home");
    const custom = path.join(root, "custom-bin");
    mkdirSync(home);
    mkdirSync(custom);
    writeFileSync(path.join(custom, "bolt"), "#!/bin/sh\necho 'some other tool'\n");
    chmodSync(path.join(custom, "bolt"), 0o755);
    const res = runInstall(home, fakeRelease(root, "9.9.9"), [custom]);
    expect(res.status).toBe(0);
    expect(readFileSync(path.join(custom, "bolt"), "utf8")).toContain("some other tool");
    expect(readFileSync(path.join(home, ".bolt/bin/bolt"), "utf8")).toContain("9.9.9");
    // The rc line puts ~/.bolt/bin first in new shells, so the fake bolt is not reported.
    expect(res.out).not.toContain("Warning:");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function fakeBolt(dir: string, body: string): string {
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "bolt");
  writeFileSync(file, `#!/bin/sh\n${body}\n`);
  chmodSync(file, 0o755);
  return file;
}

runInstallSh("install.sh skips a bolt on PATH that is a symlink", () => {
  const root = mkdtempSync(path.join(tmpdir(), "bolt-install-"));
  try {
    const home = path.join(root, "home");
    mkdirSync(home);
    const real = fakeBolt(path.join(root, "real"), "echo 2.0.0");
    const linkDir = path.join(root, "link-bin");
    mkdirSync(linkDir);
    symlinkSync(real, path.join(linkDir, "bolt"));
    const res = runInstall(home, fakeRelease(root, "9.9.9"), [linkDir]);
    expect(res.status).toBe(0);
    expect(res.out).toContain("it is a symlink");
    expect(readFileSync(real, "utf8")).toContain("2.0.0");
    expect(readFileSync(path.join(home, ".bolt/bin/bolt"), "utf8")).toContain("9.9.9");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

const runUnwritable = process.getuid?.() === 0 ? test.skip : runInstallSh;
runUnwritable("install.sh skips a bolt on PATH in a directory it cannot write", () => {
  const root = mkdtempSync(path.join(tmpdir(), "bolt-install-"));
  const ro = path.join(root, "ro-bin");
  try {
    const home = path.join(root, "home");
    mkdirSync(home);
    const existing = fakeBolt(ro, "echo 2.0.0");
    chmodSync(ro, 0o555);
    const res = runInstall(home, fakeRelease(root, "9.9.9"), [ro]);
    expect(res.status).toBe(0);
    expect(res.out).toContain("is not writable");
    expect(readFileSync(existing, "utf8")).toContain("2.0.0");
    expect(readFileSync(path.join(home, ".bolt/bin/bolt"), "utf8")).toContain("9.9.9");
  } finally {
    chmodSync(ro, 0o755);
    rmSync(root, { recursive: true, force: true });
  }
});

for (const managed of ["node_modules/.bin", "chocolatey/bin", "homebrew/bin"]) {
  runInstallSh(`install.sh leaves a package-managed bolt under ${managed} alone`, () => {
    const root = mkdtempSync(path.join(tmpdir(), "bolt-install-"));
    try {
      const home = path.join(root, "home");
      mkdirSync(home);
      const dir = path.join(root, managed);
      const existing = fakeBolt(dir, "echo 2.0.0");
      const res = runInstall(home, fakeRelease(root, "9.9.9"), [dir]);
      expect(res.status).toBe(0);
      expect(res.out).toContain("belongs to a package manager");
      expect(readFileSync(existing, "utf8")).toContain("2.0.0");
      expect(readFileSync(path.join(home, ".bolt/bin/bolt"), "utf8")).toContain("9.9.9");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}

runInstallSh("install.sh treats HOME with a trailing slash as the default directory", () => {
  const root = mkdtempSync(path.join(tmpdir(), "bolt-install-"));
  try {
    const home = path.join(root, "home");
    const bin = path.join(home, ".bolt/bin");
    fakeBolt(bin, "echo 2.0.0");
    const res = runInstall(`${home}//`, fakeRelease(root, "9.9.9"), [`${bin}/`]);
    expect(res.status).toBe(0);
    expect(res.out).toContain("Updating it in place");
    expect(res.out).not.toContain("Warning:");
    expect(readFileSync(path.join(bin, "bolt"), "utf8")).toContain("9.9.9");
    expect(readFileSync(path.join(home, ".bashrc"), "utf8")).toContain(
      'export PATH="$HOME/.bolt/bin:$PATH"',
    );
    const receipt = JSON.parse(readFileSync(path.join(home, ".bolt/install.json"), "utf8"));
    expect(receipt.path).toBe(path.join(bin, "bolt"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

runInstallSh("install.sh appends its PATH line unless that exact line is present", () => {
  const root = mkdtempSync(path.join(tmpdir(), "bolt-install-"));
  try {
    const home = path.join(root, "home");
    mkdirSync(home);
    const rc = path.join(home, ".bashrc");
    writeFileSync(rc, "# old notes about ~/.bolt/bin\n");
    const base = fakeRelease(root, "9.9.9");
    expect(runInstall(home, base, []).status).toBe(0);
    const line = 'export PATH="$HOME/.bolt/bin:$PATH"';
    expect(
      readFileSync(rc, "utf8")
        .split("\n")
        .filter((l) => l === line),
    ).toHaveLength(1);
    expect(runInstall(home, base, []).status).toBe(0);
    expect(
      readFileSync(rc, "utf8")
        .split("\n")
        .filter((l) => l === line),
    ).toHaveLength(1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("install.sh probes an existing bolt with a timeout and skips chocolatey copies", () => {
  const text = readFileSync("install.sh", "utf8");
  expect(text).toContain('timeout "$PROBE_TIMEOUT" "$1" version');
  expect(text).toContain("gtimeout");
  expect(text).toContain("*/chocolatey/*");
});

test("install.ps1 keeps raw user Path text and broadcasts the change", () => {
  const text = readFileSync("install.ps1", "utf8");
  expect(text).toContain("DoNotExpandEnvironmentNames");
  expect(text).toContain("RegistryValueKind]::ExpandString");
  expect(text).toContain("SendMessageTimeout");
  expect(text).not.toContain("SetEnvironmentVariable('Path'");
  expect(text).toContain("/chocolatey/");
  expect(text).toContain("LinkType -eq 'Junction'");
  expect(text).toContain("FullLanguage");
  expect(text).toContain("Kill($true)");
  expect(text).toContain("WaitForExit($TimeoutMs)");
});

runInstallSh("install.sh warns about an earlier bolt when it cannot edit a shell profile", () => {
  const root = mkdtempSync(path.join(tmpdir(), "bolt-install-"));
  try {
    const home = path.join(root, "home");
    mkdirSync(home);
    const other = fakeBolt(path.join(root, "other"), "echo 'some other tool'");
    const res = runInstall(home, fakeRelease(root, "9.9.9"), [path.dirname(other)], "/bin/fish");
    expect(res.status).toBe(0);
    expect(res.out).toContain("Add this to your shell profile");
    expect(res.out).toContain(`Warning: bolt on your PATH is ${other}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

runInstallSh("install.sh accepts a hand-edited .bolt/bin PATH line", () => {
  const root = mkdtempSync(path.join(tmpdir(), "bolt-install-"));
  try {
    const home = path.join(root, "home");
    mkdirSync(home);
    const rc = path.join(home, ".bashrc");
    const custom = 'export PATH="$PATH:$HOME/.bolt/bin" # mine\n';
    writeFileSync(rc, custom);
    expect(runInstall(home, fakeRelease(root, "9.9.9"), []).status).toBe(0);
    expect(readFileSync(rc, "utf8")).toBe(custom);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

runInstallSh(
  "install.sh kills a hanging bolt without timeout(1)",
  () => {
    const root = mkdtempSync(path.join(tmpdir(), "bolt-install-"));
    try {
      const home = path.join(root, "home");
      mkdirSync(home);
      // A PATH with the tools install.sh needs but no timeout or gtimeout.
      const tools = path.join(root, "tools");
      mkdirSync(tools);
      for (const t of [
        "sh",
        "uname",
        "dirname",
        "basename",
        "mkdir",
        "mktemp",
        "rm",
        "curl",
        "awk",
        "tr",
        "sha256sum",
        "cp",
        "chmod",
        "mv",
        "sed",
        "cat",
        "grep",
        "sleep",
      ]) {
        const found = Bun.which(t, { PATH: "/usr/bin:/bin" });
        if (found) symlinkSync(found, path.join(tools, t));
      }
      const hang = fakeBolt(path.join(root, "hang"), "sleep 30\necho 2.0.0");
      const started = Date.now();
      const result = Bun.spawnSync(["sh", path.resolve("install.sh")], {
        env: {
          HOME: home,
          SHELL: "/bin/bash",
          PATH: [path.dirname(hang), tools].join(":"),
          BOLT_INSTALL_BASE: fakeRelease(root, "9.9.9"),
          BOLT_INSTALL_PROBE_TIMEOUT: "1",
        },
      });
      const out = result.stdout.toString() + result.stderr.toString();
      expect(result.exitCode).toBe(0);
      expect(Date.now() - started).toBeLessThan(20000);
      expect(out).toContain("did not print a bolt version");
      expect(readFileSync(path.join(home, ".bolt/bin/bolt"), "utf8")).toContain("9.9.9");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
  30000,
);
