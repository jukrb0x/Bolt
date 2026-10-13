#!/usr/bin/env bun
/**
 * Publish the GitHub Release for a tag.
 *
 * A new release is created as a draft and published only after its assets upload,
 * so releases/latest never points at a partial upload. A later run for the same
 * commit accepts a finished release, completes a draft, and fails without editing
 * when the recorded commit or the asset list does not match.
 *
 * Invoked by .github/workflows/release.yml. Concurrency on that workflow only
 * serializes runs of this workflow for the same ref. Another workflow, or a job
 * restarted by hand, can still race; a failed create is re-read and judged again.
 */
import { createHash } from "crypto";
import { existsSync, readFileSync } from "fs";
import { join } from "path";

export interface ReleaseAsset {
  name: string;
  state: string;
  size?: number;
  digest?: string;
}

export interface ReleaseView {
  tagName: string;
  targetCommitish: string;
  isDraft: boolean;
  isPrerelease: boolean;
  assets: ReleaseAsset[];
}

export interface ExpectedRelease {
  tag: string;
  commit: string;
  tagCommit: string;
  assetNames: string[];
  assetDir?: string;
  runId?: string;
  localSums?: { sha256: string; size: number };
}

export type PublishPlan =
  | { action: "create" }
  | { action: "already-published"; warnings: string[] }
  | { action: "repair"; upload: string[]; deleteAssets: string[]; undraft: boolean }
  | { action: "fail"; message: string };

export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface RunOptions {
  argv: string[];
  exec: (command: string, args: string[]) => ExecResult;
  readFile: (file: string) => string;
  exists: (file: string) => boolean;
  env?: Record<string, string | undefined>;
  log?: (line: string) => void;
  error?: (line: string) => void;
}

const SHA = /^[0-9a-f]{40}$/i;
const USAGE =
  "Usage: bun run scripts/publish-release.ts --tag TAG --commit SHA --asset-dir DIR --assets-file FILE --notes-file FILE";

function isSha(value: string): boolean {
  return SHA.test(value);
}

