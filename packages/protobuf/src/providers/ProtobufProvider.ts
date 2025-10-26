import { $inject, Alepha, type TObject, type TSchema, t } from "@alepha/core";
import type { Type } from "protobufjs";
import protobufjs from "protobufjs";

export class ProtobufProvider {
  protected readonly alepha = $inject(Alepha);
  protected readonly schemas: Map<string | TObject, Type> = new Map();
  protected readonly protobuf: typeof protobufjs = protobufjs;
  protected readonly enumDefinitions: Map<string, string[]> = new Map();

  /**
   * Encode an object to a Uint8Array.
   */
  public encode(schema: ProtobufSchema, message: any): Uint8Array {
    return this.parse(schema).encode(message).finish();
  }

  /**
   * Decode a Uint8Array to an object.
   */
  public decode<T = any>(schema: ProtobufSchema, data: Uint8Array): T {
    return this.parse(schema).decode(data) as T;
  }

  /**
   * Parse a TypeBox schema to a Protobuf Type schema ready for encoding/decoding.
   */
  public parse(schema: ProtobufSchema, typeName = "root.Target"): Type {
    const exists = this.schemas.get(schema);
    if (exists) {
      return exists;
    }

    const result = this.protobuf.parse(schema);
    const type = result.root.lookupType(typeName);
    this.schemas.set(schema, type);
    return type;
  }

  /**
   * Convert a TypeBox schema to a Protobuf schema as a string.
   */
  public createProtobufSchema(
    schema: TSchema,
    options: CreateProtobufSchemaOptions = {},
  ): string {
    const { rootName = "root", mainMessageName = "Target" } = options;
    // Clear enum definitions for this schema generation
    this.enumDefinitions.clear();

    const context = {
      proto: `package ${rootName};\nsyntax = "proto3";\n\n`,
      fieldIndex: 1,
    };

    if (t.schema.isObject(schema)) {
      const { message, subMessages } = this.parseObjectWithDependencies(
        schema,
        mainMessageName,
      );

      // Add all enum definitions first
      for (const [enumName, values] of this.enumDefinitions) {
        context.proto += this.generateEnumDefinition(enumName, values);
      }

      // Add all sub-messages
      context.proto += subMessages.join("");
      // Then add the main message
      context.proto += message;
    }

    return context.proto;
  }

  /**
   * Parse an object schema with dependencies (sub-messages).
   */
  protected parseObjectWithDependencies(
    obj: TSchema,
    parentName: string,
  ): { message: string; subMessages: string[] } {
    if (!t.schema.isObject(obj)) {
      return { message: "", subMessages: [] };
    }

    const fields: string[] = [];
    const subMessages: string[] = [];
    let fieldIndex = 1;

    for (const [key, value] of Object.entries(obj.properties)) {
      // Handle arrays
      if (t.schema.isArray(value)) {
        // Check if array items are enums
        if (this.isEnum(value.items)) {
          const enumValues = this.getEnumValues(value.items);
          const enumName = this.registerEnum(key, enumValues);
          fields.push(`  repeated ${enumName} ${key} = ${fieldIndex++};`);
          continue;
        }

        if (t.schema.isObject(value.items)) {
          const subMessageName =
            "title" in value.items && typeof value.items.title === "string"
              ? value.items.title
              : `${parentName}_${key}`;
          const { message: subMessage, subMessages: nestedSubMessages } =
            this.parseObjectWithDependencies(value.items, subMessageName);
          subMessages.push(...nestedSubMessages);
          subMessages.push(subMessage);
          fields.push(`  repeated ${subMessageName} ${key} = ${fieldIndex++};`);
          continue;
        }

        const itemType = this.convertType(value.items);
        fields.push(`  repeated ${itemType} ${key} = ${fieldIndex++};`);
        continue;
      }

      // Handle nested objects
      if (t.schema.isObject(value)) {
        const subMessageName =
          "title" in value && typeof value.title === "string"
            ? value.title
            : `${parentName}_${key}`;
        const { message: subMessage, subMessages: nestedSubMessages } =
          this.parseObjectWithDependencies(value, subMessageName);
        subMessages.push(...nestedSubMessages);
        subMessages.push(subMessage);
        fields.push(`  ${subMessageName} ${key} = ${fieldIndex++};`);
        continue;
      }

      // Handle union types (nullable fields)
      if (t.schema.isUnion(value)) {
        const nonNullType = value.anyOf.find(
          (type: TSchema) => !t.schema.isNull(type),
        );
        if (nonNullType) {
          // Check if it's an enum
          if (this.isEnum(nonNullType)) {
            const enumValues = this.getEnumValues(nonNullType);
            const enumName = this.registerEnum(key, enumValues);
            fields.push(`  ${enumName} ${key} = ${fieldIndex++};`);
            continue;
          }

          if (t.schema.isObject(nonNullType)) {
            const subMessageName =
              "title" in nonNullType && typeof nonNullType.title === "string"
                ? nonNullType.title
                : `${parentName}_${key}`;
            const { message: subMessage, subMessages: nestedSubMessages } =
              this.parseObjectWithDependencies(nonNullType, subMessageName);
            subMessages.push(...nestedSubMessages);
            subMessages.push(subMessage);
            fields.push(`  ${subMessageName} ${key} = ${fieldIndex++};`);
            continue;
          }
          const fieldType = this.convertType(nonNullType);
          fields.push(`  ${fieldType} ${key} = ${fieldIndex++};`);
          continue;
        }
      }

      // Handle records (maps)
      if (t.schema.isRecord(value)) {
        // TypeBox records use additionalProperties or patternProperties for the value type
        let valueSchema: TSchema | undefined;
        if (
          "additionalProperties" in value &&
          value.additionalProperties &&
          typeof value.additionalProperties === "object"
        ) {
          valueSchema = value.additionalProperties;
        } else if (
          value.patternProperties &&
          typeof value.patternProperties === "object"
        ) {
          // Get the first pattern property (usually "^(.*)$" or similar)
          const patterns = Object.values(value.patternProperties);
          if (patterns.length > 0 && typeof patterns[0] === "object") {
            valueSchema = patterns[0] as TSchema;
          }
        }

        if (valueSchema) {
          const valueType = this.convertType(valueSchema);
          fields.push(`  map<string, ${valueType}> ${key} = ${fieldIndex++};`);
          continue;
        }
      }

      // Handle enum fields
      if (this.isEnum(value)) {
        const enumValues = this.getEnumValues(value);
        const enumName = this.registerEnum(key, enumValues);
        fields.push(`  ${enumName} ${key} = ${fieldIndex++};`);
        continue;
      }

      // Handle regular fields
      const fieldType = this.convertType(value);
      fields.push(`  ${fieldType} ${key} = ${fieldIndex++};`);
    }

    const message = `message ${parentName} {\n${fields.join("\n")}\n}\n`;
    return { message, subMessages };
  }

