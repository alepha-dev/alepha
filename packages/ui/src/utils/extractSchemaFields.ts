import type { TObject, TProperties, TSchema } from "alepha";

export interface SchemaField {
  name: string;
  path: string;
  type: string;
  enum?: readonly any[];
  format?: string;
  description?: string;
  nested?: SchemaField[];
}

/**
 * Extract field information from a TypeBox schema for query building.
 * Supports nested objects and provides field metadata for autocomplete.
 */
export function extractSchemaFields(
  schema: TObject | TProperties,
  prefix = "",
): SchemaField[] {
  const fields: SchemaField[] = [];

  // Safety check
  if (!schema || typeof schema !== "object") {
    return fields;
  }

  // Handle TObject wrapper
  const properties =
    "properties" in schema ? schema.properties : (schema as TProperties);

  // Safety check for properties
  if (!properties || typeof properties !== "object") {
    return fields;
  }

  for (const [key, value] of Object.entries(properties)) {
    // Skip if value is not an object (type guard)
    if (typeof value !== "object" || value === null) {
      continue;
    }

    const fieldSchema = value as TSchema & {
      format?: string;
      enum?: readonly any[];
      description?: string;
    };

    const path = prefix ? `${prefix}.${key}` : key;

    // Determine the display type - use format for datetime-related fields
    const format = "format" in fieldSchema ? fieldSchema.format : undefined;
    const baseType =
      "type" in fieldSchema ? (fieldSchema.type as string) : "object";

    let displayType = baseType;
    if (format === "date-time") {
      displayType = "datetime";
    } else if (format === "date") {
      displayType = "date";
    } else if (format === "time") {
      displayType = "time";
    } else if (format === "duration") {
      displayType = "duration";
    }

    const field: SchemaField = {
      name: key,
      path,
      type: displayType,
      format,
      description:
        "description" in fieldSchema ? fieldSchema.description : undefined,
    };

    // Handle enum
    if ("enum" in fieldSchema && fieldSchema.enum) {
      field.enum = fieldSchema.enum;
      field.type = "enum";
    }

    // Handle nested objects
    if (
      "type" in fieldSchema &&
      fieldSchema.type === "object" &&
      "properties" in fieldSchema &&
      typeof fieldSchema.properties === "object"
    ) {
      field.nested = extractSchemaFields(
        fieldSchema.properties as TProperties,
        path,
      );
    }

    fields.push(field);

    // Also add nested fields to the flat list for autocomplete
    if (field.nested) {
      fields.push(...field.nested);
    }
  }

  return fields;
}

/**
 * Get suggested operators based on field type
 */
export function getOperatorsForField(field: SchemaField): string[] {
  const allOperators = ["=", "!="];

  if (field.enum) {
    // Enum fields: equality and IN array
    return [...allOperators, "in"];
  }

  switch (field.type) {
    case "string":
    case "text":
      // String fields: equality, like, and null checks
      return [...allOperators, "~", "~*", "null"];

    case "number":
    case "integer":
      // Numeric fields: all comparison operators
      return [...allOperators, ">", ">=", "<", "<="];

    case "boolean":
      // Boolean fields: only equality
      return allOperators;

    case "datetime":
    case "date":
      // Date fields: all comparison operators
      return [...allOperators, ">", ">=", "<", "<="];

    default:
      return [...allOperators, "null"];
  }
}

/**
 * Get operator symbol and description
 */
export const OPERATOR_INFO: Record<
  string,
  { symbol: string; label: string; example: string }
> = {
  eq: { symbol: "=", label: "equals", example: "name=John" },
  ne: { symbol: "!=", label: "not equals", example: "status!=archived" },
  gt: { symbol: ">", label: "greater than", example: "age>18" },
  gte: { symbol: ">=", label: "greater or equal", example: "age>=18" },
  lt: { symbol: "<", label: "less than", example: "age<65" },
  lte: { symbol: "<=", label: "less or equal", example: "age<=65" },
  like: { symbol: "~", label: "like (case-sensitive)", example: "name~John" },
  ilike: {
    symbol: "~*",
    label: "like (case-insensitive)",
    example: "name~*john",
  },
  null: { symbol: "=null", label: "is null", example: "deletedAt=null" },
  notNull: {
    symbol: "!=null",
    label: "is not null",
    example: "email!=null",
  },
  in: {
    symbol: "[...]",
    label: "in array",
    example: "status=[active,pending]",
  },
};
