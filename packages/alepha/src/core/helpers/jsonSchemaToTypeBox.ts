import type {
  TArrayOptions,
  TNumberOptions,
  TObjectOptions,
  TSchema,
  TStringOptions,
} from "typebox";
import { t } from "../providers/TypeProvider.ts";

/**
 * JSON Schema representation for conversion to TypeBox.
 */
export interface JsonSchemaObject {
  type?: string | string[];
  properties?: Record<string, JsonSchemaObject>;
  required?: string[];
  items?: JsonSchemaObject;
  enum?: (string | number | boolean)[];
  const?: unknown;
  format?: string;
  title?: string;
  description?: string;
  default?: unknown;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  multipleOf?: number;
  pattern?: string;
  minItems?: number;
  maxItems?: number;
  uniqueItems?: boolean;
  // Alepha text options (trim, lowercase)
  "~options"?: {
    trim?: boolean;
    lowercase?: boolean;
  };
  // Not supported
  oneOf?: JsonSchemaObject[];
  anyOf?: JsonSchemaObject[];
  allOf?: JsonSchemaObject[];
  not?: JsonSchemaObject;
  $ref?: string;
}

/**
 * Converts a JSON Schema object to a TypeBox schema using Alepha's type system.
 *
 * This is useful when receiving JSON Schema from an API (e.g., configuration schemas)
 * and needing to use them with TypeBox-based form rendering or validation.
 *
 * **Supports:**
 * - Basic types: string, number, integer, boolean, null, object, array
 * - String formats: email, uuid, date-time, date, time, url/uri, binary, bigint, duration, color
 * - Enums (string enums)
 * - Nested objects with required/optional properties
 * - Arrays with item schemas
 * - Common validation options: minLength, maxLength, minimum, maximum, pattern
 * - anyOf/oneOf/allOf with nullable patterns (e.g., `anyOf: [type, null]` → `t.nullable(type)`)
 * - Alepha ~options (trim, lowercase) pass-through
 *
 * **Not supported:**
 * - $ref (references)
 * - additionalProperties, patternProperties
 * - Complex composition schemas (multiple non-null types in anyOf/oneOf/allOf)
 *
 * @param schema - JSON Schema object to convert
 * @returns TypeBox TSchema
 *
 * @example
 * ```ts
 * const jsonSchema = {
 *   type: "object",
 *   properties: {
 *     email: { type: "string", format: "email" },
 *     age: { type: "integer", minimum: 0 },
 *     active: { type: "boolean" },
 *   },
 *   required: ["email"]
 * };
 *
 * const typeBoxSchema = jsonSchemaToTypeBox(jsonSchema);
 * // Equivalent to:
 * // t.object({
 * //   email: t.email(),
 * //   age: t.optional(t.integer({ minimum: 0 })),
 * //   active: t.optional(t.boolean()),
 * // })
 * ```
 */
export function jsonSchemaToTypeBox(schema: JsonSchemaObject): any {
  // Handle const (literal)
  if (schema.const !== undefined) {
    return t.const(schema.const as string | number | boolean);
  }

  // Handle enum
  if (schema.enum && Array.isArray(schema.enum)) {
    // String enum
    if (schema.enum.every((v) => typeof v === "string")) {
      return t.enum(
        schema.enum as string[],
        filterUndefined({
          title: schema.title,
          description: schema.description,
          default: schema.default as string,
        }),
      );
    }
    // For non-string enums, use union of literals
    return t.union(
      schema.enum.map((v) => t.const(v as string | number | boolean)),
    );
  }

  // Handle anyOf (typically used for nullable types: anyOf: [type, null])
  if (schema.anyOf && Array.isArray(schema.anyOf)) {
    const nullSchema = schema.anyOf.find((s) => s.type === "null");
    const nonNullSchemas = schema.anyOf.filter((s) => s.type !== "null");

    // If anyOf is [someType, null], convert to t.nullable(someType)
    if (nullSchema && nonNullSchemas.length === 1) {
      const converted = jsonSchemaToTypeBox(nonNullSchemas[0]);
      return t.nullable(converted);
    }

    // For other anyOf cases, create a union
    return t.union(schema.anyOf.map((s) => jsonSchemaToTypeBox(s)));
  }

  // Handle allOf (merge schemas)
  if (schema.allOf && Array.isArray(schema.allOf)) {
    const nullSchema = schema.allOf.find((s) => s.type === "null");
    const nonNullSchemas = schema.allOf.filter((s) => s.type !== "null");

    // If allOf includes null, convert to nullable
    if (nullSchema && nonNullSchemas.length === 1) {
      const converted = jsonSchemaToTypeBox(nonNullSchemas[0]);
      return t.nullable(converted);
    }

    // For other allOf cases, merge the first non-null schema (simplified)
    if (nonNullSchemas.length > 0) {
      return jsonSchemaToTypeBox(nonNullSchemas[0]);
    }
  }

  // Handle oneOf (similar to anyOf)
  if (schema.oneOf && Array.isArray(schema.oneOf)) {
    const nullSchema = schema.oneOf.find((s) => s.type === "null");
    const nonNullSchemas = schema.oneOf.filter((s) => s.type !== "null");

    // If oneOf is [someType, null], convert to t.nullable(someType)
    if (nullSchema && nonNullSchemas.length === 1) {
      const converted = jsonSchemaToTypeBox(nonNullSchemas[0]);
      return t.nullable(converted);
    }

    // For other oneOf cases, create a union
    return t.union(schema.oneOf.map((s) => jsonSchemaToTypeBox(s)));
  }

  // Handle type
  const type = Array.isArray(schema.type) ? schema.type[0] : schema.type;

  switch (type) {
    case "string":
      return convertString(schema);
    case "number":
      return convertNumber(schema);
    case "integer":
      return convertInteger(schema);
    case "boolean":
      return convertBoolean(schema);
    case "null":
      return t.null();
    case "object":
      return convertObject(schema);
    case "array":
      return convertArray(schema);
    default:
      // If no type specified but has properties, treat as object
      if (schema.properties) {
        return convertObject(schema);
      }
      // Fallback to any
      return t.any();
  }
}

