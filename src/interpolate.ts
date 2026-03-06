type Context = Record<string, Record<string, string>>;

export function interpolate(template: string, ctx: Context): string {
  return template.replace(/\$\{\{\s*([\w.]+)\s*\}\}/g, (match, key: string) => {
    const parts = key.split(".");
    let value: any = ctx;
    for (const part of parts) {
      if (value == null || typeof value !== "object") return match;
      value = value[part];
    }
    if (value == null || typeof value === "object") return match;
    return String(value);
  });
}
