import type { BoltPlugin } from "../plugin";
import { copyFileSync, rmSync, mkdirSync, renameSync } from "fs";
import path from "path";
import { projectFilePath } from "./path-guard";

const plugin: BoltPlugin = {
  namespace: "fs",
  handlers: {
    copy: async (p, ctx) => {
      const src = projectFilePath(p.src, ctx, "fs/copy");
      const dst = projectFilePath(p.dst, ctx, "fs/copy");
      if (ctx.dryRun) {
        ctx.logger.info(`[dry-run] fs/copy ${src} -> ${dst}`);
        return;
      }
      mkdirSync(path.dirname(dst), { recursive: true });
      copyFileSync(src, dst);
    },
    move: async (p, ctx) => {
      const src = projectFilePath(p.src, ctx, "fs/move");
      const dst = projectFilePath(p.dst, ctx, "fs/move");
      if (ctx.dryRun) {
        ctx.logger.info(`[dry-run] fs/move ${src} -> ${dst}`);
        return;
      }
      mkdirSync(path.dirname(dst), { recursive: true });
      renameSync(src, dst);
    },
    delete: async (p, ctx) => {
      const resolved = projectFilePath(p.path, ctx, "fs/delete");
      if (ctx.dryRun) {
        ctx.logger.info(`[dry-run] fs/delete ${resolved}`);
        return;
      }
      rmSync(resolved, { recursive: true, force: true });
    },
    mkdir: async (p, ctx) => {
      const resolved = projectFilePath(p.path, ctx, "fs/mkdir");
      if (ctx.dryRun) {
        ctx.logger.info(`[dry-run] fs/mkdir ${resolved}`);
        return;
      }
      mkdirSync(resolved, { recursive: true });
    },
  },
};

export default plugin;
