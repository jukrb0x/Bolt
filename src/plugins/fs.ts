import type { BoltPlugin } from "../plugin";
import { copyFileSync, rmSync, mkdirSync, renameSync } from "fs";
import path from "path";
import { safePath } from "./path-guard";

const plugin: BoltPlugin = {
  namespace: "fs",
  handlers: {
    copy: async (p, ctx) => {
      const root = ctx.configDir;
      const src = safePath(p.src, root);
      const dst = safePath(p.dst, root);
      if (ctx.dryRun) {
        ctx.logger.info(`[dry-run] fs/copy ${src} -> ${dst}`);
        return;
      }
      mkdirSync(path.dirname(dst), { recursive: true });
      copyFileSync(src, dst);
    },
    move: async (p, ctx) => {
      const root = ctx.configDir;
      const src = safePath(p.src, root);
      const dst = safePath(p.dst, root);
      if (ctx.dryRun) {
        ctx.logger.info(`[dry-run] fs/move ${src} -> ${dst}`);
        return;
      }
      mkdirSync(path.dirname(dst), { recursive: true });
      renameSync(src, dst);
    },
    delete: async (p, ctx) => {
      const resolved = safePath(p.path, ctx.configDir);
      if (ctx.dryRun) {
        ctx.logger.info(`[dry-run] fs/delete ${resolved}`);
        return;
      }
      rmSync(resolved, { recursive: true, force: true });
    },
    mkdir: async (p, ctx) => {
      const resolved = safePath(p.path, ctx.configDir);
      if (ctx.dryRun) {
        ctx.logger.info(`[dry-run] fs/mkdir ${resolved}`);
        return;
      }
      mkdirSync(resolved, { recursive: true });
    },
  },
};

export default plugin;
