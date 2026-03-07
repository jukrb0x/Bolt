import { existsSync, readFileSync, rmSync } from "fs";
import path from "path";
import { tmpdir } from "os";
import { BUNDLED_TEMPLATE } from "./bundled-template";

export interface TemplateResult {
  ok: true;
  content: string;
  source: string;
}

export interface TemplateError {
  ok: false;
  error: string;
}

export type TemplateLoadResult = TemplateResult | TemplateError;

/**
 * Detect if URL is a git repository URL
 */
function isGitUrl(url: string): boolean {
  return (
    url.endsWith(".git") ||
    url.startsWith("git@") ||
    url.startsWith("https://github.com/") ||
    url.startsWith("https://gitlab.com/") ||
    url.startsWith("https://bitbucket.org/")
  );
}

/**
 * Try to construct a raw file URL for known hosting platforms.
 * Returns null for unrecognised hosts.
 */
function rawBoltYamlUrl(repoUrl: string): string | null {
  try {
    const url = new URL(repoUrl);
    const pathParts = url.pathname.replace(/\.git$/, "").replace(/\/$/, "").split("/").filter(Boolean);
    if (pathParts.length < 2) return null;
    const [owner, repo] = pathParts;

    if (url.hostname === "github.com") {
      return `https://raw.githubusercontent.com/${owner}/${repo}/HEAD/bolt.yaml`;
    }
    if (url.hostname === "gitlab.com") {
      return `https://gitlab.com/${owner}/${repo}/-/raw/HEAD/bolt.yaml`;
    }
    if (url.hostname === "bitbucket.org") {
      return `https://bitbucket.org/${owner}/${repo}/raw/HEAD/bolt.yaml`;
    }
  } catch {
    // Not a valid URL (e.g. git@...) — fall through
  }
  return null;
}

function cleanupTempDir(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
}

/**
 * Load bolt.yaml from a git repository without cloning the full tree.
 *
 * Strategy A: For GitHub/GitLab/Bitbucket, fetch the raw file directly via HTTP.
 * Strategy B: For generic git URLs, use sparse checkout to fetch only bolt.yaml.
 *             --no-checkout prevents git hooks from running during clone.
 */
async function loadFromGitRepo(url: string): Promise<TemplateLoadResult> {
  // Strategy A — raw URL fetch for known platforms
  const rawUrl = rawBoltYamlUrl(url);
  if (rawUrl) {
    try {
      const res = await fetch(rawUrl);
      if (res.ok) {
        const content = await res.text();
        return { ok: true, content, source: url };
      }
      // Non-200 — fall through to Strategy B
    } catch {
      // Network error — fall through to Strategy B
    }
  }

  // Strategy B — sparse checkout (generic git URLs, git@..., .git)
  const tempDir = path.join(tmpdir(), `.bolt-template-${Date.now()}`);

  try {
    // Clone metadata only — no files checked out, no hooks executed
    const cloneResult = Bun.spawnSync([
      "git", "clone", "--depth", "1", "--filter=blob:none", "--no-checkout", url, tempDir,
    ]);
    if (cloneResult.exitCode !== 0) {
      cleanupTempDir(tempDir);
      return { ok: false, error: `Git clone failed: ${cloneResult.stderr.toString()}` };
    }

    // Configure sparse checkout to only fetch bolt.yaml
    const initResult = Bun.spawnSync(
      ["git", "sparse-checkout", "init", "--no-cone"],
      { cwd: tempDir },
    );
    if (initResult.exitCode !== 0) {
      cleanupTempDir(tempDir);
      return { ok: false, error: `Sparse checkout init failed: ${initResult.stderr.toString()}` };
    }

    const setResult = Bun.spawnSync(
      ["git", "sparse-checkout", "set", "bolt.yaml"],
      { cwd: tempDir },
    );
    if (setResult.exitCode !== 0) {
      cleanupTempDir(tempDir);
      return { ok: false, error: `Sparse checkout set failed: ${setResult.stderr.toString()}` };
    }

    // Checkout only materialises bolt.yaml
    const checkoutResult = Bun.spawnSync(["git", "checkout"], { cwd: tempDir });
    if (checkoutResult.exitCode !== 0) {
      cleanupTempDir(tempDir);
      return { ok: false, error: `Git checkout failed: ${checkoutResult.stderr.toString()}` };
    }

    const boltYamlPath = path.join(tempDir, "bolt.yaml");
    if (!existsSync(boltYamlPath)) {
      cleanupTempDir(tempDir);
      return { ok: false, error: `No bolt.yaml found in repository root` };
    }

    const content = readFileSync(boltYamlPath, "utf8");
    cleanupTempDir(tempDir);
    return { ok: true, content, source: url };
  } catch (err) {
    cleanupTempDir(tempDir);
    return { ok: false, error: `Failed to load from git repo: ${err}` };
  }
}

/**
 * Load template from local file, remote URL, or bundled fallback.
 * Priority: git repo > http fetch > local > cwd template > bundled fallback
 */
export async function loadTemplate(options: {
  remote?: string;
  template?: string;
}): Promise<TemplateLoadResult> {
  const { remote, template } = options;

  // 1. Remote URL (git repo or http fetch)
  if (remote) {
    // Check if remote looks like a git URL
    if (isGitUrl(remote)) {
      const result = await loadFromGitRepo(remote);
      if (result.ok) return result;
      // If git clone fails, fall through to other methods
    } else {
      // Try HTTP fetch for non-git URLs
      try {
        const res = await fetch(remote);
        if (!res.ok) {
          return { ok: false, error: `Failed to fetch remote: ${res.status} ${res.statusText}` };
        }
        const content = await res.text();
        return { ok: true, content, source: remote };
      } catch (err) {
        return { ok: false, error: `Failed to fetch remote: ${err}` };
      }
    }
  }

  // 2. Local template path
  if (template) {
    const templatePath = path.resolve(template);
    if (!existsSync(templatePath)) {
      return { ok: false, error: `Template file not found: ${templatePath}` };
    }
    try {
      const content = readFileSync(templatePath, "utf8");
      return { ok: true, content, source: templatePath };
    } catch (err) {
      return { ok: false, error: `Failed to read template: ${err}` };
    }
  }

  // 3. bolt.template.yaml in cwd
  const cwdTemplate = path.join(process.cwd(), "bolt.template.yaml");
  if (existsSync(cwdTemplate)) {
    try {
      const content = readFileSync(cwdTemplate, "utf8");
      return { ok: true, content, source: cwdTemplate };
    } catch {
      // Fall through to bundled
    }
  }

  // 4. Bundled fallback (minimal template)
  const bundledTemplate = getBundledTemplate();
  return { ok: true, content: bundledTemplate, source: "bundled" };
}

export function getBundledTemplate(): string {
  return BUNDLED_TEMPLATE;
}
