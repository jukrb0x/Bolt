import { existsSync } from "fs";
import path from "path";

export async function findConfig(startDir: string): Promise<string | null> {
  let dir = path.resolve(startDir);
  while (true) {
    const candidate = path.join(dir, "bolt.yaml");
    if (existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}
