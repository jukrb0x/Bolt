import { expect, test } from "bun:test";
import {
  RATE_LIMIT_MESSAGE,
  RateLimitError,
  checkOverrideUrl,
  findOnPath,
  findToken,
  isRateLimited,
  mayAttachToken,
  resolveRelease,
  tagFromLocation,
  type ResolveDeps,
} from "../release-source";
import {
  compareVersions,
  downloadFailureMessage,
  isNewer,
  requestedVersion,
  sameVersion,
} from "../commands/update";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";

const SECRET = "ghp_supersecretTOKEN1234567890";
const ASSET = "bolt-win-x64.exe";

interface Call {
  url: string;
  init?: RequestInit;
}

function authOf(call: Call): string | undefined {
  return ((call.init?.headers ?? {}) as Record<string, string>).Authorization;
}

function deps(
  handler: (url: string, init?: RequestInit) => Response | Promise<Response>,
  env: Record<string, string | undefined> = {},
  gh: string | undefined = undefined,
) {
  const calls: Call[] = [];
  const logs: string[] = [];
  let ghCalls = 0;
  const d: ResolveDeps = {
    fetch: async (url, init) => {
      calls.push({ url, init });
      return handler(url, init);
    },
    env,
    ghToken: () => {
      ghCalls++;
      return gh;
    },
    log: (m) => logs.push(m),
  };
  return { d, calls, logs, ghCalls: () => ghCalls };
}

const apiRelease = (tag: string) =>
  Response.json({
    tag_name: tag,
    assets: [
      { name: "SHA256SUMS", browser_download_url: `https://dl/${tag}/SHA256SUMS` },
      { name: ASSET, browser_download_url: `https://dl/${tag}/${ASSET}` },
    ],
  });

test("tagFromLocation reads the tag from the release redirect", () => {
  expect(tagFromLocation("https://github.com/jukrb0x/Bolt/releases/tag/v2.1.4")).toBe("v2.1.4");
  expect(tagFromLocation("/jukrb0x/Bolt/releases/tag/v3.0.0-rc.1")).toBe("v3.0.0-rc.1");
  expect(tagFromLocation("https://github.com/jukrb0x/Bolt/releases/tag/v2.1.4?x=1")).toBe("v2.1.4");
  expect(tagFromLocation("https://github.com/jukrb0x/Bolt/releases")).toBeNull();
  expect(tagFromLocation("https://github.com/login?return_to=x")).toBeNull();
  expect(tagFromLocation("https://github.com/jukrb0x/Bolt/releases/tag/latest")).toBeNull();
  expect(tagFromLocation(null)).toBeNull();
});

test("latest release comes from the github.com redirect without the API", async () => {
  const { d, calls } = deps(
    () =>
      new Response(null, {
        status: 302,
        headers: { Location: "https://github.com/jukrb0x/Bolt/releases/tag/v2.1.4" },
      }),
  );
  const release = await resolveRelease(ASSET, undefined, d);
  expect(release).toEqual({
    tag: "v2.1.4",
    via: "web",
    sumsUrl: "https://github.com/jukrb0x/Bolt/releases/download/v2.1.4/SHA256SUMS",
    assetUrl: `https://github.com/jukrb0x/Bolt/releases/download/v2.1.4/${ASSET}`,
  });
  expect(calls).toHaveLength(1);
  expect(calls[0].url).toBe("https://github.com/jukrb0x/Bolt/releases/latest");
  expect(calls[0].init?.redirect).toBe("manual");
  expect(calls.some((c) => c.url.includes("api.github.com"))).toBe(false);
});

test("an explicit version uses the download URL pattern and no request", async () => {
  const { d, calls } = deps(() => new Response("no", { status: 500 }));
  const release = await resolveRelease(ASSET, "2.1.0", d);
  expect(release.tag).toBe("v2.1.0");
  expect(release.assetUrl).toBe(
    `https://github.com/jukrb0x/Bolt/releases/download/v2.1.0/${ASSET}`,
  );
  expect(calls).toHaveLength(0);
});

