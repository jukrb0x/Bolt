import { copyFileSync, mkdirSync, renameSync, rmSync } from "fs";
import path from "path";
import { defineHandler, definePlugin } from "../plugin";
import { projectFilePath } from "./path-guard";

const plugin = definePlugin({
  namespace: "fs",
  version: "1.0.0",
  description: "Built-in file handlers.",
  handlers: {
    copy: defineHandler(
      { ai: "confirm", description: "Copy a file inside the project" },
      async (p, ctx) => {
        const src = projectFilePath(p.src, ctx, "fs/copy");
        const dst = projectFilePath(p.dst, ctx, "fs/copy");
        if (ctx.dryRun) {
          ctx.logger.info(`[dry-run] fs/copy ${src} -> ${dst}`);
          return;
        }
        mkdirSync(path.dirname(dst), { recursive: true });
        copyFileSync(src, dst);
      },
    ),
    move: defineHandler(
      { ai: "confirm", description: "Move a file inside the project" },
      async (p, ctx) => {
        const src = projectFilePath(p.src, ctx, "fs/move");
        const dst = projectFilePath(p.dst, ctx, "fs/move");
        if (ctx.dryRun) {
          ctx.logger.info(`[dry-run] fs/move ${src} -> ${dst}`);
          return;
        }
        mkdirSync(path.dirname(dst), { recursive: true });
        renameSync(src, dst);
      },
    ),
    delete: defineHandler(
      { ai: false, description: "Delete a file or directory inside the project" },
      async (p, ctx) => {
        const resolved = projectFilePath(p.path, ctx, "fs/delete");
        if (ctx.dryRun) {
          ctx.logger.info(`[dry-run] fs/delete ${resolved}`);
          return;
        }
        rmSync(resolved, { recursive: true, force: true });
      },
    ),
    mkdir: defineHandler(
      { ai: "confirm", description: "Create a directory inside the project" },
      async (p, ctx) => {
        const resolved = projectFilePath(p.path, ctx, "fs/mkdir");
        if (ctx.dryRun) {
          ctx.logger.info(`[dry-run] fs/mkdir ${resolved}`);
          return;
        }
        mkdirSync(resolved, { recursive: true });
      },
    ),
  },
});

export default plugin;
