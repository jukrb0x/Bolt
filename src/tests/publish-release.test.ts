import { expect, test } from "bun:test";
import { readFileSync } from "fs";
import path from "path";
import {
  commitFromLsRemote,
  ghVersionError,
  parseApiRelease,
  parseApiReleaseList,
  parseAssetNames,
  planPublish,
  runPublish,
  splitHttpMessage,
  type ExecResult,
  type ReleaseView,
} from "../../scripts/publish-release";

const COMMIT = "a6d380220ddba675274c071c8ac14c8a50e189b2";
const OTHER = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const ASSETS = [
  "bolt-win-x64.exe",
  "bolt-linux-x64",
  "bolt-mac-arm64",
  "bolt-mac-x64",
  "bolt.d.ts",
  "SHA256SUMS",
];
const SUMS = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

const REPO = "jukrb0x/Bolt";

function release(overrides: Partial<ReleaseView> = {}): ReleaseView {
  return {
    id: 42,
    tagName: "v2.1.3",
    targetCommitish: COMMIT,
    isDraft: false,
    isPrerelease: false,
    uploadUrl: "https://uploads.github.com/repos/jukrb0x/Bolt/releases/42/assets{?name,label}",
    assets: ASSETS.map((name, index) => ({
      id: index + 1,
      name,
      state: "uploaded",
      size: name === "SHA256SUMS" ? 40 : 10,
      digest: name === "SHA256SUMS" ? `sha256:${SUMS}` : undefined,
    })),
    ...overrides,
  };
}

const expected = {
  tag: "v2.1.3",
  commit: COMMIT,
  tagCommit: COMMIT,
  assetNames: ASSETS,
  repo: REPO,
  assetDir: "build",
  localSums: { sha256: SUMS, size: 40 },
};

test("a missing release is created", () => {
  expect(planPublish(null, expected)).toEqual({ action: "create" });
});

test("a release pinned to the same commit and assets is already published", () => {
  expect(planPublish(release(), expected)).toEqual({
    action: "already-published",
    warnings: [],
  });
  expect(
    planPublish(release({ targetCommitish: COMMIT.toUpperCase() }), {
      ...expected,
      assetNames: [...ASSETS].reverse(),
    }),
  ).toEqual({ action: "already-published", warnings: [] });
});

test("checksum drift on the same commit warns and still succeeds", () => {
  const plan = planPublish(
    release({
      assets: ASSETS.map((name) => ({
        name,
        state: "uploaded",
        size: name === "SHA256SUMS" ? 41 : 10,
        digest: name === "SHA256SUMS" ? `sha256:${"ab".repeat(32)}` : undefined,
      })),
    }),
    expected,
  );
  expect(plan.action).toBe("already-published");
  if (plan.action === "already-published") {
    expect(plan.warnings.join("\n")).toContain("first build");
    expect(plan.warnings.join("\n")).toContain("not uploaded");
  }
});

test("a hyphenated tag must already be a pre-release", () => {
  const pre = { ...expected, tag: "v2.2.0-rc.1" };
  expect(planPublish(release({ tagName: pre.tag, isPrerelease: true }), pre)).toEqual({
    action: "already-published",
    warnings: [],
  });
  const mismatch = planPublish(release({ tagName: pre.tag, isPrerelease: false }), pre);
  expect(mismatch.action).toBe("fail");
  if (mismatch.action === "fail") expect(mismatch.message).toContain("pre-release");
});

test("a different commit fails and does not treat the release as published", () => {
  const pinned = planPublish(release({ targetCommitish: OTHER }), expected);
  expect(pinned.action).toBe("fail");
  if (pinned.action === "fail") {
    expect(pinned.message).toContain(OTHER);
    expect(pinned.message).toContain(COMMIT);
    expect(pinned.message).toContain("not modified");
    expect(pinned.message).toContain("gh api -X DELETE repos/jukrb0x/Bolt/releases/42");
    expect(pinned.message).toContain("tag is kept");
  }

  const moved = planPublish(null, { ...expected, tagCommit: OTHER });
  expect(moved.action).toBe("fail");
  if (moved.action === "fail") {
    expect(moved.message).toContain(OTHER);
    expect(moved.message).toContain(COMMIT);
    expect(moved.message).toContain("moved after this run started");
  }
});

