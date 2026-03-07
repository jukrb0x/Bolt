import path from "path";

/**
 * Resolve a raw path relative to the project root and verify it doesn't escape.
 * Throws if the resolved path is outside the project root directory.
 */
export function safePath(raw: string, root: string): string {
  const resolved = path.resolve(root, raw);
  const normalizedRoot = path.resolve(root);
  if (resolved !== normalizedRoot && !resolved.startsWith(normalizedRoot + path.sep)) {
    throw new Error(`Path "${raw}" escapes project root "${normalizedRoot}"`);
  }
  return resolved;
}