  /**
   * Convert a primitive TypeBox schema type to a Protobuf spec type.
   */
  protected convertType(schema: TSchema): string {
    if (t.schema.isBoolean(schema)) return "bool";
    if (t.schema.isNumber(schema) && schema.format === "int64") return "int64";
    if (t.schema.isNumber(schema)) return "double";
    if (t.schema.isInteger(schema)) return "int32";
    if (t.schema.isBigInt(schema)) return "int64";
    if (t.schema.isString(schema)) return "string";

    // Handle union types (nullable)
    if (t.schema.isUnion(schema)) {
      // Find the non-null type in the union
      const nonNullType = schema.anyOf.find(
        (type: TSchema) => !t.schema.isNull(type),
      );
      if (nonNullType) {
        return this.convertType(nonNullType);
      }
    }

    // Handle optional types
    if (t.schema.isOptional(schema)) {
      return this.convertType(schema);
    }

    // Handle unsafe types (like enums)
    if (t.schema.isUnsafe(schema)) {
      // if it's an enum or other unsafe types, default to string
      return "string";
    }

    throw new Error(`Unsupported type: ${JSON.stringify(schema)}`);
  }

  /**
   * Check if a schema is an enum type.
   * TypeBox enums have an "enum" property with an array of values.
   */
  protected isEnum(schema: TSchema): boolean {
    return "enum" in schema && Array.isArray(schema.enum);
  }

  /**
   * Extract enum values from a TypeBox enum schema.
   */
  protected getEnumValues(schema: TSchema): string[] {
    if ("enum" in schema && Array.isArray(schema.enum)) {
      return schema.enum.map(String);
    }
    return [];
  }

  /**
   * Register an enum and return its type name.
   * Generates a PascalCase name from the field name.
   */
  protected registerEnum(fieldName: string, values: string[]): string {
    // Capitalize first letter of field name for enum type name
    const enumName = fieldName.charAt(0).toUpperCase() + fieldName.slice(1);

    // Check if we already have this exact enum registered
    const valueKey = values.join(",");
    const existingEnum = Array.from(this.enumDefinitions.entries()).find(
      ([_, enumValues]) => enumValues.join(",") === valueKey,
    );

    if (existingEnum) {
      // Reuse existing enum with same values
      return existingEnum[0];
    }

    // Register new enum
    this.enumDefinitions.set(enumName, values);
    return enumName;
  }

  /**
   * Generate a protobuf enum definition.
   */
  protected generateEnumDefinition(enumName: string, values: string[]): string {
    const enumValues = values
      .map((value, index) => `  ${value} = ${index};`)
      .join("\n");
    return `enum ${enumName} {\n${enumValues}\n}\n`;
  }
}

export type ProtobufSchema = string;

export interface CreateProtobufSchemaOptions {
  rootName?: string;
  mainMessageName?: string;
}