test("targetCommitish=main fails closed even when the tag now points at this commit", () => {
  const plan = planPublish(release({ targetCommitish: "main" }), expected);
  expect(plan.action).toBe("fail");
  if (plan.action === "fail") {
    expect(plan.message).toContain("target_commitish=main");
    expect(plan.message).toContain("old publisher");
    expect(plan.message).toContain("gh api -X DELETE repos/jukrb0x/Bolt/releases/42");
    expect(plan.message).toContain("tag is kept");
    expect(plan.message).toContain("not modified");
  }
});

test("a published release with a missing or unfinished asset fails with recovery commands", () => {
  const missing = planPublish(
    release({ assets: ASSETS.slice(1).map((name) => ({ name, state: "uploaded" })) }),
    expected,
  );
  expect(missing.action).toBe("fail");
  if (missing.action === "fail") {
    expect(missing.message).toContain(
      "https://uploads.github.com/repos/jukrb0x/Bolt/releases/42/assets?name=bolt-win-x64.exe",
    );
    expect(missing.message).toContain("--input build/bolt-win-x64.exe");
    expect(missing.message).toContain("not modified");
  }

  const starter = planPublish(
    release({
      assets: ASSETS.map((name) => ({
        id: name === "SHA256SUMS" ? 900 : 1,
        name,
        state: name === "SHA256SUMS" ? "starter" : "uploaded",
      })),
    }),
    { ...expected, runId: "99" },
  );
  expect(starter.action).toBe("fail");
  if (starter.action === "fail") {
    expect(starter.message).toContain("gh api -X DELETE repos/jukrb0x/Bolt/releases/assets/900");
    expect(starter.message).toContain(
      "https://uploads.github.com/repos/jukrb0x/Bolt/releases/42/assets?name=SHA256SUMS",
    );
    expect(starter.message).toContain("gh run rerun 99");
  }
});

test("a draft for this commit is completed instead of published over", () => {
  const missing = planPublish(
    release({
      isDraft: true,
      assets: ASSETS.slice(1).map((name) => ({ name, state: "uploaded" })),
    }),
    expected,
  );
  expect(missing).toEqual({
    action: "repair",
    upload: ["bolt-win-x64.exe"],
    deleteAssets: [],
    undraft: true,
  });

  const starter = planPublish(
    release({
      isDraft: true,
      assets: ASSETS.map((name) => ({
        name,
        state: name === "SHA256SUMS" ? "starter" : "uploaded",
        digest: name === "SHA256SUMS" ? `sha256:${SUMS}` : undefined,
        size: 40,
      })),
    }),
    expected,
  );
  expect(starter).toEqual({
    action: "repair",
    upload: ["SHA256SUMS"],
    deleteAssets: ["SHA256SUMS"],
    undraft: true,
  });

  expect(planPublish(release({ isDraft: true }), expected)).toEqual({
    action: "repair",
    upload: [],
    deleteAssets: [],
    undraft: true,
  });
});

test("a draft that targets a different commit is not repaired", () => {
  const plan = planPublish(release({ isDraft: true, targetCommitish: "main" }), expected);
  expect(plan.action).toBe("fail");
});

test("asset names come from assets.txt with blank lines skipped", () => {
  expect(parseAssetNames("bolt-linux-x64\n\nSHA256SUMS\n")).toEqual([
    "bolt-linux-x64",
    "SHA256SUMS",
  ]);
  const plan = planPublish(null, { ...expected, assetNames: [] });
  expect(plan.action).toBe("fail");
});

test("ls-remote uses the peeled commit for annotated tags", () => {
  const annotated = `${"8aa9f84c12786416f0736e752b8a85ca469bc863"}\trefs/tags/v2.1.3\n${COMMIT}\trefs/tags/v2.1.3^{}\n`;
  expect(commitFromLsRemote(annotated, "v2.1.3")).toBe(COMMIT);
  expect(commitFromLsRemote(`${COMMIT}\trefs/tags/v2.1.3\n`, "v2.1.3")).toBe(COMMIT);
  expect(commitFromLsRemote("", "v2.1.3")).toBeNull();
});

