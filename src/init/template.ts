import { existsSync, readFileSync } from "fs";
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
 * Load template from git repository by cloning to temp directory
 */
async function loadFromGitRepo(url: string): Promise<TemplateLoadResult> {
  const tempDir = path.join(tmpdir(), `.bolt-template-${Date.now()}`);

  try {
    // 1. Clone to temp directory (shallow clone for speed)
    const cloneResult = Bun.spawnSync(["git", "clone", "--depth", "1", url, tempDir]);
    if (cloneResult.exitCode !== 0) {
      return { ok: false, error: `Git clone failed: ${cloneResult.stderr.toString()}` };
    }

    // 2. Find bolt.yaml in root
    const boltYamlPath = path.join(tempDir, "bolt.yaml");
    if (!existsSync(boltYamlPath)) {
      return { ok: false, error: `No bolt.yaml found in repository root` };
    }

    // 3. Read content
    const content = readFileSync(boltYamlPath, "utf8");

    // 4. Cleanup temp dir
    const cleanupResult = Bun.spawnSync(
      process.platform === "win32" ? ["cmd", "/c", "rmdir", "/s", "/q", tempDir] : ["rm", "-rf", tempDir]
    );

    return { ok: true, content, source: url };
  } catch (err) {
    // Cleanup on error
    Bun.spawnSync(
      process.platform === "win32" ? ["cmd", "/c", "rmdir", "/s", "/q", tempDir] : ["rm", "-rf", tempDir]
    );
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
