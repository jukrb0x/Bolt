/**
 * Optimal String Alignment distance (restricted Damerau–Levenshtein).
 * Adjacent transposition counts as 1 (unlike plain Levenshtein).
 */
export function editDistance(a: string, b: string): number {
  const n = a.length;
  const m = b.length;
  const d: number[][] = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0));
  for (let i = 0; i <= n; i++) d[i][0] = i;
  for (let j = 0; j <= m; j++) d[0][j] = j;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(
        d[i - 1][j] + 1, // deletion
        d[i][j - 1] + 1, // insertion
        d[i - 1][j - 1] + cost, // substitution
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1); // adjacent transposition
      }
    }
  }
  return d[n][m];
}

/**
 * Whether `score` (edit distance, or 0.5 for a prefix hit) is close enough for `input`.
 * Scales with input length so 1–2 character inputs do not match almost everything
 * (e.g. `x` must not suggest `ai`). Prefix hits and exact matches are always accepted.
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
 * Comparison is case-insensitive.
 * - A case-insensitive exact match is preferred and returned alone (before any
 *   distance or prefix check), so `Build` → `build` even when `build-editor` exists.
 * - Otherwise prefix hits (`insp` → `inspect`, `bu` → `build` and `build-editor`);
 *   when several share a prefix, up to three are returned (ambiguous).
 * - Otherwise at most one OSA-distance match within a length-scaled threshold.
 */
export function closestMatches(input: string, candidates: Iterable<string>): string[] {
  const clean = input.toLowerCase();
  if (!clean) return [];

  const list = [...candidates];

  // Case-insensitive exact match must run before distance / prefix checks.
  // Prefer an exact-case match; otherwise list every case-insensitive match
  // (`MARK` with both `mark` and `Mark` declared → both).
  if (list.includes(input)) return [input];
  const ciExact = list.filter((c) => c.toLowerCase() === clean);
  if (ciExact.length > 0) return ciExact.slice(0, 3);

  const prefixes: string[] = [];
  let best: string | undefined;
  let bestScore = Infinity;

  for (const candidate of list) {
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
 * Like {@link closestMatches} for flag names: `-` and `_` are ignored when comparing,
 * so `dryrn` still reaches `dry-run` (one edit once separators are dropped).
 * Returns the original candidate spellings.
 */
export function closestFlagMatches(input: string, candidates: Iterable<string>): string[] {
  const direct = closestMatches(input, candidates);
  if (direct.length > 0) return direct;
  const strip = (s: string) => s.replace(/[-_]/g, "");
  const byStripped = new Map<string, string>();
  for (const c of candidates) {
    const key = strip(c);
    if (key && !byStripped.has(key)) byStripped.set(key, c);
  }
  return closestMatches(strip(input), byStripped.keys()).map((k) => byStripped.get(k) ?? k);
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