test("gh api status comes from the HTTP line, not the prose", () => {
  expect(splitHttpMessage('HTTP/2.0 404 Not Found\n\n{"message":"Introuvable"}')).toEqual({
    status: 404,
    body: '{"message":"Introuvable"}',
  });
  expect(splitHttpMessage("gh: release not found\n")).toBeNull();
  const view = parseApiRelease(
    JSON.stringify({
      id: 42,
      tag_name: "v2.1.3",
      target_commitish: "main",
      draft: false,
      prerelease: false,
      upload_url: "https://uploads.github.com/repos/jukrb0x/Bolt/releases/42/assets{?name,label}",
      assets: [
        { id: 7, name: "SHA256SUMS", state: "uploaded", size: 40, digest: `sha256:${SUMS}` },
      ],
    }),
  );
  expect(view).toEqual({
    id: 42,
    tagName: "v2.1.3",
    targetCommitish: "main",
    isDraft: false,
    isPrerelease: false,
    uploadUrl: "https://uploads.github.com/repos/jukrb0x/Bolt/releases/42/assets{?name,label}",
    assets: [{ id: 7, name: "SHA256SUMS", state: "uploaded", size: 40, digest: `sha256:${SUMS}` }],
  });
});

test("the release workflow serializes one tag and publishes through the script", () => {
  const yaml = readFileSync(
    path.join(import.meta.dir, "../../.github/workflows/release.yml"),
    "utf8",
  );
  expect(yaml).toContain("group: release-${{ github.ref }}");
  expect(yaml).toContain("cancel-in-progress: false");
  expect(yaml).toContain("bun run scripts/publish-release.ts");
  expect(yaml).not.toContain("gh release create");
  expect(yaml).toContain("another workflow");
});

/** `gh api` prints a status line only when `-i` is passed. Otherwise stdout is the body. */
function http(args: string[], status: number, body: unknown): ExecResult {
  const json = JSON.stringify(body);
  const includeHeaders = args.includes("-i");
  return {
    exitCode: status >= 200 && status < 300 ? 0 : 1,
    stdout: includeHeaders ? `HTTP/2.0 ${status} X\r\n\r\n${json}` : json,
    stderr: status >= 200 && status < 300 ? "" : `gh: HTTP ${status}\n`,
  };
}

/**
 * Without `--slurp`, `gh api --paginate` writes each page back to back.
 * Two pages are `[...][...]`, which is not JSON. `--slurp` wraps the pages.
 */
function releasePages(args: string[], pages: unknown[][]): ExecResult {
  const slurp = args.includes("--paginate") && args.includes("--slurp");
  return {
    exitCode: 0,
    stdout: slurp ? JSON.stringify(pages) : pages.map((page) => JSON.stringify(page)).join(""),
    stderr: "",
  };
}

function apiBody(releaseBody: ReleaseView) {
  return {
    id: releaseBody.id,
    tag_name: releaseBody.tagName,
    target_commitish: releaseBody.targetCommitish,
    draft: releaseBody.isDraft,
    prerelease: releaseBody.isPrerelease,
    upload_url: releaseBody.uploadUrl,
    assets: releaseBody.assets,
  };
}

const publishArgv = [
  "--tag",
  "v2.1.3",
  "--commit",
  COMMIT,
  "--asset-dir",
  "build",
  "--assets-file",
  "build/assets.txt",
  "--notes-file",
  "notes.md",
];

function isCreatePost(args: string[]): boolean {
  return args.includes("-X") && args.includes("POST") && args.includes(`repos/${REPO}/releases`);
}

test("create failure is retried from the release that exists, without English 422 text", () => {
  const calls: string[][] = [];
  let tagGets = 0;
  const code = runPublish({
    argv: publishArgv,
    env: { GITHUB_REPOSITORY: REPO },
    exists: () => true,
    readFile: (file) => (file.endsWith("assets.txt") ? `${ASSETS.join("\n")}\n` : "sums\n"),
    exec: (_command, args) => {
      calls.push(args);
      if (args[0] === "ls-remote")
        return { exitCode: 0, stdout: `${COMMIT}\trefs/tags/v2.1.3^{}\n`, stderr: "" };
      if (args.includes("--paginate")) return releasePages(args, [[]]);
      if (args.some((arg) => arg.includes("/releases/tags/"))) {
        tagGets++;
        if (tagGets === 1) return http(args, 404, { message: "Introuvable" });
        return http(args, 200, apiBody(release()));
      }
      if (isCreatePost(args)) return http(args, 422, { message: "Validation Failed" });
      return { exitCode: 0, stdout: "", stderr: "" };
    },
  });
  expect(code).toBe(0);
  expect(tagGets).toBe(2);
  expect(calls.filter(isCreatePost)).toHaveLength(1);
  expect(calls.some((args) => args.includes("draft=false"))).toBe(false);
});

