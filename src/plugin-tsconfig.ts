/**
 * Decorator settings the plugin compiler actually uses.
 * `bolt types` copies these into the project tsconfig so the editor matches the loader.
 */
export const PLUGIN_COMPILER_OPTIONS = {
  experimentalDecorators: true,
  useDefineForClassFields: false,
  target: "ESNext",
  module: "ESNext",
  moduleResolution: "bundler",
} as const;

export function pluginAuthorTsconfig(): string {
  return (
    JSON.stringify(
      {
        compilerOptions: {
          ...PLUGIN_COMPILER_OPTIONS,
          strict: true,
          noEmit: true,
          skipLibCheck: true,
          paths: {
            boltstack: ["./.bolt/types/boltstack.d.ts"],
          },
        },
        include: ["**/*.ts"],
      },
      null,
      2,
    ) + "\n"
  );
}