export function parseAssetNames(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/** Commit from `git ls-remote` for an annotated tag (peeled) or a lightweight tag. */
export function commitFromLsRemote(output: string, tag: string): string | null {
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const suffix = `refs/tags/${tag}`;
  const line =
    lines.find((entry) => entry.endsWith(`${suffix}^{}`)) ??
    lines.find((entry) => entry.endsWith(suffix));
  if (!line) return null;
  const sha = line.split(/\s+/)[0] ?? "";
  return isSha(sha) ? sha.toLowerCase() : null;
}

/** Status line from `gh api -i`. Prose such as "release not found" is not a status. */
export function splitHttpMessage(output: string): { status: number; body: string } | null {
  const match = /^(?:HTTP\/\d+(?:\.\d+)?\s+)(\d+)/.exec(output);
  if (!match?.[1]) return null;
  const splitAt = output.search(/\r?\n\r?\n/);
  const body = splitAt === -1 ? "" : output.slice(splitAt).replace(/^\r?\n\r?\n/, "");
  return { status: Number(match[1]), body };
}

export function parseApiRelease(body: string): ReleaseView {
  const raw = JSON.parse(body) as {
    tag_name?: unknown;
    target_commitish?: unknown;
    draft?: unknown;
    prerelease?: unknown;
    assets?: { name?: unknown; state?: unknown; size?: unknown; digest?: unknown }[];
  };
  if (typeof raw.tag_name !== "string" || typeof raw.target_commitish !== "string") {
    throw new Error("release payload is missing tag_name or target_commitish");
  }
  return {
    tagName: raw.tag_name,
    targetCommitish: raw.target_commitish,
    isDraft: raw.draft === true,
    isPrerelease: raw.prerelease === true,
    assets: (raw.assets ?? []).map((asset) => ({
      name: String(asset.name ?? ""),
      state: String(asset.state ?? ""),
      size: typeof asset.size === "number" ? asset.size : undefined,
      digest: typeof asset.digest === "string" ? asset.digest : undefined,
    })),
  };
}

function fail(message: string): PublishPlan {
  return { action: "fail", message };
}

function assetDirOf(expected: ExpectedRelease): string {
  return expected.assetDir ?? "build";
}

function deleteReleaseLines(tag: string, runId?: string): string[] {
  const lines = [
    "Or delete the release and re-run (the tag is kept):",
    `gh release delete ${tag} --yes`,
  ];
  if (runId) lines.push(`gh run rerun ${runId}`);
  return lines;
}

function recoveryLines(
  tag: string,
  assetDir: string,
  upload: string[],
  deleteAssets: string[],
  runId?: string,
): string[] {
  const lines = ["The existing release was not modified."];
  if (upload.length > 0) {
    lines.push("Upload the missing files:");
    for (const name of upload) lines.push(`gh release upload ${tag} ${assetDir}/${name} --clobber`);
  }
  if (deleteAssets.length > 0) {
    lines.push("Delete assets that did not finish uploading, then upload them again:");
    for (const name of deleteAssets) {
      lines.push(`gh release delete-asset ${tag} ${name} -y`);
      lines.push(`gh release upload ${tag} ${assetDir}/${name} --clobber`);
    }
  }
  lines.push(...deleteReleaseLines(tag, runId));
  return lines;
}

function checksumWarnings(existing: ReleaseView, expected: ExpectedRelease): string[] {
  if (!expected.localSums) return [];
  const asset = existing.assets.find((item) => item.name === "SHA256SUMS");
  if (!asset || asset.state !== "uploaded") return [];
  const remote = asset.digest?.replace(/^sha256:/i, "").toLowerCase();
  const local = expected.localSums.sha256.toLowerCase();
  const sizeDiffers = typeof asset.size === "number" && asset.size !== expected.localSums.size;
  const shaDiffers = Boolean(remote) && remote !== local;
  if (!shaDiffers && !sizeDiffers) return [];
  return [
    `Release keeps the assets from the first build. This build's artifacts were not uploaded. SHA256SUMS local ${local} (${expected.localSums.size} bytes), release ${remote || "unknown"} (${typeof asset.size === "number" ? asset.size : "unknown"} bytes).`,
  ];
}

/**
 * Decide whether to create, finish, accept, or refuse the release for this tag.
 * A non-SHA target_commitish (the old publisher stored "main") cannot be tied
 * to a commit, so it fails closed even when the asset names match.
 */
export function planPublish(existing: ReleaseView | null, expected: ExpectedRelease): PublishPlan {
  const tag = expected.tag;
  const assetDir = assetDirOf(expected);
  if (
    expected.assetNames.length === 0 ||
    new Set(expected.assetNames).size !== expected.assetNames.length
  ) {
    return fail(`Refusing to publish ${tag}: asset list is empty or contains duplicates.`);
  }
  if (
    !isSha(expected.commit) ||
    expected.tagCommit.toLowerCase() !== expected.commit.toLowerCase()
  ) {
    return fail(
      [
        `Refusing to publish ${tag}: tag points at ${expected.tagCommit}, expected ${expected.commit}.`,
        "The tag was moved after this run started. Confirm the workflow run for the new tag event; this run can be ignored.",
      ].join("\n"),
    );
  }
  if (!existing) return { action: "create" };

  if (existing.tagName !== tag) {
    return fail(
      [
        `Refusing to publish ${tag}: release tag is ${existing.tagName}.`,
        "The existing release was not modified.",
      ].join("\n"),
    );
  }

  const target = existing.targetCommitish ?? "";
  if (!isSha(target)) {
    const recorded = target.length > 0 ? target : "empty";
    return fail(
      [
        `Refusing to publish ${tag}: this release was created by the old publisher (target_commitish=${recorded}), so the commit cannot be confirmed.`,
        "If this release is known to be correct, ignore this failure.",
        `If the tag was moved, run \`gh release delete ${tag} --yes\` (the tag is kept) and re-run this workflow.`,
        "The existing release was not modified.",
      ].join("\n"),
    );
  }
  if (target.toLowerCase() !== expected.commit.toLowerCase()) {
    return fail(
      [
        `Refusing to publish ${tag}: the release already exists and does not match this run.`,
        `- release targets ${target}, expected ${expected.commit}`,
        "The existing release was not modified.",
        `To replace it: \`gh release delete ${tag} --yes\` (the tag is kept), then re-run this workflow.`,
      ].join("\n"),
    );
  }

  const wantPrerelease = tag.includes("-");
  if (existing.isPrerelease !== wantPrerelease) {
    const flag = wantPrerelease ? "--prerelease=true" : "--prerelease=false";
    return fail(
      [
        `Refusing to publish ${tag}: the release already exists and does not match this run.`,
        wantPrerelease
          ? `- release ${tag} is not marked as a pre-release`
          : `- release ${tag} is marked as a pre-release`,
        "The existing release was not modified.",
        `gh release edit ${tag} ${flag}`,
        ...deleteReleaseLines(tag, expected.runId),
      ].join("\n"),
    );
  }

  const gotNames = existing.assets.map((asset) => asset.name);
  const got = new Set(gotNames);
  const want = new Set(expected.assetNames);
  const reasons: string[] = [];
  if (gotNames.length !== got.size) reasons.push(`release ${tag} lists duplicate assets`);
  const missing = expected.assetNames.filter((name) => !got.has(name));
  const extra = [...got].filter((name) => !want.has(name));
  const pending = existing.assets.filter(
    (asset) => want.has(asset.name) && asset.state !== "uploaded",
  );
  if (missing.length > 0) reasons.push(`missing assets: ${missing.join(", ")}`);
  if (extra.length > 0) reasons.push(`unexpected assets: ${extra.join(", ")}`);
  if (pending.length > 0) {
    reasons.push(
      `assets not uploaded: ${pending.map((asset) => `${asset.name} (${asset.state})`).join(", ")}`,
    );
  }

  const upload = expected.assetNames.filter(
    (name) => !got.has(name) || pending.some((asset) => asset.name === name),
  );
  const deleteAssets = pending.map((asset) => asset.name);

  if (extra.length > 0 || gotNames.length !== got.size) {
    return fail(
      [
        `Refusing to publish ${tag}: the release already exists and does not match this run.`,
        ...reasons.map((reason) => `- ${reason}`),
        ...recoveryLines(tag, assetDir, [], extra, expected.runId),
      ].join("\n"),
    );
  }

  if (upload.length > 0 || deleteAssets.length > 0) {
    if (existing.isDraft) {
      return { action: "repair", upload, deleteAssets, undraft: true };
    }
    return fail(
      [
        `Refusing to publish ${tag}: the release already exists and does not match this run.`,
        ...reasons.map((reason) => `- ${reason}`),
        ...recoveryLines(tag, assetDir, upload, deleteAssets, expected.runId),
      ].join("\n"),
    );
  }

  if (existing.isDraft) return { action: "repair", upload: [], deleteAssets: [], undraft: true };
  return { action: "already-published", warnings: checksumWarnings(existing, expected) };
}

function repoSlug(
  env: Record<string, string | undefined>,
  exec: RunOptions["exec"],
): { repo: string } | { error: string } {
  const fromEnv = env.GITHUB_REPOSITORY?.trim();
  if (fromEnv?.includes("/")) return { repo: fromEnv };
  const result = exec("gh", ["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"]);
  const repo = result.stdout.trim();
  if (result.exitCode !== 0 || !repo.includes("/")) {
    return { error: result.stderr || result.stdout || "no repository" };
  }
  return { repo };
}

function viewRelease(
  repo: string,
  tag: string,
  exec: RunOptions["exec"],
): { release: ReleaseView | null } | { error: string } {
  const result = exec("gh", [
    "api",
    "-i",
    `repos/${repo}/releases/tags/${encodeURIComponent(tag)}`,
  ]);
  const parsed = splitHttpMessage(result.stdout);
  if (!parsed) return { error: result.stderr || result.stdout || "no HTTP status" };
  if (parsed.status === 404) return { release: null };
  if (parsed.status < 200 || parsed.status >= 300) {
    return { error: result.stderr || parsed.body || result.stdout };
  }
  try {
    return { release: parseApiRelease(parsed.body) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { error: message };
  }
}

export function runPublish(options: RunOptions): number {
  const log = options.log ?? ((line: string) => console.log(line));
  const error = options.error ?? ((line: string) => console.error(line));
  const env = options.env ?? process.env;
  const report = (message: string): number => {
    const first = message.split("\n")[0] ?? message;
    error(`::error::${first}`);
    error(message);
    return 1;
  };
  const flag = (name: string): string | undefined => {
    const index = options.argv.indexOf(name);
    const value = index === -1 ? undefined : options.argv[index + 1];
    if (!value || value.startsWith("--")) return undefined;
    return value;
  };

  const tag = flag("--tag");
  const commitArg = flag("--commit");
  const assetDir = flag("--asset-dir");
  const assetsFile = flag("--assets-file");
  const notesFile = flag("--notes-file");
  if (!tag || !commitArg || !assetDir || !assetsFile || !notesFile) {
    return report(
      `Refusing to publish: missing --tag, --commit, --asset-dir, --assets-file, or --notes-file.\n${USAGE}`,
    );
  }
  const commit = commitArg.toLowerCase();
  if (!options.exists(assetsFile)) {
    return report(`Refusing to publish ${tag}: cannot read assets file ${assetsFile}.`);
  }
  let assetNames: string[];
  try {
    assetNames = parseAssetNames(options.readFile(assetsFile));
  } catch {
    return report(`Refusing to publish ${tag}: cannot read assets file ${assetsFile}.`);
  }

  let localSums: { sha256: string; size: number } | undefined;
  const sumsPath = join(assetDir, "SHA256SUMS");
  if (options.exists(sumsPath)) {
    try {
      const text = options.readFile(sumsPath);
      localSums = {
        sha256: createHash("sha256").update(text).digest("hex"),
        size: Buffer.byteLength(text),
      };
    } catch {
      localSums = undefined;
    }
  }

  const repo = repoSlug(env, options.exec);
  if ("error" in repo) {
    return report(`Refusing to publish ${tag}: unable to determine the repository.\n${repo.error}`);
  }
  const remote = options.exec("git", [
    "ls-remote",
    "origin",
    `refs/tags/${tag}`,
    `refs/tags/${tag}^{}`,
  ]);
  if (remote.exitCode !== 0) {
    return report(
      `Refusing to publish ${tag}: unable to read the tag on origin.\n${remote.stderr}`,
    );
  }
  const tagCommit = commitFromLsRemote(remote.stdout, tag);
  if (!tagCommit) return report(`Refusing to publish ${tag}: tag is not on origin.`);

  const expected: ExpectedRelease = {
    tag,
    commit,
    tagCommit,
    assetNames,
    assetDir,
    runId: env.GITHUB_RUN_ID,
    localSums,
  };

  const loaded = viewRelease(repo.repo, tag, options.exec);
  if ("error" in loaded) {
    return report(`Refusing to publish ${tag}: unable to query the release.\n${loaded.error}`);
  }

  const missingFile = (names: string[]): string | undefined => {
    for (const name of names) {
      const file = join(assetDir, name);
      if (!options.exists(file)) return file;
    }
    return undefined;
  };

  const undraft = (): number => {
    const edited = options.exec("gh", ["release", "edit", tag, "--draft=false"]);
    if (edited.exitCode !== 0) {
      return report(
        `Refusing to publish ${tag}: the draft was not published.\ngh release edit ${tag} --draft=false\n${edited.stderr}`,
      );
    }
    log(`Published release ${tag} for ${commit}.`);
    log(`tag ${tagCommit} target ${commit}; compared ${assetNames.length} assets.`);
    return 0;
  };

  const apply = (plan: PublishPlan, existing: ReleaseView | null): number => {
    if (plan.action === "fail") return report(plan.message);
    if (plan.action === "already-published") {
      log(`Release ${tag} already exists for ${commit} with the expected assets.`);
      log(
        `tag ${tagCommit} target ${existing?.targetCommitish ?? commit}; compared ${assetNames.length} assets.`,
      );
      for (const warning of plan.warnings) log(warning);
      return 0;
    }
    if (plan.action === "repair") {
      const absent = missingFile(plan.upload);
      if (absent) return report(`Refusing to publish ${tag}: missing file ${absent}.`);
      log(
        `Release ${tag} is a draft for ${commit}. Incomplete assets: ${plan.deleteAssets.length}. Uploading ${plan.upload.length}.`,
      );
      for (const name of plan.deleteAssets) {
        const deleted = options.exec("gh", ["release", "delete-asset", tag, name, "-y"]);
        if (deleted.exitCode !== 0) {
          return report(
            `Refusing to publish ${tag}: unable to delete asset ${name}.\ngh release delete-asset ${tag} ${name} -y\n${deleted.stderr}`,
          );
        }
      }
      if (plan.upload.length > 0) {
        const uploaded = options.exec("gh", [
          "release",
          "upload",
          tag,
          ...plan.upload.map((name) => join(assetDir, name)),
          "--clobber",
        ]);
        if (uploaded.exitCode !== 0) {
          return report(
            `Refusing to publish ${tag}: asset upload failed.\ngh release upload ${tag} ${plan.upload.map((name) => `${assetDir}/${name}`).join(" ")} --clobber\n${uploaded.stderr}`,
          );
        }
      }
      return plan.undraft ? undraft() : 0;
    }

    if (!options.exists(notesFile)) {
      return report(`Refusing to publish ${tag}: cannot read notes file ${notesFile}.`);
    }
    const absent = missingFile(assetNames);
    if (absent) return report(`Refusing to publish ${tag}: missing file ${absent}.`);
    const args = [
      "release",
      "create",
      tag,
      ...assetNames.map((name) => join(assetDir, name)),
      "--draft",
      "--target",
      commit,
      "--title",
      tag,
      "--notes-file",
      notesFile,
    ];
    if (tag.includes("-")) args.push("--prerelease");
    const created = options.exec("gh", args);
    if (created.exitCode === 0) {
      log(`Created draft release ${tag} for ${commit}.`);
      return undraft();
    }
    log(`Release create failed. Checking ${tag} again.`);
    const again = viewRelease(repo.repo, tag, options.exec);
    if ("error" in again) {
      return report(
        `Refusing to publish ${tag}: unable to query the release.\n${again.error}\n${created.stderr}`,
      );
    }
    const planAgain = planPublish(again.release, expected);
    if (planAgain.action === "create") {
      return report(
        `Refusing to publish ${tag}: release create failed.\n${created.stderr || created.stdout}`,
      );
    }
    return apply(planAgain, again.release);
  };

  return apply(planPublish(loaded.release, expected), loaded.release);
}

if (import.meta.main) {
  const code = runPublish({
    argv: process.argv.slice(2),
    exec: (command, args) => {
      const result = Bun.spawnSync([command, ...args], {
        stdout: "pipe",
        stderr: "pipe",
        env: process.env,
      });
      return {
        exitCode: result.exitCode ?? 1,
        stdout: new TextDecoder().decode(result.stdout),
        stderr: new TextDecoder().decode(result.stderr),
      };
    },
    readFile: (file) => readFileSync(file, "utf8"),
    exists: existsSync,
  });
  process.exit(code);
}
