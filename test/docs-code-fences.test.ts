import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Guards against the formatter collapsing fenced code blocks onto one line,
// which renders the language name as part of the copied command.
test("docs home install commands stay in multi-line code fences", () => {
  const src = readFileSync(join(import.meta.dir, "..", "apps/docs/index.mdx"), "utf8");
  expect(src).not.toMatch(/```\w+[^\n`]*\s(irm|curl)\s[^\n]*```/);
  expect(src).toContain(
    "\nirm https://raw.githubusercontent.com/jukrb0x/Bolt/main/install.ps1 | iex\n",
  );
  expect(src).toContain(
    "\ncurl -fsSL https://raw.githubusercontent.com/jukrb0x/Bolt/main/install.sh | sh\n",
  );
});