test("a re-run with an incomplete draft completes that draft and does not create another", () => {
  const calls: string[][] = [];
  const sums = "sums\n";
  const draft = release({
    id: 42,
    isDraft: true,
    assets: ASSETS.map((name) => ({
      id: name === "SHA256SUMS" ? 900 : 1,
      name,
      state: name === "SHA256SUMS" ? "starter" : "uploaded",
      size: 1,
    })),
  });
  const code = runPublish({
    argv: publishArgv,
    env: { GITHUB_REPOSITORY: REPO },
    exists: () => true,
    readFile: (file) => (file.endsWith("assets.txt") ? `${ASSETS.join("\n")}\n` : sums),
    exec: (_command, args) => {
      calls.push(args);
      if (args[0] === "ls-remote")
        return { exitCode: 0, stdout: `${COMMIT}\trefs/tags/v2.1.3^{}\n`, stderr: "" };
      if (args.some((arg) => arg.includes("/releases/tags/")))
        return http(args, 404, { message: "Not Found" });
      if (args.includes("--paginate")) {
        return releasePages(args, [
          [apiBody(draft), apiBody(release({ id: 99, tagName: "v9.9.9" }))],
        ]);
      }
      return { exitCode: 0, stdout: "", stderr: "" };
    },
  });
  expect(code).toBe(0);
  expect(calls.filter(isCreatePost)).toHaveLength(0);
  expect(calls.some((args) => args.includes(`repos/${REPO}/releases/assets/900`))).toBe(true);
  expect(
    calls.some((args) =>
      args.some(
        (arg) =>
          arg.includes("releases/42/assets?name=SHA256SUMS") && arg.includes("uploads.github.com"),
      ),
    ),
  ).toBe(true);
  expect(
    calls.some(
      (args) => args.includes(`repos/${REPO}/releases/42`) && args.includes("draft=false"),
    ),
  ).toBe(true);
});

test("two drafts for the same tag fail closed", () => {
  const calls: string[][] = [];
  const errors: string[] = [];
  const one = (id: number) =>
    apiBody(
      release({
        id,
        isDraft: true,
        assets: [{ id: id * 10, name: "SHA256SUMS", state: "starter" }],
      }),
    );
  const code = runPublish({
    argv: publishArgv,
    env: { GITHUB_REPOSITORY: REPO },
    exists: () => true,
    readFile: (file) => (file.endsWith("assets.txt") ? `${ASSETS.join("\n")}\n` : "sums\n"),
    error: (line) => errors.push(line),
    exec: (_command, args) => {
      calls.push(args);
      if (args[0] === "ls-remote")
        return { exitCode: 0, stdout: `${COMMIT}\trefs/tags/v2.1.3^{}\n`, stderr: "" };
      if (args.some((arg) => arg.includes("/releases/tags/")))
        return http(args, 404, { message: "Not Found" });
      if (args.includes("--paginate")) {
        return releasePages(args, [
          [one(11), one(22), apiBody(release({ id: 33, tagName: "v0.0.1" }))],
        ]);
      }
      return { exitCode: 0, stdout: "", stderr: "" };
    },
  });
  const text = errors.join("\n");
  expect(code).toBe(1);
  expect(text).toContain("id 11");
  expect(text).toContain("id 22");
  expect(text).not.toContain("id 33");
  expect(text).toContain("gh api -X DELETE repos/jukrb0x/Bolt/releases/11");
  expect(text).toContain("gh api -X DELETE repos/jukrb0x/Bolt/releases/22");
  expect(text).toContain("not modified");
  expect(calls.filter(isCreatePost)).toHaveLength(0);
  expect(calls.some((args) => args.includes("draft=false"))).toBe(false);
});

