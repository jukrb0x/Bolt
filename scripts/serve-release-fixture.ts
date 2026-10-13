/**
 * Serve two local bolt builds in the shape install.ps1 and self-update expect.
 * current/ is the install. Newer is v2.0.1, what /releases/latest (github.com redirect)
 * and the API's .../releases/latest return.
 *
 *   bun scripts/serve-release-fixture.ts <root> <port> <public-base>
 */
import { existsSync } from "fs";
import { join } from "path";

const root = process.argv[2];
const port = Number(process.argv[3]);
const base = (process.argv[4] ?? "").replace(/\/+$/, "");

if (!root || !Number.isInteger(port) || port <= 0 || !base) {
  console.error("usage: scripts/serve-release-fixture.ts <root> <port> <public-base>");
  process.exit(1);
}

const files = new Set([
  "current/SHA256SUMS",
  "current/bolt-win-x64.exe",
  "newer/SHA256SUMS",
  "newer/bolt-win-x64.exe",
]);

Bun.serve({
  hostname: "127.0.0.1",
  port,
  fetch(req) {
    const pathname = new URL(req.url).pathname;
    if (pathname === "/health") return new Response("ok");
    // github.com shape: /releases/latest redirects to the tag page, assets live under /releases/download/<tag>/.
    if (pathname === "/releases/latest") {
      return new Response(null, {
        status: 302,
        headers: { Location: `${base}/releases/tag/v2.0.1` },
      });
    }
    const download = /^\/releases\/download\/v2\.0\.1\/([^/]+)$/.exec(pathname);
    if (download) {
      const abs = join(root, "newer", download[1]);
      if (!files.has(`newer/${download[1]}`) || !existsSync(abs)) {
        return new Response("not found", { status: 404 });
      }
      return new Response(Bun.file(abs));
    }
    if (pathname === "/repos/jukrb0x/Bolt/releases/latest") {
      return Response.json({
        tag_name: "v2.0.1",
        assets: [
          { name: "SHA256SUMS", browser_download_url: `${base}/newer/SHA256SUMS` },
          {
            name: "bolt-win-x64.exe",
            browser_download_url: `${base}/newer/bolt-win-x64.exe`,
          },
        ],
      });
    }
    const rel = pathname.replace(/^\//, "");
    if (!files.has(rel)) {
      console.error(`404 ${pathname}`);
      return new Response("not found", { status: 404 });
    }
    const abs = join(root, rel);
    if (!existsSync(abs)) {
      console.error(`missing ${abs}`);
      return new Response("missing", { status: 404 });
    }
    return new Response(Bun.file(abs));
  },
});

console.log(`local release at ${base}`);
