type Context = Record<string, Record<string, string>>;

export function interpolate(template: string, ctx: Context): string {
  return template.replace(/\$\{\{\s*([\w.]+)\s*\}\}/g, (match, key: string) => {
    const [ns, field] = key.split(".");
    return ctx[ns]?.[field] ?? match;
  });
}
