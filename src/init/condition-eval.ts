// src/init/condition-eval.ts
export function evaluateCondition(
  condition: string | undefined,
  answers: Record<string, string | boolean | string[]>
): boolean {
  if (!condition || condition.trim() === "") {
    return true;
  }

  // Simple expression parser for: var == 'value' or var != 'value'
  // Uses backreference to ensure matching quote pairs
  const eqMatch = condition.match(/^(\w+)\s*==\s*(['"])(.*?)\2$/);
  if (eqMatch) {
    const [, varName, , expectedValue] = eqMatch;
    const actualValue = answers[varName];
    return String(actualValue) === expectedValue;
  }

  const neqMatch = condition.match(/^(\w+)\s*!=\s*(['"])(.*?)\2$/);
  if (neqMatch) {
    const [, varName, , expectedValue] = neqMatch;
    const actualValue = answers[varName];
    return String(actualValue) !== expectedValue;
  }

  // Unknown condition format - default to true
  return true;
}
