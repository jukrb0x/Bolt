/**
 * Find the release self-update installs, preferring plain github.com URLs over the API.
 *
 * 1. `https://github.com/<repo>/releases/latest` answers with a redirect to
 *    `/releases/tag/<tag>`. Assets live at `/releases/download/<tag>/<name>`.
 *    Neither URL counts against the api.github.com rate limit.
 * 2. If that redirect cannot be read, ask api.github.com with a token from
 *    GH_TOKEN, GITHUB_TOKEN, or `gh auth token`, else anonymously.
 *
 * Tokens are only ever sent in an Authorization header and never printed.
 */
import { spawnSync } from "child_process";
import { existsSync, statSync } from "fs";
import path from "path";

export const GITHUB_REPO = "jukrb0x/Bolt";
export const PUBLIC_RELEASES_WEB = `https://github.com/${GITHUB_REPO}/releases`;
export const PUBLIC_RELEASES_API = `https://api.github.com/repos/${GITHUB_REPO}/releases`;

export const RATE_LIMIT_MESSAGE =
  "GitHub rate limited this request (api.github.com allows few anonymous requests per IP, and shared office IPs run out). " +
  "Set GH_TOKEN to a GitHub token and run bolt self-update again, or reinstall with the install one-liner: " +
  "irm https://raw.githubusercontent.com/jukrb0x/Bolt/main/install.ps1 | iex (Windows) or " +
  "curl -fsSL https://raw.githubusercontent.com/jukrb0x/Bolt/main/install.sh | sh (macOS/Linux).";

export class RateLimitError extends Error {
  constructor(status: number) {
    super(`GitHub API returned ${status}. ${RATE_LIMIT_MESSAGE}`);
    this.name = "RateLimitError";
  }
}

/**
 * A 403 is only a rate limit when GitHub says no requests remain. 429 always is.
 * Other 403s (blocked token, SSO, proxy) keep their plain status.
 */
export function isRateLimited(status: number, remaining: string | null | undefined): boolean {
  if (status === 429) return true;
  return status === 403 && remaining?.trim() === "0";
}

/**
 * Check a BOLT_* release override. They exist for tests and local fixtures, so plain
 * http is only allowed for localhost and 127.0.0.1.
 */
export function checkOverrideUrl(name: string, value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error(`${name} is not a URL: ${trimmed}`);
  }
  const local =
    url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  if (url.protocol === "https:" || (url.protocol === "http:" && local)) {
    return trimmed.replace(/\/+$/, "");
  }
  throw new Error(
    `${name} must be an https URL (plain http only for localhost or 127.0.0.1). It is a test-only setting; unset it for normal updates.`,
  );
}

/** Only api.github.com gets the token, never a fixture or proxy host. */
export function mayAttachToken(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && parsed.hostname === "api.github.com";
  } catch {
    return false;
  }
}

export interface ResolvedRelease {
  /** Tag such as v2.1.4. */
  tag: string;
  sumsUrl: string;
  assetUrl: string;
  /** How the tag was found. */
  via: "web" | "api";
}

export interface ResolveDeps {
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
  env: Record<string, string | undefined>;
  /** Token from `gh auth token`, or undefined. */
  ghToken: () => string | undefined;
  /** Progress lines. Never receives a token. */
  log: (message: string) => void;
}

const USER_AGENT = "bolt-self-update";

function trimBase(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed.replace(/\/+$/, "") : fallback;
}

/** github.com releases page, unless BOLT_RELEASES_URL (test-only) points at a local release. */
export function releasesWebBase(override: string | undefined): string {
  return trimBase(checkOverrideUrl("BOLT_RELEASES_URL", override), PUBLIC_RELEASES_WEB);
}

/** Public GitHub releases API, unless BOLT_RELEASES_API (test-only) points at a local release. */
export function releasesApiBase(override: string | undefined): string {
  return trimBase(checkOverrideUrl("BOLT_RELEASES_API", override), PUBLIC_RELEASES_API);
}

export function normalizeTag(version: string): string {
  const v = version.trim();
  return v.startsWith("v") ? v : `v${v}`;
}

