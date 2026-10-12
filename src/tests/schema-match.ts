/**
 * Subset of draft-07 used by bolt.yaml's schema.
 * ponytail: no if/then, unevaluatedProperties, or remote $ref.
 * Upgrade path: a full validator if the schema grows past this subset.
 */
export function schemaErrors(
  schema: Record<string, unknown>,
  value: unknown,
  root?: Record<string, unknown>,
): string[] {
  const doc = root ?? schema;
  if (typeof schema.$ref === "string") {
    const name = schema.$ref.replace(/^#\/\$defs\//, "");
    const defs = doc.$defs as Record<string, Record<string, unknown>>;
    return schemaErrors(defs[name], value, doc);
  }
  if (Array.isArray(schema.oneOf)) {
    const matched = schema.oneOf.filter(
      (branch) => schemaErrors(branch as Record<string, unknown>, value, doc).length === 0,
    );
    return matched.length === 1 ? [] : [`oneOf matched ${matched.length}`];
  }

  const errors: string[] = [];
  if (schema.type !== undefined && !typeOk(schema.type, value)) {
    errors.push(`type ${String(schema.type)}`);
  }
  if ("const" in schema && value !== schema.const) errors.push("const");
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) errors.push("enum");
  if (schema.not && notFails(schema.not as Record<string, unknown>, value)) errors.push("not");
  if (
    typeof value === "string" &&
    typeof schema.minLength === "number" &&
    value.length < schema.minLength
  ) {
    errors.push("minLength");
  }
  if (
    typeof value === "string" &&
    typeof schema.pattern === "string" &&
    !new RegExp(schema.pattern).test(value)
  ) {
    errors.push("pattern");
  }
  if (
    typeof value === "number" &&
    typeof schema.exclusiveMinimum === "number" &&
    !(value > schema.exclusiveMinimum)
  ) {
    errors.push("exclusiveMinimum");
  }

  if (schema.type === "object" && isObject(value)) {
    const properties = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;
    const required = (schema.required ?? []) as string[];
    for (const key of required) {
      if (!(key in value)) errors.push(`required ${key}`);
    }
    for (const [key, child] of Object.entries(value)) {
      if (properties[key]) {
        errors.push(...schemaErrors(properties[key], child, doc).map((err) => `${key}: ${err}`));
      } else if (schema.additionalProperties === false) {
        errors.push(`additional ${key}`);
      } else if (isObject(schema.additionalProperties)) {
        errors.push(
          ...schemaErrors(schema.additionalProperties, child, doc).map((err) => `${key}: ${err}`),
        );
      }
    }
  }

  if (schema.type === "array" && Array.isArray(value) && isObject(schema.items)) {
    value.forEach((item, index) => {
      errors.push(
        ...schemaErrors(schema.items as Record<string, unknown>, item, doc).map(
          (err) => `${index}: ${err}`,
        ),
      );
    });
  }

  return errors;
}

function notFails(schema: Record<string, unknown>, value: unknown): boolean {
  if (typeof schema.pattern === "string" && typeof value === "string") {
    return new RegExp(schema.pattern).test(value);
  }
  if (Array.isArray(schema.enum)) return schema.enum.includes(value);
  return false;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function typeOk(type: unknown, value: unknown): boolean {
  if (type === "object") return isObject(value);
  if (type === "array") return Array.isArray(value);
  if (type === "string") return typeof value === "string";
  if (type === "number") return typeof value === "number";
  if (type === "boolean") return typeof value === "boolean";
  if (type === "null") return value === null;
  return false;
}
