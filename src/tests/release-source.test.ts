import { expect, test } from "bun:test";
import {
  RATE_LIMIT_MESSAGE,
  RateLimitError,
  findToken,
  resolveRelease,
  tagFromLocation,
  type ResolveDeps,
} from "../release-source";
import { downloadFailureMessage } from "../commands/update";

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
        url.includes("api.github.com") ? new Response("limited", { status }) : new Response("x"),
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
  expect(downloadFailureMessage(403, "v2.1.4")).toBe(RATE_LIMIT_MESSAGE);
  expect(downloadFailureMessage(429, undefined)).toBe(RATE_LIMIT_MESSAGE);
  expect(downloadFailureMessage(404, "v9.9.9")).toContain("Release v9.9.9");
  expect(downloadFailureMessage(500, "v2.1.4")).toBe("");
});