/**
 * Remove undefined values from an object.
 */
function filterUndefined<T extends Record<string, unknown>>(
  obj: T,
): Partial<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([_, v]) => v !== undefined),
  ) as Partial<T>;
}

/**
 * Convert JSON Schema string type to TypeBox.
 */
function convertString(schema: JsonSchemaObject): TSchema {
  const baseOptions: TStringOptions = filterUndefined({
    title: schema.title,
    description: schema.description,
    default: schema.default as string,
    minLength: schema.minLength,
    maxLength: schema.maxLength,
    pattern: schema.pattern,
  });

  // Preserve ~options if present (for t.text() compatibility)
  const options: TStringOptions = schema["~options"]
    ? { ...baseOptions, "~options": schema["~options"] }
    : baseOptions;

  switch (schema.format) {
    case "email":
      return t.email(options);
    case "uuid":
      return t.uuid(options);
    case "date-time":
      return t.datetime(options);
    case "date":
      return t.date(options);
    case "time":
      return t.time(options);
    case "url":
    case "uri":
      return t.url(options);
    case "binary":
      return t.binary(options);
    case "bigint":
      return t.bigint(options);
    case "duration":
      return t.duration(options);
    case "color":
      return t.text({ ...options, format: "color" });
    case "e164":
      return t.e164(options);
    case "bcp47":
      return t.bcp47(options);
    default:
      // For unknown formats, preserve the format in text
      if (schema.format) {
        return t.string({ ...options, format: schema.format });
      }
      return t.string(options);
  }
}

/**
 * Convert JSON Schema number type to TypeBox.
 */
function convertNumber(schema: JsonSchemaObject): TSchema {
  return t.number(
    filterUndefined({
      title: schema.title,
      description: schema.description,
      default: schema.default as number,
      minimum: schema.minimum,
      maximum: schema.maximum,
      exclusiveMinimum: schema.exclusiveMinimum,
      exclusiveMaximum: schema.exclusiveMaximum,
      multipleOf: schema.multipleOf,
    }) as TNumberOptions,
  );
}

/**
 * Convert JSON Schema integer type to TypeBox.
 */
function convertInteger(schema: JsonSchemaObject): TSchema {
  return t.integer(
    filterUndefined({
      title: schema.title,
      description: schema.description,
      default: schema.default as number,
      minimum: schema.minimum,
      maximum: schema.maximum,
      exclusiveMinimum: schema.exclusiveMinimum,
      exclusiveMaximum: schema.exclusiveMaximum,
      multipleOf: schema.multipleOf,
    }) as TNumberOptions,
  );
}

/**
 * Convert JSON Schema boolean type to TypeBox.
 */
function convertBoolean(schema: JsonSchemaObject): TSchema {
  return t.boolean(
    filterUndefined({
      title: schema.title,
      description: schema.description,
      default: schema.default as boolean,
    }),
  );
}

/**
 * Convert JSON Schema object type to TypeBox.
 */
function convertObject(schema: JsonSchemaObject): TSchema {
  // No properties means it's a generic object/record
  if (!schema.properties) {
    return t.json(
      filterUndefined({
        title: schema.title,
        description: schema.description,
      }),
    );
  }

  const required = new Set(schema.required ?? []);
  const properties: Record<string, TSchema> = {};

  for (const [key, propSchema] of Object.entries(schema.properties)) {
    let converted = jsonSchemaToTypeBox(propSchema);

    // Wrap in optional if not required
    if (!required.has(key)) {
      converted = t.optional(converted);
    }

    properties[key] = converted;
  }

  return t.object(
    properties,
    filterUndefined({
      title: schema.title,
      description: schema.description,
    }) as TObjectOptions,
  );
}

/**
 * Convert JSON Schema array type to TypeBox.
 */
function convertArray(schema: JsonSchemaObject): TSchema {
  const itemSchema = schema.items ? jsonSchemaToTypeBox(schema.items) : t.any();

  return t.array(
    itemSchema,
    filterUndefined({
      title: schema.title,
      description: schema.description,
      minItems: schema.minItems,
      maxItems: schema.maxItems,
      uniqueItems: schema.uniqueItems,
    }) as TArrayOptions,
  );
}
