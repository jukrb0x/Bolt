import { readFileSync, writeFileSync } from "fs";
import { defineHandler, definePlugin } from "../plugin";
import { projectFilePath } from "./path-guard";

const FORBIDDEN_SEGMENTS = new Set(["__proto__", "constructor", "prototype"]);

function rejectForbiddenMergeKeys(value: unknown): void {
  if (value === null || typeof value !== "object") return;
  for (const key of Object.keys(value as Record<string, unknown>)) {
    if (FORBIDDEN_SEGMENTS.has(key)) {
      throw new Error(`Forbidden key segment "${key}" in json/merge key path`);
    }
    rejectForbiddenMergeKeys((value as Record<string, unknown>)[key]);
  }
}

const plugin = definePlugin({
  namespace: "json",
  version: "1.0.0",
  description: "Built-in JSON file handlers.",
  handlers: {
    set: defineHandler(
      { ai: "confirm", description: "Set a value in a JSON file" },
      async (p, ctx) => {
        const file = projectFilePath(p.file, ctx, "json/set");
        const keys = p.key.split(".");
        for (const seg of keys) {
          if (FORBIDDEN_SEGMENTS.has(seg)) {
            throw new Error(`Forbidden key segment "${seg}" in json/set key path`);
          }
        }
        if (ctx.dryRun) {
          ctx.logger.info(`[dry-run] json/set ${file} ${p.key}=${p.value}`);
          return;
        }
        const data = JSON.parse(readFileSync(file, "utf8"));
        let obj: any = data;
        for (let i = 0; i < keys.length - 1; i++) obj = obj[keys[i]];
        obj[keys[keys.length - 1]] = p.value;
        writeFileSync(file, JSON.stringify(data, null, 2));
      },
    ),
    merge: defineHandler(
      { ai: "confirm", description: "Shallow-merge a JSON patch file" },
      async (p, ctx) => {
        const file = projectFilePath(p.file, ctx, "json/merge");
        const patch = projectFilePath(p.patch, ctx, "json/merge");
        if (ctx.dryRun) {
          ctx.logger.info(`[dry-run] json/merge ${patch} -> ${file}`);
          return;
        }
        const base = JSON.parse(readFileSync(file, "utf8"));
        const patchData = JSON.parse(readFileSync(patch, "utf8"));
        rejectForbiddenMergeKeys(patchData);
        writeFileSync(file, JSON.stringify({ ...base, ...patchData }, null, 2));
      },
    ),
  },
});

export default plugin;
