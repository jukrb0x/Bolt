import type { BoltPlugin } from "../plugin";
import { readFileSync, writeFileSync } from "fs";
import { safePath } from "./path-guard";

const FORBIDDEN_SEGMENTS = new Set(["__proto__", "constructor", "prototype"]);

const plugin: BoltPlugin = {
  namespace: "json",
  handlers: {
    set: async (p, ctx) => {
      const file = safePath(p.file, ctx.configDir);
      const keys = p.key.split(".");
      for (const seg of keys) {
        if (FORBIDDEN_SEGMENTS.has(seg)) {
          throw new Error(`Forbidden key segment "${seg}" in json/set key path`);
        }
      }
      const data = JSON.parse(readFileSync(file, "utf8"));
      let obj: any = data;
      for (let i = 0; i < keys.length - 1; i++) obj = obj[keys[i]];
      obj[keys[keys.length - 1]] = p.value;
      writeFileSync(file, JSON.stringify(data, null, 2));
    },
    merge: async (p, ctx) => {
      const file = safePath(p.file, ctx.configDir);
      const patch = safePath(p.patch, ctx.configDir);
      const base = JSON.parse(readFileSync(file, "utf8"));
      const patchData = JSON.parse(readFileSync(patch, "utf8"));
      writeFileSync(file, JSON.stringify({ ...base, ...patchData }, null, 2));
    },
  },
};

export default plugin;
