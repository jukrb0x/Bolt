import { lstatSync, realpathSync } from "fs";
import path from "path";

/**
 * Real path of `p` with symlinks resolved. When `p` does not exist, the nearest
 * existing ancestor is resolved and the missing tail is re-joined, so a missing
 * file under a symlinked directory is judged by where it would really live.
 * Throws a clear error for a symlink loop, a dangling symlink, or any other
 * resolution failure (e.g. permission denied); callers decide whether that rejects.
 */
function realPathNearest(p: string): string {
  let current = p;
  const tail: string[] = [];
  for (;;) {
    try {
      return path.join(realpathSync.native(current), ...tail);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ELOOP") {
        throw new Error(`Path "${p}" cannot be resolved: symlink loop at "${current}"`);
      }
      if (code !== "ENOENT" && code !== "ENOTDIR") {
        throw new Error(`Path "${p}" cannot be resolved (${code ?? String(error)})`);
      }
      // A link that exists but points nowhere could still point outside: fail closed.
      let dangling = false;
      try {
        dangling = lstatSync(current).isSymbolicLink();
      } catch {
        // `current` really does not exist; keep walking up.
      }
      if (dangling) {
        throw new Error(`Path "${p}" cannot be resolved: dangling symlink at "${current}"`);
      }
      const parent = path.dirname(current);
      if (parent === current) return path.join(current, ...tail);
      tail.unshift(path.basename(current));
      current = parent;
    }
  }
}

function inside(child: string, root: string): boolean {
  return child === root || child.startsWith(root.endsWith(path.sep) ? root : root + path.sep);
}

/**
 * Resolve a raw path relative to the project root and verify it doesn't escape,
 * both literally and after resolving symlinks (an in-project link to an outside
 * directory is rejected). Throws if the path is outside the project root or
 * cannot be resolved. Returns the literal resolved path.
 */
export function safePath(raw: string, root: string): string {
  const resolved = path.resolve(root, raw);
  const normalizedRoot = path.resolve(root);
  if (!inside(resolved, normalizedRoot)) {
    throw new Error(`Path "${raw}" escapes project root "${normalizedRoot}"`);
  }
  const realRoot = realPathNearest(normalizedRoot);
  const realTarget = realPathNearest(resolved);
  if (!inside(realTarget, realRoot)) {
    throw new Error(
      `Path "${raw}" escapes project root "${normalizedRoot}" through a symlink (real path "${realTarget}")`,
    );
  }
  return resolved;
}
