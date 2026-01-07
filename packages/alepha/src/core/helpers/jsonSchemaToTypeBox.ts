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
  // TypeBox internal markers (pass through)
  "~kind"?: string;
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
 *
 * **Not supported:**
 * - oneOf, anyOf, allOf, not (composition schemas)
 * - $ref (references)
 * - additionalProperties, patternProperties
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
export function jsonSchemaToTypeBox(schema: JsonSchemaObject): TSchema {
  // If it already has TypeBox marker, return as-is
  if (schema["~kind"]) {
    return schema as unknown as TSchema;
  }

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
  const options: TStringOptions = filterUndefined({
    title: schema.title,
    description: schema.description,
    default: schema.default as string,
    minLength: schema.minLength,
    maxLength: schema.maxLength,
    pattern: schema.pattern,
  });

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