/** Tag from a `/releases/tag/<tag>` redirect Location, or null. */
export function tagFromLocation(location: string | null | undefined): string | null {
  if (!location) return null;
  const match = /\/releases\/tag\/([^/?#]+)/.exec(location);
  if (!match) return null;
  const tag = decodeURIComponent(match[1]);
  return /^v?[0-9]+\.[0-9]+\.[0-9]+[0-9A-Za-z.+-]*$/.test(tag) ? tag : null;
}

export function downloadUrls(webBase: string, tag: string, asset: string) {
  const dir = `${webBase}/download/${encodeURIComponent(tag)}`;
  return { sumsUrl: `${dir}/SHA256SUMS`, assetUrl: `${dir}/${asset}` };
}

/** First token from GH_TOKEN, GITHUB_TOKEN, then `gh auth token`. */
export function findToken(deps: Pick<ResolveDeps, "env" | "ghToken">): string | undefined {
  for (const name of ["GH_TOKEN", "GITHUB_TOKEN"]) {
    const value = deps.env[name]?.trim();
    if (value) return value;
  }
  return deps.ghToken();
}

/**
 * Absolute path of `name` on PATH, skipping empty, ".", relative, and current-directory
 * entries so a gh.exe dropped in the working directory is never run (Windows searches
 * the current directory first when a bare name is spawned).
 */
export function findOnPath(
  name: string,
  env: Record<string, string | undefined>,
  platform: string = process.platform,
  cwd: string = process.cwd(),
): string | undefined {
  const pathValue = env.PATH ?? env.Path ?? "";
  const sep = platform === "win32" ? ";" : ":";
  // gh ships as gh.exe on Windows; .cmd/.bat shims are not run.
  const exts = platform === "win32" ? [".exe"] : [""];
  const norm = (p: string) => {
    const r = path.resolve(p).replace(/[\\/]+$/, "");
    return platform === "win32" ? r.toLowerCase() : r;
  };
  const here = norm(cwd);
  for (const raw of pathValue.split(sep)) {
    const dir = raw.trim().replace(/^"|"$/g, "");
    if (!dir || dir === "." || !path.isAbsolute(dir)) continue;
    if (norm(dir) === here) continue;
    for (const ext of exts) {
      const candidate = path.join(dir, name + ext);
      try {
        if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
      } catch {
        // Unreadable entry; keep looking.
      }
    }
  }
  return undefined;
}

/** `gh auth token` when gh is installed and logged in. Output is never printed. */
export function ghAuthToken(): string | undefined {
  const gh = findOnPath("gh", process.env);
  if (!gh) return undefined;
  try {
    const result = spawnSync(gh, ["auth", "token"], {
      encoding: "utf8",
      timeout: 5000,
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    });
    if (result.status !== 0) return undefined;
    const token = (result.stdout ?? "").trim();
    return token || undefined;
  } catch {
    return undefined;
  }
}

async function latestTagFromWeb(webBase: string, deps: ResolveDeps): Promise<string | null> {
  try {
    const res = await deps.fetch(`${webBase}/latest`, {
      redirect: "manual",
      headers: { "User-Agent": USER_AGENT },
    });
    if (res.status < 300 || res.status >= 400) return null;
    return tagFromLocation(res.headers.get("location"));
  } catch {
    return null;
  }
}

interface ApiRelease {
  tag_name?: string;
  assets?: Array<{ name: string; browser_download_url: string }>;
}

async function releaseFromApi(
  apiBase: string,
  requested: string | undefined,
  asset: string,
  deps: ResolveDeps,
): Promise<ResolvedRelease> {
  const url = requested
    ? `${apiBase}/tags/${encodeURIComponent(normalizeTag(requested))}`
    : `${apiBase}/latest`;
  const token = mayAttachToken(url) ? findToken(deps) : undefined;
  const headers: Record<string, string> = {
    "User-Agent": USER_AGENT,
    Accept: "application/vnd.github+json",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  deps.log(token ? "Asking the GitHub API (authenticated)..." : "Asking the GitHub API...");
  let res = await deps.fetch(url, { headers });
  if (res.status === 401 && token) {
    // A stale or revoked token. Public releases do not need one.
    deps.log("The GitHub token was rejected (401). Retrying without it...");
    const { Authorization: _dropped, ...anonymous } = headers;
    res = await deps.fetch(url, { headers: anonymous });
  }
  if (isRateLimited(res.status, res.headers.get("x-ratelimit-remaining"))) {
    throw new RateLimitError(res.status);
  }
  if (res.status === 404 && requested)
    throw new Error(`Release ${normalizeTag(requested)} not found`);
  if (!res.ok) throw new Error(`GitHub API returned ${res.status}`);
  const release = (await res.json()) as ApiRelease;
  const tag = release.tag_name ?? "";
  if (!tag) throw new Error("Invalid release response: missing tag_name");
  const sums = release.assets?.find((a) => a.name === "SHA256SUMS");
  const binary = release.assets?.find((a) => a.name === asset);
  if (!sums || !binary) throw new Error(`Release ${tag} is missing ${asset} or SHA256SUMS`);
  return {
    tag,
    sumsUrl: sums.browser_download_url,
    assetUrl: binary.browser_download_url,
    via: "api",
  };
}

/**
 * Pick the release and its download URLs. BOLT_RELEASES_API forces the API path
 * (used by the local release fixture). Otherwise the github.com redirect is tried first.
 */
export async function resolveRelease(
  asset: string,
  requested: string | undefined,
  deps: ResolveDeps,
): Promise<ResolvedRelease> {
  if (deps.env.BOLT_RELEASES_API?.trim()) {
    return releaseFromApi(releasesApiBase(deps.env.BOLT_RELEASES_API), requested, asset, deps);
  }
  const webBase = releasesWebBase(deps.env.BOLT_RELEASES_URL);
  if (requested) {
    const tag = normalizeTag(requested);
    return { tag, ...downloadUrls(webBase, tag, asset), via: "web" };
  }
  const tag = await latestTagFromWeb(webBase, deps);
  if (tag) return { tag, ...downloadUrls(webBase, tag, asset), via: "web" };
  deps.log("Could not read the latest release from github.com. Falling back to the GitHub API.");
  return releaseFromApi(PUBLIC_RELEASES_API, undefined, asset, deps);
}

/** Default dependencies for a real run. */
export function defaultResolveDeps(log: (message: string) => void): ResolveDeps {
  return { fetch: (url, init) => fetch(url, init), env: process.env, ghToken: ghAuthToken, log };
}