test("a query that is not HTTP 404 fails with the response, and missing args name the usage", () => {
  const errors: string[] = [];
  const query = runPublish({
    argv: [
      "--tag",
      "v2.1.3",
      "--commit",
      COMMIT,
      "--asset-dir",
      "build",
      "--assets-file",
      "build/assets.txt",
      "--notes-file",
      "notes.md",
    ],
    env: { GITHUB_REPOSITORY: "jukrb0x/Bolt" },
    exists: () => true,
    readFile: () => `${ASSETS.join("\n")}\n`,
    error: (line) => errors.push(line),
    exec: (_command, args) => {
      if (args[0] === "ls-remote")
        return { exitCode: 0, stdout: `${COMMIT}\trefs/tags/v2.1.3^{}\n`, stderr: "" };
      const headed = args.includes("-i");
      return {
        exitCode: 1,
        stdout: headed ? "HTTP/2.0 500 X\r\n\r\n{}" : "{}",
        stderr: "backend exploded\n",
      };
    },
  });
  expect(query).toBe(1);
  expect(errors.join("\n")).toContain("unable to query");
  expect(errors.join("\n")).toContain("backend exploded");
  expect(errors.join("\n")).toContain("::error::");

  const usage: string[] = [];
  const bad = runPublish({
    argv: ["--tag"],
    exists: () => false,
    readFile: () => "",
    exec: () => ({ exitCode: 1, stdout: "", stderr: "" }),
    error: (line) => usage.push(line),
  });
  expect(bad).toBe(1);
  expect(usage.join("\n")).toContain("Refusing to publish");
  expect(usage.join("\n")).toContain("Usage:");

  const missing: string[] = [];
  const noFile = runPublish({
    argv: [
      "--tag",
      "v2.1.3",
      "--commit",
      COMMIT,
      "--asset-dir",
      "build",
      "--assets-file",
      "build/assets.txt",
      "--notes-file",
      "notes.md",
    ],
    env: { GITHUB_REPOSITORY: "jukrb0x/Bolt" },
    exists: () => false,
    readFile: () => {
      throw new Error("ENOENT");
    },
    exec: () => ({ exitCode: 1, stdout: "", stderr: "" }),
    error: (line) => missing.push(line),
  });
  expect(noFile).toBe(1);
  expect(missing.join("\n")).toContain("Refusing to publish");
  expect(missing.join("\n")).toContain("build/assets.txt");
  expect(missing.join("\n")).not.toContain("ENOENT");
});

test("a 403 while reading the release mentions contents: write", () => {
  const errors: string[] = [];
  const calls: string[][] = [];
  const code = runPublish({
    argv: publishArgv,
    env: { GITHUB_REPOSITORY: REPO },
    exists: () => true,
    readFile: () => `${ASSETS.join("\n")}\n`,
    error: (line) => errors.push(line),
    exec: (_command, args) => {
      calls.push(args);
      if (args[0] === "ls-remote")
        return { exitCode: 0, stdout: `${COMMIT}\trefs/tags/v2.1.3^{}\n`, stderr: "" };
      return http(args, 403, { message: "Forbidden" });
    },
  });
  expect(code).toBe(1);
  expect(errors.join("\n")).toContain("contents: write");
  expect(calls.some((args) => args.includes("--paginate"))).toBe(false);
  expect(calls.filter(isCreatePost)).toHaveLength(0);
});

test("checksum drift is emitted as a workflow warning", () => {
  const logs: string[] = [];
  const drifted = release({
    assets: ASSETS.map((name, index) => ({
      id: index + 1,
      name,
      state: "uploaded",
      size: 40,
      digest: `sha256:${"ab".repeat(32)}`,
    })),
  });
  const code = runPublish({
    argv: publishArgv,
    env: { GITHUB_REPOSITORY: REPO },
    exists: () => true,
    readFile: (file) => (file.endsWith("assets.txt") ? `${ASSETS.join("\n")}\n` : "sums\n"),
    log: (line) => logs.push(line),
    exec: (_command, args) => {
      if (args[0] === "ls-remote")
        return { exitCode: 0, stdout: `${COMMIT}\trefs/tags/v2.1.3^{}\n`, stderr: "" };
      if (args.some((arg) => arg.includes("/releases/tags/")))
        return http(args, 200, apiBody(drifted));
      return { exitCode: 0, stdout: "", stderr: "" };
    },
  });
  expect(code).toBe(0);
  expect(logs.some((line) => line.startsWith("::warning::") && line.includes("first build"))).toBe(
    true,
  );
});

