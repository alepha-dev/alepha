import { z } from "../providers/TypeProvider.ts";
import type { ZType } from "../providers/ZodProvider.ts";

/**
 * Convert a JSON Schema object into a zod schema (the inverse of
 * `z.toJSONSchema`). zod 4 has no native `fromJSONSchema`, so this provides the
 * round-trip needed by dynamic, schema-driven UIs (e.g. devtools forms built
 * from an entity's or action's published JSON Schema).
 *
 * Covers the JSON Schema subset Alepha emits: object/array/string (+formats),
 * number/integer, boolean, null, enum, and `anyOf`/`oneOf` (including the
 * nullable `anyOf: [..., { type: "null" }]` shape). Anything unrecognized falls
 * back to `z.any()`.
 */
export const jsonSchemaToZod = (schema: any): ZType => {
  if (!schema || typeof schema !== "object") {
    return z.any();
  }

  // Unions (and the nullable `anyOf: [X, { type: "null" }]` shape).
  const variants = schema.anyOf ?? schema.oneOf;
  if (Array.isArray(variants) && variants.length > 0) {
    const nonNull = variants.filter(
      (v: any) => v?.type !== "null" && v !== null,
    );
    const nullable = nonNull.length !== variants.length;
    const mapped = nonNull.map(jsonSchemaToZod);
    let result: ZType =
      mapped.length === 1
        ? mapped[0]
        : z.union(mapped as [ZType, ZType, ...ZType[]]);
    if (nullable) result = result.nullable();
    return result;
  }

  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    const values = schema.enum.filter((v: unknown) => typeof v === "string");
    if (values.length === schema.enum.length) {
      return z.enum(values as [string, ...string[]]);
    }
  }

  switch (schema.type) {
    case "object": {
      const required: string[] = Array.isArray(schema.required)
        ? schema.required
        : [];
      const shape: Record<string, ZType> = {};
      for (const [key, value] of Object.entries(schema.properties ?? {})) {
        const child = jsonSchemaToZod(value);
        shape[key] = required.includes(key) ? child : child.optional();
      }
      return z.object(shape);
    }

    case "array":
      return z.array(jsonSchemaToZod(schema.items ?? {}));

    case "string": {
      switch (schema.format) {
        case "uuid":
          return z.uuid();
        case "email":
          return z.email();
        case "url":
        case "uri":
          return z.url();
        case "date-time":
          return z.datetime();
        case "date":
          return z.date();
        case "time":
          return z.time();
        case "binary":
          return z.binary();
      }
      return z
        .string()
        .min(schema.minLength)
        .max(schema.maxLength)
        .regex(new RegExp(schema.pattern));
    }

    case "integer":
      return z.integer().min(schema.minimum).max(schema.maximum);

    case "number":
      return z.number().min(schema.minimum).max(schema.maximum);

    case "boolean":
      return z.boolean();

    case "null":
      return z.null();

    default:
      return z.any();
  }
};
