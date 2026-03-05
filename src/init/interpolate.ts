const INIT_VAR_PATTERN = /\$\{\{\s*_init\.(\w+)\s*\}\}/g;

export function interpolateTemplate(
  template: string,
  answers: Record<string, string | boolean | string[]>
): string {
  // First, interpolate all known variables
  let result = template.replace(INIT_VAR_PATTERN, (match, key) => {
    const value = answers[key];
    if (value === undefined || value === null) {
      return match; // Keep original if not found
    }
    if (Array.isArray(value)) {
      return value.join(", ");
    }
    return String(value);
  });

  // Remove lines containing unresolved ${{ ... }} patterns
  // This handles conditional fields that weren't answered
  // But preserve comment lines (they're documentation, not data)
  result = result
    .split("\n")
    .filter((line) => {
      // Keep lines without ${{ patterns
      if (!line.includes("${{")) return true;
      // Keep comment lines (start with # after optional whitespace)
      if (/^\s*#/.test(line)) return true;
      // Remove data lines with unresolved variables
      return false;
    })
    .join("\n");

  // Clean up multiple blank lines that might result from removals
  result = result.replace(/\n{3,}/g, "\n\n");

  return result;
}