test("parseApiReleaseList flattens slurped pages and rejects concatenated pages", () => {
  const page = (id: number, tag: string) => ({
    id,
    tag_name: tag,
    target_commitish: COMMIT,
    draft: true,
    prerelease: false,
    assets: [],
  });
  const list = parseApiReleaseList(JSON.stringify([[page(1, "v1.0.0")], [page(2, "v2.1.3")]]));
  expect(list.map((item) => item.id)).toEqual([1, 2]);
  expect(() =>
    parseApiReleaseList(`${JSON.stringify([page(1, "v1")])}${JSON.stringify([page(2, "v2")])}`),
  ).toThrow();
});

test("a successful create posts once and uploads to the id in the response", () => {
  const calls: string[][] = [];
  let tagGets = 0;
  let lists = 0;
  const created = release({
    id: 77,
    isDraft: true,
    uploadUrl: "https://uploads.github.com/repos/jukrb0x/Bolt/releases/77/assets{?name,label}",
    assets: [],
  });
  const code = runPublish({
    argv: publishArgv,
    env: { GITHUB_REPOSITORY: REPO },
    exists: () => true,
    readFile: (file) => (file.endsWith("assets.txt") ? `${ASSETS.join("\n")}\n` : "notes\n"),
    exec: (_command, args) => {
      calls.push(args);
      if (args[0] === "ls-remote")
        return { exitCode: 0, stdout: `${COMMIT}\trefs/tags/v2.1.3^{}\n`, stderr: "" };
      if (args.some((arg) => arg.includes("/releases/tags/"))) {
        tagGets++;
        return http(args, 404, { message: "Not Found" });
      }
      if (args.includes("--paginate")) {
        lists++;
        return releasePages(args, [[]]);
      }
      if (isCreatePost(args)) return http(args, 201, apiBody(created));
      return { exitCode: 0, stdout: "", stderr: "" };
    },
  });
  const post = calls.find(isCreatePost);
  expect(code).toBe(0);
  expect(calls.filter(isCreatePost)).toHaveLength(1);
  expect(post).toContain("-i");
  expect(post?.[post.indexOf("body=@notes.md") - 1]).toBe("-F");
  expect(tagGets).toBe(1);
  expect(lists).toBe(1);
  for (const name of ASSETS) {
    expect(
      calls.some((args) =>
        args.some((arg) => arg.includes(`releases/77/assets?name=${encodeURIComponent(name)}`)),
      ),
    ).toBe(true);
  }
  expect(
    calls.some(
      (args) => args.includes(`repos/${REPO}/releases/77`) && args.includes("draft=false"),
    ),
  ).toBe(true);
});

test("a draft on the second page is completed from the slurped list", () => {
  const calls: string[][] = [];
  const draft = release({
    id: 42,
    isDraft: true,
    assets: ASSETS.map((name) => ({
      id: name === "SHA256SUMS" ? 900 : 1,
      name,
      state: name === "SHA256SUMS" ? "starter" : "uploaded",
      size: 1,
    })),
  });
  const page1 = Array.from({ length: 30 }, (_, index) =>
    apiBody(release({ id: 1000 + index, tagName: `v0.0.${index}` })),
  );
  const code = runPublish({
    argv: publishArgv,
    env: { GITHUB_REPOSITORY: REPO },
    exists: () => true,
    readFile: (file) => (file.endsWith("assets.txt") ? `${ASSETS.join("\n")}\n` : "sums\n"),
    exec: (_command, args) => {
      calls.push(args);
      if (args[0] === "ls-remote")
        return { exitCode: 0, stdout: `${COMMIT}\trefs/tags/v2.1.3^{}\n`, stderr: "" };
      if (args.some((arg) => arg.includes("/releases/tags/")))
        return http(args, 404, { message: "Not Found" });
      if (args.includes("--paginate")) return releasePages(args, [page1, [apiBody(draft)]]);
      return { exitCode: 0, stdout: "", stderr: "" };
    },
  });
  const list = calls.find((args) => args.includes("--paginate"));
  expect(code).toBe(0);
  expect(list).toContain("--slurp");
  expect(calls.filter(isCreatePost)).toHaveLength(0);
  expect(calls.some((args) => args.includes(`repos/${REPO}/releases/assets/900`))).toBe(true);
  expect(
    calls.some(
      (args) => args.includes(`repos/${REPO}/releases/42`) && args.includes("draft=false"),
    ),
  ).toBe(true);
});

