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
 * Whether `score` (edit distance, or 0.5 for a prefix hit) is close enough for `input`.
 * Scales with input length so 1–2 character inputs do not match almost everything
 * (e.g. `x` must not suggest `ai`). Prefix hits are always accepted.
 */
function withinThreshold(
  inputLen: number,
  score: number,
  candidate: string,
  input: string,
): boolean {
  if (score === 0.5 || score === 0) return true;
  // Single character: only an exact (case-insensitive) match — never guess `a` → `ai`.
  if (inputLen <= 1) return false;
  // Two characters: one edit, same first letter (`rn` → `run`), or a prefix hit above.
  if (inputLen === 2) {
    return score <= 1 && candidate.toLowerCase()[0] === input[0];
  }
  // Longer input: allow up to floor(len/3) edits, at least 1 and at most 2.
  const maxDist = Math.min(Math.max(1, Math.floor(inputLen / 3)), 2);
  return score <= maxDist;
}

/**
 * Candidates close enough to `input` to be likely typos, best first.
 * Comparison is case-insensitive. A candidate that starts with the input
 * (`insp` → `inspect`, `bu` → `build` and `build-editor`) counts as a prefix hit;
 * when several share a prefix, up to three are returned (ambiguous).
 * Otherwise at most one edit-distance match within a length-scaled threshold.
 */
export function closestMatches(input: string, candidates: Iterable<string>): string[] {
  const clean = input.toLowerCase();
  if (!clean) return [];

  const prefixes: string[] = [];
  let best: string | undefined;
  let bestScore = Infinity;

  for (const candidate of candidates) {
    const lower = candidate.toLowerCase();
    if (clean.length >= 2 && lower.startsWith(clean)) {
      prefixes.push(candidate);
      continue;
    }
    const score = editDistance(clean, lower);
    if (score < bestScore) {
      best = candidate;
      bestScore = score;
    }
  }

  if (prefixes.length > 0) return prefixes.slice(0, 3);

  if (best === undefined) return [];
  if (!withinThreshold(clean.length, bestScore, best, clean)) return [];
  return [best];
}

/**
 * The single closest candidate, or undefined when nothing is close enough / the
 * prefix match is ambiguous (more than one). Prefer {@link closestMatches} when
 * the caller can list several suggestions.
 */
export function closest(input: string, candidates: Iterable<string>): string | undefined {
  const matches = closestMatches(input, candidates);
  return matches.length === 1 ? matches[0] : undefined;
}

/** ` Did you mean "a"?` / ` Did you mean "a" or "b"?` / ` Did you mean "a", "b", or "c"?`. */
export function formatDidYouMean(matches: string[]): string {
  if (matches.length === 0) return "";
  if (matches.length === 1) return ` Did you mean "${matches[0]}"?`;
  if (matches.length === 2) return ` Did you mean "${matches[0]}" or "${matches[1]}"?`;
  const head = matches
    .slice(0, -1)
    .map((m) => `"${m}"`)
    .join(", ");
  return ` Did you mean ${head}, or "${matches[matches.length - 1]}"?`;
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
