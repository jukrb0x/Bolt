import { lstatSync, realpathSync } from "fs";
import path from "path";

/**
 * Real path of `p` with symlinks resolved. When `p` does not exist, the nearest
 * existing ancestor is resolved and the missing tail is re-joined, so a missing
 * file under a symlinked directory is judged by where it would really live.
 * Throws a clear error for a symlink loop, a dangling symlink, or any other
 * resolution failure (e.g. permission denied); callers decide whether that rejects.
 */
export function realPathNearest(p: string): string {
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

/**
 * Main's literal check: resolve against the project root and reject a path that
 * escapes it textually (`../x`). Symlinks are not followed, so an in-project link
 * to an outside directory is allowed (used by fs/* and json/* for human runs; core
 * rejects such paths for AI invocations).
 */
export function literalSafePath(raw: string, root: string): string {
  const resolved = path.resolve(root, raw);
  const normalizedRoot = path.resolve(root);
  if (!inside(resolved, normalizedRoot)) {
    throw new Error(`Path "${raw}" escapes project root "${normalizedRoot}"`);
  }
  return resolved;
}

/**
 * {@link literalSafePath} for fs/* and json/* handlers. When the path really lives
 * outside the project through a symlink, the real path is written to the run log
 * file only (no console warning), so human runs behave exactly as on main.
 */
export function projectFilePath(
  raw: string,
  ctx: { configDir: string; logger: object },
  ref: string,
): string {
  const resolved = literalSafePath(raw, ctx.configDir);
  try {
    const real = realPathNearest(resolved);
    const realRoot = realPathNearest(path.resolve(ctx.configDir));
    if (!inside(real, realRoot)) {
      const writeRaw = (ctx.logger as { writeRaw?: (text: string) => void }).writeRaw;
      writeRaw?.call(
        ctx.logger,
        `[DEBUG] ${ref}: "${raw}" resolves through a symlink to "${real}" (outside the project)\n`,
      );
    }
  } catch {
    // Unresolvable paths behave as on main for human runs; core rejects them for AI.
  }
  return resolved;
}
