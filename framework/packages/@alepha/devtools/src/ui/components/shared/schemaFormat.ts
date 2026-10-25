import { toText } from "./toText.ts";
/**
 * Formatting helpers for rendering JSON Schema as a readable tree.
 *
 * These read the JSON Schema that `DevToolsMetadataProvider` publishes — not
 * zod internals. Anything unrecognised degrades to a best-effort label rather
 * than throwing, because one odd schema must not blank the whole panel.
 */

export interface SchemaChip {
  label: string;
}

/**
 * Unwrap the `anyOf: [T, { type: "null" }]` / `type: [T, "null"]` shapes zod
 * emits for nullable values, returning the meaningful branch plus whether the
 * value accepts null.
 */
export const unwrapNullable = (
  schema: any,
): { schema: any; nullable: boolean } => {
  if (!schema || typeof schema !== "object") {
    return { schema, nullable: false };
  }

  if (Array.isArray(schema.type) && schema.type.includes("null")) {
    const rest = schema.type.filter((t: string) => t !== "null");
    return {
      schema: { ...schema, type: rest.length === 1 ? rest[0] : rest },
      nullable: true,
    };
  }

  const union = schema.anyOf ?? schema.oneOf;
  if (Array.isArray(union)) {
    const nonNull = union.filter((s: any) => s?.type !== "null");
    if (nonNull.length !== union.length) {
      return {
        schema:
          nonNull.length === 1 ? nonNull[0] : { ...schema, anyOf: nonNull },
        nullable: true,
      };
    }
  }

  return { schema, nullable: false };
};

/**
 * A short type label: `string`, `integer`, `object`, `array<string>`, `enum`,
 * or a union rendered as `a | b`.
 */
export const typeLabel = (schema: any): string => {
  if (!schema || typeof schema !== "object") {
    return "any";
  }
  if (Array.isArray(schema.enum)) {
    return "enum";
  }
  if (schema.const !== undefined) {
    return "literal";
  }

  const union = schema.anyOf ?? schema.oneOf;
  if (Array.isArray(union) && union.length > 0) {
    return union.map((s: any) => typeLabel(s)).join(" | ");
  }

  if (schema.type === "array") {
    const items = unwrapNullable(schema.items).schema;
    return items ? `array<${typeLabel(items)}>` : "array";
  }

  if (typeof schema.type === "string") {
    return schema.type;
  }
  if (schema.properties) {
    return "object";
  }
  return "any";
};

/**
 * Constraint chips shown after the type — the parts of a schema a developer
 * actually needs when filling a request by hand.
 */
export const constraintChips = (schema: any): SchemaChip[] => {
  if (!schema || typeof schema !== "object") {
    return [];
  }
  const chips: SchemaChip[] = [];
  const push = (label: string) => chips.push({ label });

  if (schema.format) push(String(schema.format));
  if (schema.default !== undefined) {
    push(`default: ${formatScalar(schema.default)}`);
  }
  if (schema.minLength !== undefined) push(`minLength: ${schema.minLength}`);
  if (schema.maxLength !== undefined) push(`maxLength: ${schema.maxLength}`);
  if (schema.minimum !== undefined) push(`min: ${schema.minimum}`);
  if (schema.maximum !== undefined) push(`max: ${schema.maximum}`);
  if (schema.minItems !== undefined) push(`minItems: ${schema.minItems}`);
  if (schema.maxItems !== undefined) push(`maxItems: ${schema.maxItems}`);
  if (schema.pattern) push(`pattern: ${truncate(String(schema.pattern), 24)}`);
  if (schema.readOnly) push("read-only");

  return chips;
};

/**
 * Enum members, capped so a 40-value enum can't push the description off the
 * row. The remainder is reported as a count.
 */
export const enumMembers = (
  schema: any,
  limit = 4,
): { shown: string[]; extra: number } => {
  const values: unknown[] = Array.isArray(schema?.enum) ? schema.enum : [];
  return {
    shown: values.slice(0, limit).map((v) => formatScalar(v)),
    extra: Math.max(0, values.length - limit),
  };
};

/**
 * Child rows of a branch: object properties, or an array's item schema shown
 * once under an ellipsis name.
 */
export const childEntries = (
  schema: any,
): Array<{ name: string; schema: any; required: boolean }> => {
  if (!schema || typeof schema !== "object") {
    return [];
  }

  if (schema.properties && typeof schema.properties === "object") {
    const required: string[] = Array.isArray(schema.required)
      ? schema.required
      : [];
    return Object.entries(schema.properties).map(([name, child]) => ({
      name,
      schema: child,
      required: required.includes(name),
    }));
  }

  if (schema.type === "array" && schema.items) {
    return [{ name: "…", schema: schema.items, required: false }];
  }

  return [];
};

export const hasChildren = (schema: any): boolean =>
  childEntries(unwrapNullable(schema).schema).length > 0;

export const formatScalar = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (value === null) return "null";
  if (typeof value === "object") return JSON.stringify(value);
  return toText(value);
};

export const truncate = (value: string, max: number): string =>
  value.length > max ? `${value.slice(0, max - 1)}…` : value;