test("BOLT_RELEASES_URL replaces the github.com base", async () => {
  const { d, calls } = deps(
    () =>
      new Response(null, {
        status: 302,
        headers: { Location: "http://127.0.0.1:8765/releases/tag/v2.0.1" },
      }),
    { BOLT_RELEASES_URL: "http://127.0.0.1:8765/releases/" },
  );
  const release = await resolveRelease(ASSET, undefined, d);
  expect(calls[0].url).toBe("http://127.0.0.1:8765/releases/latest");
  expect(release.sumsUrl).toBe("http://127.0.0.1:8765/releases/download/v2.0.1/SHA256SUMS");
});

test("fallback order: GH_TOKEN, then GITHUB_TOKEN, then gh auth token, then anonymous", () => {
  expect(findToken({ env: { GH_TOKEN: "a", GITHUB_TOKEN: "b" }, ghToken: () => "c" })).toBe("a");
  expect(findToken({ env: { GH_TOKEN: " ", GITHUB_TOKEN: "b" }, ghToken: () => "c" })).toBe("b");
  expect(findToken({ env: {}, ghToken: () => "c" })).toBe("c");
  expect(findToken({ env: {}, ghToken: () => undefined })).toBeUndefined();
});

test("a redirect that cannot be parsed falls back to the API with a token", async () => {
  const { d, calls, logs } = deps(
    (url) =>
      url.includes("api.github.com") ? apiRelease("v2.1.5") : new Response("page", { status: 200 }),
    { GH_TOKEN: SECRET },
  );
  const release = await resolveRelease(ASSET, undefined, d);
  expect(release).toEqual({
    tag: "v2.1.5",
    via: "api",
    sumsUrl: "https://dl/v2.1.5/SHA256SUMS",
    assetUrl: `https://dl/v2.1.5/${ASSET}`,
  });
  expect(calls.map((c) => c.url)).toEqual([
    "https://github.com/jukrb0x/Bolt/releases/latest",
    "https://api.github.com/repos/jukrb0x/Bolt/releases/latest",
  ]);
  expect(authOf(calls[1])).toBe(`Bearer ${SECRET}`);
  expect(logs.join("\n")).not.toContain(SECRET);
});

test("the API fallback uses gh auth token when no env token is set, else goes anonymous", async () => {
  const handler = (url: string) =>
    url.includes("api.github.com") ? apiRelease("v2.1.5") : Promise.reject(new Error("offline"));
  const withGh = deps(handler, {}, SECRET);
  await resolveRelease(ASSET, undefined, withGh.d);
  expect(withGh.ghCalls()).toBe(1);
  expect(authOf(withGh.calls[1])).toBe(`Bearer ${SECRET}`);

  const anon = deps(handler, {}, undefined);
  await resolveRelease(ASSET, undefined, anon.d);
  expect(authOf(anon.calls[1])).toBeUndefined();
});

