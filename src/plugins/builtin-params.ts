import { z, type ZodTypeAny } from "zod";

/**
 * Param schemas for built-in handlers that do not declare a manifest schema.
 * Used by the runner (before a handler is called) and by the static `--dry-run`
 * check. Objects pass extra keys through: `--key=value` params apply to every step
 * of a run, so a key a handler does not use is not an error.
 */
const path = z.string().describe("Path, relative to the bolt.yaml directory");
const obj = (shape: z.ZodRawShape) => z.object(shape).passthrough();

export const BUILTIN_PARAM_SCHEMAS: Record<string, Record<string, ZodTypeAny>> = {
  fs: {
    copy: obj({ src: path, dst: path }),
    move: obj({ src: path, dst: path }),
    delete: obj({ path }),
    mkdir: obj({ path }),
  },
  json: {
    set: obj({ file: path, key: z.string(), value: z.string() }),
    merge: obj({ file: path, patch: path }),
  },
  git: {
    pull: obj({ path, branch: z.string().optional() }),
    status: obj({ path }),
    info: obj({ path }),
    checkout: obj({ path, branch: z.string() }),
    clone: obj({ url: z.string(), path }),
  },
  svn: {
    update: obj({ path }),
    cleanup: obj({ path }),
    revert: obj({ path }),
    info: obj({ path }),
    commit: obj({ path, message: z.string().optional() }),
    add: obj({ path }),
    status: obj({ path }),
  },
};
