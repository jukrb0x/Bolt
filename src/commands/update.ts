import { defineCommand } from "citty";
import { VERSION } from "../version";
import { writeFileSync, renameSync, chmodSync } from "fs";
import path from "path";
import pc from "picocolors";

const GITHUB_REPO = "jukrb0x/Bolt";
const API_URL = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;

interface GHRelease {
  tag_name: string;
  assets: Array<{ name: string; browser_download_url: string }>;
}

export function isNewer(current: string, latest: string): boolean {
  const parse = (v: string) => v.replace(/^v/, "").split(".").map(Number);
  const [ca, cb, cc] = parse(current);
  const [la, lb, lc] = parse(latest);
  if (la !== ca) return la > ca;
  if (lb !== cb) return lb > cb;
  return lc > cc;
}

function platformAssetName(): string {
  return process.platform === "win32" ? "bolt-win-x64.exe" : "bolt-mac-arm64";
}

export default defineCommand({
  meta: { description: "Update bolt to the latest release" },
  args: {
    force: { type: "boolean", default: false, description: "Re-download even if already up to date" },
  },
  async run({ args }) {
    const execName = path.basename(process.execPath).toLowerCase();
    if (execName.startsWith("bun")) {
      console.error(pc.red("self-update is only available in the compiled binary, not dev mode"));
      process.exit(1);
    }

    console.log(pc.dim(`Current version: ${VERSION}`));
    console.log(pc.dim("Checking for updates..."));

    let release: GHRelease;
    try {
      const res = await fetch(API_URL, {
        headers: { "User-Agent": "bolt-self-update" },
      });
      if (!res.ok) throw new Error(`GitHub API returned ${res.status}`);
      release = await res.json();
    } catch (e: any) {
      console.error(pc.red(`Failed to fetch release info: ${e.message}`));
      process.exit(1);
    }

    const latestTag: string = release!.tag_name ?? "";
    if (!latestTag) {
      console.error(pc.red("Invalid release response: missing tag_name"));
      process.exit(1);
    }
    const latestVersion = latestTag.replace(/^v/, "");

    if (!args.force && !isNewer(VERSION, latestVersion)) {
      console.log(pc.green(`Already up to date (v${VERSION})`));
      return;
    }

    const assetName = platformAssetName();
    const asset = release!.assets.find((a) => a.name === assetName);
    if (!asset) {
      console.error(pc.red(`No asset named "${assetName}" found in release ${latestTag}`));
      process.exit(1);
    }

    console.log(pc.dim(`Downloading ${assetName} v${latestVersion}...`));
    let downloadRes: Response;
    try {
      downloadRes = await fetch(asset.browser_download_url);
    } catch (e: any) {
      console.error(pc.red(`Download failed: ${e.message}`));
      process.exit(1);
    }
    if (!downloadRes!.ok) {
      console.error(pc.red(`Download failed: ${downloadRes!.status}`));
      process.exit(1);
    }

    const buf = Buffer.from(await downloadRes!.arrayBuffer());
    const tmpPath = path.join(path.dirname(process.execPath), assetName + ".new");
    writeFileSync(tmpPath, buf);

    if (process.platform !== "win32") {
      chmodSync(tmpPath, 0o755);
    }

    try {
      renameSync(tmpPath, process.execPath);
      console.log(pc.green(`Updated to v${latestVersion}`));
    } catch (e: any) {
      console.error(pc.red(`Could not replace binary: ${e.message}`));
      console.error(pc.dim(`New binary is at: ${tmpPath}`));
      console.error(pc.dim(`Manually replace: ${process.execPath}`));
      process.exit(1);
    }
  },
});
