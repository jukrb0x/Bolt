import declarationText from "./plugin-types.txt" with { type: "text" };

/**
 * Declaration text compiled into this process.
 * `scripts/wrap-dts.ts` copies `bolt.d.ts` here, and `bun build --compile` inlines
 * the text import. A `.txt` file keeps tsc from parsing the ambient declaration.
 * `bolt types` writes this copy, not a file downloaded later.
 */
export const PLUGIN_DECLARATION_TEXT: string = declarationText;

/** Standard exports for a tsconfig `paths` entry. Ambient `declare module` does not resolve that way. */
export function pluginDeclarationBody(source: string): string {
  const match = source.match(/declare module "boltstack" \{([\s\S]*)\n\}\s*$/);
  const raw = match ? match[1] : source;
  const body = raw
    .split("\n")
    .map((line) => (line.startsWith("  ") ? line.slice(2) : line))
    .join("\n")
    .trim();
  return `${body}\n`;
}

export function pluginTypesFile(version: string): string {
  return `/**
 * boltstack types for bolt ${version}.
 * Emitted by \`bolt types\` from the bolt that is running.
 * Run \`bolt types\` again after upgrading bolt. Do not replace this file with a copy from another version.
 */

${pluginDeclarationBody(PLUGIN_DECLARATION_TEXT)}`;
}
