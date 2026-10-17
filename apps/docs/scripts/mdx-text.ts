/**
 * Escape text for MDX prose or a table cell outside code spans.
 * `{` starts an expression. `$…$` is Mintlify math, so `$&#123;name&#125;`
 * renders as the entity. `\$\{name\}` renders as `${name}`.
 */
export function cell(text: unknown): string {
  if (text === undefined || text === null || text === "") return "";
  return String(text)
    .replace(/\s+/g, " ")
    .replace(/\\/g, "\\\\")
    .replace(/\|/g, "\\|")
    .replace(/[{}]/g, (c) => `\\${c}`)
    .replace(/\$\\\{/g, "\\$\\{")
    .replace(/[<>]/g, (c) => `&#${c.charCodeAt(0)};`);
}