test("a 403 or 429 from the API gives the rate-limit message and never the token", async () => {
  for (const status of [403, 429]) {
    const { d, logs } = deps(
      (url) =>
        url.includes("api.github.com")
          ? new Response("limited", { status, headers: { "x-ratelimit-remaining": "0" } })
          : new Response("x"),
      { GITHUB_TOKEN: SECRET },
    );
    let error: unknown;
    try {
      await resolveRelease(ASSET, undefined, d);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(RateLimitError);
    const message = (error as Error).message;
    expect(message).toContain(`GitHub API returned ${status}`);
    expect(message).toContain("Set GH_TOKEN");
    expect(message).toContain("install.ps1 | iex");
    expect(message).not.toContain(SECRET);
    expect(logs.join("\n")).not.toContain(SECRET);
  }
});

test("BOLT_RELEASES_API keeps the API path for the local release fixture", async () => {
  const { d, calls } = deps(() => apiRelease("v2.0.1"), {
    BOLT_RELEASES_API: "http://127.0.0.1:8765/repos/jukrb0x/Bolt/releases",
  });
  const release = await resolveRelease(ASSET, undefined, d);
  expect(release.via).toBe("api");
  expect(calls[0].url).toBe("http://127.0.0.1:8765/repos/jukrb0x/Bolt/releases/latest");
});

test("download failures explain rate limits and missing releases", () => {
  expect(downloadFailureMessage(429, undefined)).toBe(RATE_LIMIT_MESSAGE);
  expect(downloadFailureMessage(404, "v9.9.9")).toContain("Release v9.9.9");
  expect(downloadFailureMessage(500, "v2.1.4")).toBe("");
});

describeExtras();

function describeExtras() {
  const limited = (status: number, remaining?: string) =>
    new Response("x", {
      status,
      headers: remaining === undefined ? {} : { "x-ratelimit-remaining": remaining },
    });

  test("a 403 is a rate limit only when x-ratelimit-remaining is 0", async () => {
    expect(isRateLimited(403, "0")).toBe(true);
    expect(isRateLimited(403, "12")).toBe(false);
    expect(isRateLimited(403, null)).toBe(false);
    expect(isRateLimited(429, null)).toBe(true);
    const { d } = deps((url) =>
      url.includes("api.github.com") ? limited(403, "57") : new Response("x"),
    );
    let message = "";
    try {
      await resolveRelease(ASSET, undefined, d);
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toBe("GitHub API returned 403");
  });

  test("a 401 with a token is retried anonymously", async () => {
    let apiCalls = 0;
    const { d, calls, logs } = deps(
      (url) => {
        if (!url.includes("api.github.com")) return new Response("html", { status: 200 });
        apiCalls++;
        return apiCalls === 1 ? new Response("bad creds", { status: 401 }) : apiRelease("v2.1.6");
      },
      { GH_TOKEN: SECRET },
    );
    const release = await resolveRelease(ASSET, undefined, d);
    expect(release.tag).toBe("v2.1.6");
    expect(authOf(calls[1])).toBe(`Bearer ${SECRET}`);
    expect(authOf(calls[2])).toBeUndefined();
    expect(logs.join("\n")).toContain("401");
    expect(logs.join("\n")).not.toContain(SECRET);
  });

  test("the token is only sent to api.github.com", async () => {
    expect(mayAttachToken("https://api.github.com/repos/x/y/releases/latest")).toBe(true);
    expect(mayAttachToken("http://api.github.com/repos")).toBe(false);
    expect(mayAttachToken("https://api.github.com.evil.example/repos")).toBe(false);
    expect(mayAttachToken("http://127.0.0.1:8765/repos")).toBe(false);
    const { d, calls } = deps(() => apiRelease("v2.0.1"), {
      BOLT_RELEASES_API: "http://127.0.0.1:8765/repos/jukrb0x/Bolt/releases",
      GH_TOKEN: SECRET,
    });
    await resolveRelease(ASSET, undefined, d);
    expect(authOf(calls[0])).toBeUndefined();
  });

  test("release overrides must be https unless they point at localhost", async () => {
    expect(checkOverrideUrl("X", "https://mirror.example/releases/")).toBe(
      "https://mirror.example/releases",
    );
    expect(checkOverrideUrl("X", "http://127.0.0.1:8765/a")).toBe("http://127.0.0.1:8765/a");
    expect(checkOverrideUrl("X", "http://localhost/a")).toBe("http://localhost/a");
    expect(checkOverrideUrl("X", undefined)).toBeUndefined();
    expect(() => checkOverrideUrl("BOLT_INSTALL_BASE", "http://mirror.example/a")).toThrow(
      /BOLT_INSTALL_BASE must be an https URL/,
    );
    expect(() => checkOverrideUrl("X", "file:///tmp/x")).toThrow(/https/);
    const { d } = deps(() => new Response("x"), { BOLT_RELEASES_API: "http://evil.example/api" });
    await expect(resolveRelease(ASSET, undefined, d)).rejects.toThrow(/test-only/);
  });

  test("a proxy that answers /releases/latest with a 200 HTML page falls back to the API", async () => {
    const { d, calls } = deps((url) =>
      url.includes("api.github.com")
        ? apiRelease("v2.1.7")
        : new Response("<html>Proxy login</html>", {
            status: 200,
            headers: { "content-type": "text/html" },
          }),
    );
    const release = await resolveRelease(ASSET, undefined, d);
    expect(release).toMatchObject({ tag: "v2.1.7", via: "api" });
    expect(calls).toHaveLength(2);
  });

  test("a relative Location resolves to github.com download URLs", async () => {
    const { d, calls } = deps(
      () =>
        new Response(null, {
          status: 302,
          headers: { Location: "/jukrb0x/Bolt/releases/tag/v2.1.4" },
        }),
    );
    const release = await resolveRelease(ASSET, undefined, d);
    expect(calls).toHaveLength(1);
    expect(release).toEqual({
      tag: "v2.1.4",
      via: "web",
      sumsUrl: "https://github.com/jukrb0x/Bolt/releases/download/v2.1.4/SHA256SUMS",
      assetUrl: `https://github.com/jukrb0x/Bolt/releases/download/v2.1.4/${ASSET}`,
    });
  });

  test("findOnPath skips '.', relative, and current-directory entries", () => {
    const root = mkdtempSync(path.join(tmpdir(), "bolt-gh-"));
    try {
      const cwd = path.join(root, "work");
      const good = path.join(root, "tools");
      mkdirSync(cwd);
      mkdirSync(good);
      writeFileSync(path.join(cwd, "gh.exe"), "evil");
      writeFileSync(path.join(cwd, "gh"), "evil");
      writeFileSync(path.join(good, "gh.exe"), "good");
      writeFileSync(path.join(good, "gh"), "good");
      const env = { PATH: [".", "work", cwd, good].join(";"), PATHEXT: ".COM;.EXE;.BAT" };
      expect(findOnPath("gh", env, "win32", cwd)).toBe(path.join(good, "gh.exe"));
      if (process.platform !== "win32") {
        // A ':'-separated PATH cannot hold Windows drive paths.
        const posix = { PATH: [".", "", cwd, good].join(":") };
        expect(findOnPath("gh", posix, "linux", cwd)).toBe(path.join(good, "gh"));
      }
      expect(findOnPath("gh", { PATH: `.;${cwd}` }, "win32", cwd)).toBeUndefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("download failures use rate-limit wording only when GitHub says so", () => {
    expect(downloadFailureMessage(403, "v2.1.4", true)).toBe(RATE_LIMIT_MESSAGE);
    expect(downloadFailureMessage(403, "v2.1.4", false)).toBe("");
    expect(downloadFailureMessage(429, undefined)).toBe(RATE_LIMIT_MESSAGE);
  });

  test("isNewer follows semver precedence for prereleases", () => {
    expect(isNewer("2.2.0-rc.1", "2.2.0")).toBe(true);
    expect(isNewer("2.2.0", "2.2.0-rc.1")).toBe(false);
    expect(isNewer("2.2.0-rc.1", "2.2.0-rc.2")).toBe(true);
    expect(isNewer("2.2.0-rc.2", "2.2.0-rc.10")).toBe(true);
    expect(isNewer("2.2.0-alpha", "2.2.0-beta")).toBe(true);
    expect(isNewer("2.2.0-1", "2.2.0-alpha")).toBe(true);
    expect(isNewer("2.1.9", "v2.2.0-rc.1")).toBe(true);
    expect(isNewer("2.2.0", "2.2.0")).toBe(false);
    expect(isNewer("2.2.0+build.1", "2.2.0")).toBe(false);
    expect(compareVersions("v2.10.0", "2.9.9")).toBeGreaterThan(0);
  });

  test("positional and --version must agree", () => {
    expect(requestedVersion("v2.1.0", undefined)).toEqual({ version: "v2.1.0" });
    expect(requestedVersion(undefined, "2.1.0")).toEqual({ version: "2.1.0" });
    expect(requestedVersion("v2.1.0", "2.1.0")).toEqual({ version: "v2.1.0" });
    expect(requestedVersion("v2.1.0", "2.0.0").error).toContain("Two different versions");
    expect(sameVersion("v2.1.0", "2.1.0")).toBe(true);
  });
}
