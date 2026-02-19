import type { BoltPlugin } from "../plugin";
import { copyFileSync, rmSync, mkdirSync, renameSync } from "fs";
import path from "path";

const plugin: BoltPlugin = {
  namespace: "fs",
  handlers: {
    copy: async (p) => {
      mkdirSync(path.dirname(p.dst), { recursive: true });
      copyFileSync(p.src, p.dst);
    },
    move: async (p) => {
      mkdirSync(path.dirname(p.dst), { recursive: true });
      renameSync(p.src, p.dst);
    },
    delete: async (p) => {
      rmSync(p.path, { recursive: true, force: true });
    },
    mkdir: async (p) => {
      mkdirSync(p.path, { recursive: true });
    },
  },
};

export default plugin;
