/** Levenshtein distance between two strings. */
export function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[b.length];
}

/**
 * The candidate closest to `input`, or undefined when nothing is close enough to be a
 * likely typo. Comparison is case-insensitive; a candidate that starts with the input
 * (`insp` -> `inspect`) also counts as close.
 */
export function closest(input: string, candidates: Iterable<string>): string | undefined {
  const clean = input.toLowerCase();
  let best: string | undefined;
  let bestScore = Infinity;
  for (const candidate of candidates) {
    const lower = candidate.toLowerCase();
    const score = clean.length >= 2 && lower.startsWith(clean) ? 0.5 : editDistance(clean, lower);
    if (score < bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  if (best && bestScore <= Math.max(2, Math.floor(best.length / 3))) return best;
  return undefined;
}

/**
 * Quote a value for the shell when it is empty or contains characters the shell
 * would split or interpret (double quotes work in sh, PowerShell and cmd), so suggested commands can be copy-pasted as-is.
 */
export function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(value)) return value;
  if (!/["$`\\!]/.test(value)) return `"${value}"`;
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