const ghOut = (stdout: string): ExecResult => ({ exitCode: 0, stdout, stderr: "" });

test("gh older than 2.48 fails early with the version found and how to upgrade", () => {
  const old = ghVersionError(
    ghOut("gh version 2.47.1 (2024-04-01)\nhttps://github.com/cli/cli/releases/tag/v2.47.1\n"),
  );
  expect(old).toContain("requires gh 2.48 or later");
  expect(old).toContain("found 2.47.1");
  expect(old).toContain("Install or upgrade it from https://cli.github.com/");
  expect(ghVersionError(ghOut("gh version 1.99.0 (2021-01-01)"))).toContain("found 1.99.0");
  expect(ghVersionError(ghOut("gh version 2.48.0 (2024-04-17)"))).toBeNull();
  expect(ghVersionError(ghOut("gh version 2.60.1 (2024-10-24)"))).toBeNull();
  expect(ghVersionError(ghOut("gh version 3.0.0 (2030-01-01)"))).toBeNull();
});

test("gh not on PATH names the requirement and where to install it", () => {
  expect(ghVersionError(null)).toBe(
    "scripts/publish-release.ts requires gh 2.48 or later, but gh was not found on PATH. Install or upgrade it from https://cli.github.com/",
  );
});

test("an unparseable gh version names what was printed and where to install gh", () => {
  for (const output of ["", "something else\n"]) {
    const message = ghVersionError(ghOut(output));
    expect(message).toContain("requires gh 2.48 or later");
    expect(message).toContain("printed an unrecognized version");
    expect(message).toContain("Install or upgrade it from https://cli.github.com/");
  }
});

test("gh --version exiting non-zero reports the exit code and gh's stderr", () => {
  const message = ghVersionError({
    exitCode: 3,
    stdout: "",
    stderr: "  error: config file is corrupt\n",
  });
  expect(message).toContain("gh --version failed (exit 3): error: config file is corrupt.");
  expect(message).toContain("Install or upgrade it from https://cli.github.com/");
  expect(message).not.toContain("unrecognized version");
});

// Emulates gh: `-F key=@file` reads the file, `-f` sends the literal string.
test("a successful create sends the notes file as the body and does not list releases again", () => {
  const calls: string[][] = [];
  const notes = "## Changes\n\n- Fix the thing\n";
  let sentBody: string | undefined;
  const code = runPublish({
    argv: publishArgv,
    env: { GITHUB_REPOSITORY: REPO },
    exists: () => true,
    readFile: (file) => (file.endsWith("assets.txt") ? `${ASSETS.join("\n")}\n` : "sums\n"),
    exec: (_command, args) => {
      calls.push(args);
      if (args[0] === "ls-remote")
        return { exitCode: 0, stdout: `${COMMIT}\trefs/tags/v2.1.3^{}\n`, stderr: "" };
      if (args.some((arg) => arg.includes("/releases/tags/")))
        return http(args, 404, { message: "Not Found" });
      if (args.includes("--paginate")) return releasePages(args, [[]]);
      if (isCreatePost(args)) {
        args.forEach((arg, i) => {
          if (!arg.startsWith("body=")) return;
          const value = arg.slice("body=".length);
          const typed = args[i - 1] === "-F" && value.startsWith("@");
          sentBody = typed && value === "@notes.md" ? notes : value;
        });
        const created = release({
          id: 77,
          isDraft: true,
          uploadUrl:
            "https://uploads.github.com/repos/jukrb0x/Bolt/releases/77/assets{?name,label}",
          assets: [],
        });
        return http(args, 201, apiBody(created));
      }
      return { exitCode: 0, stdout: "", stderr: "" };
    },
  });
  expect(code).toBe(0);
  expect(sentBody).toBe(notes);
  expect(sentBody).not.toBe("@notes.md");
  const postAt = calls.findIndex(isCreatePost);
  expect(postAt).toBeGreaterThan(-1);
  const after = calls.slice(postAt + 1);
  expect(after.some((args) => args.includes("--paginate"))).toBe(false);
  expect(
    after.some(
      (args) =>
        args.includes(`repos/${REPO}/releases`) && !isCreatePost(args) && args.includes("GET"),
    ),
  ).toBe(false);
  expect(after.some((args) => args.some((arg) => arg.includes("/releases/tags/")))).toBe(false);
});
