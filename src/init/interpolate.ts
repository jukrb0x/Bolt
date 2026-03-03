const INIT_VAR_PATTERN = /\$\{\{\s*_init\.(\w+)\s*\}\}/g;

export function interpolateTemplate(
  template: string,
  answers: Record<string, string | boolean | string[]>
): string {
  return template.replace(INIT_VAR_PATTERN, (match, key) => {
    const value = answers[key];
    if (value === undefined || value === null) {
      return match; // Keep original if not found
    }
    if (Array.isArray(value)) {
      return value.join(", ");
    }
    return String(value);
  });
}
