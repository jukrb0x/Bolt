import { spawnSync } from "child_process";
import { createHash } from "crypto";
import { defineCommand } from "citty";
import { VERSION } from "../version";
import { chmodSync, existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "fs";
import { homedir } from "os";
import path from "path";
import pc from "picocolors";
import { RELEASE_BINARIES } from "../../scripts/release-targets";

import {
  RATE_LIMIT_MESSAGE,
  checkOverrideUrl,
  defaultResolveDeps,
  isRateLimited,
  normalizeTag,
  resolveRelease,
  type ResolvedRelease,
} from "../release-source";
export { releasesApiBase } from "../release-source";

export interface InstallReceipt {
  channel: string;
  asset?: string;
  path?: string;
}

export type SelfUpdatePlan =
  | { kind: "update"; asset: string }
  | { kind: "delegate"; manager: string; command: string }
  | { kind: "refuse"; message: string };

const RELEASE_ASSET_NAMES = new Set<string>(RELEASE_BINARIES.map((binary) => binary.filename));

const PACKAGE_MANAGER_COMMANDS: Record<string, string> = {
  npm: "Upgrade it with: npm install -g boltstack@latest",
  // winget upgrade and scoop update do nothing for one app unless it is named.
  // Those packages are not published, so this cannot invent an id.
  winget: "No winget package id is published yet. Upgrade the package that installed this bolt.",
  scoop: "No Scoop app name is published yet. Upgrade the app that installed this bolt.",
  brew: "No Homebrew formula is published yet. Upgrade the formula that installed this bolt.",
};

/** Compare two versions by semver precedence. "v" prefixes and build metadata are ignored. */
export function compareVersions(left: string, right: string): number {
  const parse = (v: string) => {
    const [core, ...pre] = v.trim().replace(/^v/, "").replace(/\+.*$/, "").split("-");
    const nums = core.split(".").map((part) => parseInt(part, 10) || 0);
    return { nums: [nums[0] ?? 0, nums[1] ?? 0, nums[2] ?? 0], pre: pre.join("-") };
  };
  const a = parse(left);
  const b = parse(right);
  for (let i = 0; i < 3; i++) if (a.nums[i] !== b.nums[i]) return a.nums[i] - b.nums[i];
  // A final release outranks any prerelease of the same version.
  if (a.pre === b.pre) return 0;
  if (!a.pre) return 1;
  if (!b.pre) return -1;
  const ap = a.pre.split(".");
  const bp = b.pre.split(".");
  for (let i = 0; i < Math.max(ap.length, bp.length); i++) {
    if (ap[i] === undefined) return -1;
    if (bp[i] === undefined) return 1;
    const an = /^\d+$/.test(ap[i]);
    const bn = /^\d+$/.test(bp[i]);
    if (an && bn) {
      const d = Number(ap[i]) - Number(bp[i]);
      if (d !== 0) return d;
    } else if (an !== bn) {
      return an ? -1 : 1;
    } else if (ap[i] !== bp[i]) {
      return ap[i] < bp[i] ? -1 : 1;
    }
  }
  return 0;
}

export function isNewer(current: string, latest: string): boolean {
  return compareVersions(latest, current) > 0;
}

/** Same version, ignoring a "v" prefix and build metadata. */
export function sameVersion(left: string, right: string): boolean {
  return compareVersions(left, right) === 0;
}

/**
 * The version a user asked for. The positional form and --version are the same
 * option; giving both with different values is an error.
 */
export function requestedVersion(
  positional: unknown,
  flag: unknown,
): { version?: string; error?: string } {
  const p = typeof positional === "string" && positional.trim() ? positional.trim() : undefined;
  const f = typeof flag === "string" && flag.trim() ? flag.trim() : undefined;
  if (p && f && !sameVersion(p, f)) {
    return { error: `Two different versions were given (${p} and --version ${f}). Pass one.` };
  }
  return { version: p ?? f };
}

/**
 * Release asset to download when the running file was renamed.
 * An executable that is already a release asset keeps that name,
 * so an Intel macOS binary is not replaced with the arm64 asset.
 */
export function releaseAssetName(
  platform: string,
  arch: string,
  execName: string,
): string | undefined {
  if (RELEASE_ASSET_NAMES.has(execName)) return execName;
  if (platform === "win32" && arch === "x64") return "bolt-win-x64.exe";
  if (platform === "darwin" && arch === "arm64") return "bolt-mac-arm64";
  if (platform === "darwin" && arch === "x64") return "bolt-mac-x64";
  if (platform === "linux" && arch === "x64") return "bolt-linux-x64";
  return undefined;
}

/** GNU sha256sum lines: 64 hex chars, two spaces, then the file name. */
export function parseSha256Sums(text: string): Map<string, string> {
  const sums = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const match = /^([a-fA-F0-9]{64})  (\S+)$/.exec(line.trim());
    if (!match) continue;
    sums.set(match[2], match[1].toLowerCase());
  }
  return sums;
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Version printed by a downloaded binary, or null when that file must not be installed. */
export function acceptedBinaryVersion(status: number | null, stdout: string): string | null {
  if (status !== 0) return null;
  const version = stdout.replace(/\s+/g, "");
  if (!/^[0-9A-Za-z.+-]+$/.test(version)) return null;
  return version;
}

export function parseInstallReceipt(text: string): InstallReceipt | null {
  try {
    const value = JSON.parse(text.replace(/^\uFEFF/, "")) as {
      channel?: unknown;
      asset?: unknown;
      path?: unknown;
    };
    if (!value || typeof value.channel !== "string" || !value.channel) return null;
    const receipt: InstallReceipt = { channel: value.channel };
    if (typeof value.asset === "string") receipt.asset = value.asset;
    if (typeof value.path === "string" && value.path) receipt.path = value.path;
    return receipt;
  } catch {
    return null;
  }
}

export function installReceiptPath(home: string): string {
  return path.join(home, ".bolt", "install.json");
}

/** Package manager that owns this executable, judged from its path. */
export function packageManagerForPath(execPath: string): string | undefined {
  const normalized = execPath.replace(/\\/g, "/").toLowerCase();
  if (normalized.includes("/node_modules/")) return "npm";
  if (normalized.includes("/winget/packages/") || normalized.includes("/microsoft/winget/")) {
    return "winget";
  }
  if (normalized.includes("/scoop/apps/") || normalized.includes("/scoop/shims/")) return "scoop";
  if (
    normalized.includes("/cellar/") ||
    normalized.includes("/homebrew/") ||
    normalized.includes("/linuxbrew/")
  ) {
    return "brew";
  }
  return undefined;
}

function managerCommand(manager: string): string {
  return PACKAGE_MANAGER_COMMANDS[manager] ?? manager;
}

/**
 * Decide whether self-update may replace this executable.
 * A package-manager path wins over the receipt so npm, winget, scoop, and
 * Homebrew copies are not overwritten. A github receipt's asset is kept,
 * which is how an Intel macOS install stays on bolt-mac-x64.
 */
export function planSelfUpdate(input: {
  execPath: string;
  platform: string;
  arch: string;
  receipt: InstallReceipt | null;
}): SelfUpdatePlan {
  const manager = packageManagerForPath(input.execPath);
  if (manager) {
    return { kind: "delegate", manager, command: managerCommand(manager) };
  }

  const channel = input.receipt?.channel;
  if (channel && channel !== "github") {
    return { kind: "delegate", manager: channel, command: managerCommand(channel) };
  }
  if (channel !== "github") {
    return {
      kind: "refuse",
      message:
        "self-update only replaces a copy installed by install.ps1 or install.sh. Reinstall with that script, or upgrade the package manager that owns this bolt.",
    };
  }

  const installed = input.receipt?.path;
  if (!installed || !sameInstallPath(input.execPath, installed, input.platform)) {
    return {
      kind: "refuse",
      message:
        "self-update only replaces the bolt recorded in ~/.bolt/install.json. This executable is a different file.",
    };
  }

  const recorded = input.receipt?.asset;
  const asset =
    recorded && RELEASE_ASSET_NAMES.has(recorded)
      ? recorded
      : releaseAssetName(input.platform, input.arch, path.basename(input.execPath));
  if (!asset) {
    return {
      kind: "refuse",
      message: `self-update is not supported on platform: ${input.platform} ${input.arch}`,
    };
  }
  return { kind: "update", asset };
}

/**
 * Replace the running binary. Windows cannot overwrite a running exe, so the
 * current file is renamed to `*.old` and the new file takes its place.
 * The next launch deletes `*.old`.
 */
export function replaceInstalledBinary(platform: string, execPath: string, nextPath: string): void {
  if (platform !== "win32") {
    chmodSync(nextPath, 0o755);
    renameSync(nextPath, execPath);
    return;
  }

  const oldPath = `${execPath}.old`;
  if (existsSync(oldPath)) {
    try {
      unlinkSync(oldPath);
    } catch {
      // A previous .old can still be locked. The rename below fails clearly if so.
    }
  }
  renameSync(execPath, oldPath);
  try {
    renameSync(nextPath, execPath);
  } catch (error) {
    try {
      renameSync(oldPath, execPath);
    } catch {
      // The new file is still at nextPath. The caller reports both paths.
    }
    throw error;
  }
}

/** Compare two install paths. Windows paths are case-insensitive. */
export function sameInstallPath(left: string, right: string, platform: string): boolean {
  const normalize = (filePath: string) => {
    const resolved = path.resolve(filePath).replace(/^\\\\\?\\/, "");
    return platform === "win32" ? resolved.toLowerCase() : resolved;
  };
  return normalize(left) === normalize(right);
}

/**
 * Delete this install's bolt.exe.old.
 * A normal Windows start does not delete bun.exe.old or any other *.exe.old.
 */
export function cleanupStaleBinary(execPath: string, installedPath: string | undefined): void {
  if (!installedPath) return;
  if (path.basename(installedPath).toLowerCase() !== "bolt.exe") return;
  if (path.basename(execPath).toLowerCase() !== "bolt.exe") return;
  if (!sameInstallPath(execPath, installedPath, "win32")) return;
  const oldPath = `${installedPath}.old`;
  if (!existsSync(oldPath)) return;
  try {
    unlinkSync(oldPath);
  } catch {
    // Still locked. The next launch tries again.
  }
}

/** On Windows, delete bolt.exe.old only when this process is the receipt's bolt.exe. */
export function cleanupInstalledBolt(execPath: string): void {
  let installed: string | undefined;
  try {
    const receiptPath = installReceiptPath(homedir());
    if (existsSync(receiptPath)) {
      installed = parseInstallReceipt(readFileSync(receiptPath, "utf8"))?.path;
    }
  } catch {
    installed = undefined;
  }
  cleanupStaleBinary(execPath, installed);
}

class DownloadError extends Error {
  constructor(
    readonly status: number,
    readonly rateLimited: boolean,
    url: string,
  ) {
    super(`Download failed: HTTP ${status} for ${url}`);
  }
}

async function download(url: string): Promise<Uint8Array> {
  const res = await fetch(url, { headers: { "User-Agent": "bolt-self-update" } });
  if (!res.ok) {
    throw new DownloadError(
      res.status,
      isRateLimited(res.status, res.headers.get("x-ratelimit-remaining")),
      url,
    );
  }
  return new Uint8Array(await res.arrayBuffer());
}

/** Message for a failed asset download. Rate-limit wording only when GitHub says so. */
export function downloadFailureMessage(
  status: number | undefined,
  tag: string | undefined,
  rateLimited = status === 429,
): string {
  if (rateLimited) return RATE_LIMIT_MESSAGE;
  if (status === 404 && tag) return `Release ${tag} or its asset was not found (HTTP 404).`;
  return "";
}

function readReceiptFile(): InstallReceipt | null {
  const receiptPath = installReceiptPath(homedir());
  if (!existsSync(receiptPath)) return null;
  try {
    return parseInstallReceipt(readFileSync(receiptPath, "utf8"));
  } catch {
    return null;
  }
}

function writeReceiptVersion(version: string, asset: string): void {
  const receiptPath = installReceiptPath(homedir());
  if (!existsSync(receiptPath)) return;
  try {
    const current = JSON.parse(readFileSync(receiptPath, "utf8").replace(/^\uFEFF/, "")) as Record<
      string,
      unknown
    >;
    current.channel = "github";
    current.asset = asset;
    current.version = version;
    writeFileSync(receiptPath, `${JSON.stringify(current, null, 2)}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(pc.yellow(`Updated the binary, but could not write ${receiptPath}: ${message}`));
  }
}

export default defineCommand({
  meta: { name: "self-update", description: "Update a script-installed bolt to a GitHub release" },
  args: {
    force: {
      type: "boolean",
      default: false,
      description: "Re-download even if already up to date",
    },
    tag: {
      type: "positional",
      required: false,
      description: "Install this version instead of the latest, for example v2.1.0",
    },
    version: {
      type: "string",
      description: "Same as the positional version, for example 2.1.0",
    },
  },
  async run({ args }) {
    const execName = path.basename(process.execPath).toLowerCase();
    if (execName.startsWith("bun")) {
      console.error(pc.red("self-update is only available in the compiled binary, not dev mode"));
      process.exit(1);
    }

    const plan = planSelfUpdate({
      execPath: process.execPath,
      platform: process.platform,
      arch: process.arch,
      receipt: readReceiptFile(),
    });
    if (plan.kind === "delegate") {
      console.error(pc.red(`This bolt is managed by ${plan.manager}.`));
      console.error(plan.command);
      process.exit(1);
    }
    if (plan.kind === "refuse") {
      console.error(pc.red(plan.message));
      process.exit(1);
    }

    const picked = requestedVersion(args.tag, args.version);
    if (picked.error) {
      console.error(pc.red(picked.error));
      process.exit(1);
    }
    const requested = picked.version;
    console.log(pc.dim(`Current version: ${VERSION}`));
    console.log(
      pc.dim(requested ? `Fetching ${normalizeTag(requested)}...` : "Checking for updates..."),
    );

    // BOLT_INSTALL_BASE is a directory holding SHA256SUMS and the assets, like install.ps1 uses.
    // Its version is only known after the download runs.
    // Test-only, like BOLT_RELEASES_URL and BOLT_RELEASES_API: https, or http for localhost.
    let installBase: string | undefined;
    try {
      installBase = checkOverrideUrl("BOLT_INSTALL_BASE", process.env.BOLT_INSTALL_BASE);
    } catch (error) {
      console.error(pc.red(error instanceof Error ? error.message : String(error)));
      process.exit(1);
    }
    let release: ResolvedRelease | undefined;
    let sumsUrl: string;
    let assetUrl: string;
    if (installBase && !requested) {
      sumsUrl = `${installBase}/SHA256SUMS`;
      assetUrl = `${installBase}/${plan.asset}`;
    } else {
      try {
        release = await resolveRelease(
          plan.asset,
          requested,
          defaultResolveDeps((line) => console.log(pc.dim(line))),
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(pc.red(`Failed to fetch release info: ${message}`));
        process.exit(1);
      }
      sumsUrl = release.sumsUrl;
      assetUrl = release.assetUrl;
      const latestVersion = release.tag.replace(/^v/, "");
      if (!requested && !args.force && !isNewer(VERSION, latestVersion)) {
        console.log(pc.green(`Already up to date (v${VERSION})`));
        return;
      }
    }

    console.log(pc.dim(`Downloading ${plan.asset}${release ? ` ${release.tag}` : ""}...`));
    let sumsText: string;
    let bytes: Uint8Array;
    try {
      sumsText = new TextDecoder().decode(await download(sumsUrl));
      bytes = await download(assetUrl);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const hint =
        error instanceof DownloadError
          ? downloadFailureMessage(error.status, release?.tag, error.rateLimited)
          : "";
      console.error(pc.red(hint ? `${message}. ${hint}` : message));
      process.exit(1);
    }

    const expected = parseSha256Sums(sumsText).get(plan.asset);
    if (!expected) {
      console.error(
        pc.red(`SHA256SUMS has no entry for ${plan.asset}. The installed bolt was not changed.`),
      );
      process.exit(1);
    }
    if (sha256Hex(bytes) !== expected) {
      console.error(
        pc.red(`Checksum mismatch for ${plan.asset}. The installed bolt was not changed.`),
      );
      process.exit(1);
    }

    // Windows will not start a staged file unless the name ends in .exe.
    const tmpName = process.platform === "win32" ? `${plan.asset}.new.exe` : `${plan.asset}.new`;
    const tmpPath = path.join(path.dirname(process.execPath), tmpName);
    try {
      writeFileSync(tmpPath, bytes);
      if (process.platform !== "win32") chmodSync(tmpPath, 0o755);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(pc.red(`Could not write the downloaded bolt: ${message}`));
      process.exit(1);
    }

    const probe = spawnSync(tmpPath, ["version"], { encoding: "utf8" });
    const probedVersion = acceptedBinaryVersion(probe.status, probe.stdout ?? "");
    if (!probedVersion) {
      try {
        unlinkSync(tmpPath);
      } catch {
        console.error(pc.dim(`Downloaded file left at: ${tmpPath}`));
      }
      console.error(
        pc.red("Downloaded bolt did not print a version. The installed bolt was not changed."),
      );
      process.exit(1);
    }

    if (requested && !sameVersion(probedVersion, requested)) {
      try {
        unlinkSync(tmpPath);
      } catch {
        console.error(pc.dim(`Downloaded file left at: ${tmpPath}`));
      }
      console.error(
        pc.red(
          `Downloaded bolt reports ${probedVersion}, not the requested ${normalizeTag(requested).slice(1)}. The installed bolt was not changed.`,
        ),
      );
      process.exit(1);
    }

    const latestVersion = release ? release.tag.replace(/^v/, "") : probedVersion;
    if (!release && !args.force && !isNewer(VERSION, latestVersion)) {
      try {
        unlinkSync(tmpPath);
      } catch {
        // Left next to the binary; the next update overwrites it.
      }
      console.log(pc.green(`Already up to date (v${VERSION})`));
      return;
    }

    try {
      replaceInstalledBinary(process.platform, process.execPath, tmpPath);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(pc.red(`Could not replace binary: ${message}`));
      console.error(pc.dim(`New binary is at: ${tmpPath}`));
      console.error(pc.dim(`Manually replace: ${process.execPath}`));
      process.exit(1);
    }

    writeReceiptVersion(latestVersion, plan.asset);
    console.log(pc.green(`Updated to v${latestVersion}`));
  },
});
