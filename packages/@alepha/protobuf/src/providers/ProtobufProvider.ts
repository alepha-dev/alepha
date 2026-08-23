import { $inject, Alepha, AlephaError, type ZType, z } from "alepha";
import type { Type } from "protobufjs";
import protobufjs from "protobufjs";

/**
 * Converts Alepha schemas to Protobuf definitions, and encodes/decodes against
 * them.
 *
 * Schemas are walked as JSON Schema rather than through zod's internal
 * `_zod.def`. `z.toJSONSchema()` is the same conversion the OpenAPI generator
 * and `$tool` already rely on, so this provider tracks one public, documented
 * shape, and does not have to be rewritten whenever the schema layer
 * reorganises its internals.
 */
export class ProtobufProvider {
  protected readonly alepha = $inject(Alepha);
  protected readonly schemas: Map<string, Type> = new Map();
  protected readonly jsonSchemas: WeakMap<ZType, JsonSchema> = new WeakMap();
  protected readonly protobuf: typeof protobufjs = protobufjs;

  /**
   * Encode an object to a Uint8Array.
   */
  public encode(schema: ProtobufSchema, message: any): Uint8Array {
    const type = this.parse(schema);
    // `fromObject` first: it maps enum member names to their wire numbers
    // and decimal strings to 64-bit longs. Encoding the user object directly
    // wrote every enum member but the first as 0 (`"PENDING" >>> 0`), and the
    // round trip "succeeded" with the wrong member.
    return type.encode(type.fromObject(message)).finish();
  }

  /**
   * Decode a Uint8Array to an object.
   *
   * `toObject` rather than the decoded message: it yields a plain object, and
   * `longs: String` is what makes 64-bit fields survive the round trip.
   * protobufjs otherwise hands back a `Long`, while `z.bigint()` is a decimal
   * string — so every int64 field failed validation on the way back in.
   */
  public decode<T = any>(schema: ProtobufSchema, data: Uint8Array): T {
    const type = this.parse(schema);
    return type.toObject(type.decode(data), { longs: String }) as T;
  }

  /**
   * Parse a Protobuf definition into a Type ready for encoding/decoding.
   */
  public parse(schema: ProtobufSchema, typeName = "root.Target"): Type {
    // Keyed on the type name too: a cache keyed on the schema text alone
    // answered `parse(proto, "root.Other")` with the first type parsed.
    const cacheKey = `${typeName}\n${schema}`;
    const exists = this.schemas.get(cacheKey);
    if (exists) {
      return exists;
    }

    const result = this.protobuf.parse(schema);
    const type = result.root.lookupType(typeName);
    this.schemas.set(cacheKey, type);
    return type;
  }

  /**
   * Convert an Alepha schema to its JSON Schema form.
   *
   * `reused: "inline"` is passed explicitly because the alternative — emitting
   * `$ref`/`$defs` for any schema referenced twice — would produce a document
   * the walker below cannot follow. It is zod's default today; naming it here
   * means a change of default cannot silently break encoding.
   */
  public toJsonSchema(schema: ZType): JsonSchema {
    const cached = this.jsonSchemas.get(schema);
    if (cached) {
      return cached;
    }

    const json = z.toJSONSchema(schema as any, {
      reused: "inline",
    }) as JsonSchema;
    this.jsonSchemas.set(schema, json);
    return json;
  }

  /**
   * Convert an Alepha schema to a Protobuf schema as a string.
   */
  public createProtobufSchema(
    schema: ZType,
    options: CreateProtobufSchemaOptions = {},
  ): string {
    const { rootName = "root", mainMessageName = "Target" } = options;
    const json = this.toJsonSchema(schema);

    if (!this.isObject(json)) {
      throw new AlephaError(
        "Protobuf messages are objects: the root schema must be a z.object(), " +
          `received ${json.type ?? "an unsupported schema"}.`,
      );
    }

    // Local to the call, so concurrent conversions cannot see each other's
    // half-built enum table.
    const enumDefinitions = new Map<string, string[]>();
    let proto = `package ${rootName};\nsyntax = "proto3";\n\n`;

    const { message, subMessages } = this.parseObjectWithDependencies(
      json,
      mainMessageName,
      enumDefinitions,
    );

    // Enums first, then sub-messages, then the message that refers to them.
    for (const [enumName, values] of enumDefinitions) {
      proto += this.generateEnumDefinition(enumName, values);
    }
    proto += this.dedupeSubMessages(subMessages).join("");
    proto += message;

    return proto;
  }

  /**
   * Parse an object schema with dependencies (sub-messages).
   */
  protected parseObjectWithDependencies(
    obj: JsonSchema,
    parentName: string,
    enumDefinitions: Map<string, string[]>,
  ): { message: string; subMessages: string[] } {
    if (!this.isObject(obj)) {
      return { message: "", subMessages: [] };
    }

    const fields: string[] = [];
    const subMessages: string[] = [];
    let fieldIndex = 1;

    for (const [key, raw] of Object.entries(obj.properties ?? {})) {
      const value = raw as JsonSchema;

      // Handle arrays
      if (this.isArray(value)) {
        const items = (value.items ?? {}) as JsonSchema;

        if (this.isEnum(items)) {
          const enumName = this.registerEnum(
            key,
            this.getEnumValues(items),
            enumDefinitions,
          );
          fields.push(`  repeated ${enumName} ${key} = ${fieldIndex++};`);
          continue;
        }

        if (this.isObject(items)) {
          const subMessageName = this.subMessageName(items, parentName, key);
          const { message: subMessage, subMessages: nested } =
            this.parseObjectWithDependencies(
              items,
              subMessageName,
              enumDefinitions,
            );
          subMessages.push(...nested, subMessage);
          fields.push(`  repeated ${subMessageName} ${key} = ${fieldIndex++};`);
          continue;
        }

        fields.push(
          `  repeated ${this.convertType(items)} ${key} = ${fieldIndex++};`,
        );
        continue;
      }

      // Records (maps) are objects too, so they must be tested before objects.
      if (this.isRecord(value)) {
        const valueSchema = this.getRecordValueSchema(value);
        if (valueSchema) {
          fields.push(
            `  map<string, ${this.convertType(valueSchema)}> ${key} = ${fieldIndex++};`,
          );
          continue;
        }
      }

      // Handle nested objects
      if (this.isObject(value)) {
        const subMessageName = this.subMessageName(value, parentName, key);
        const { message: subMessage, subMessages: nested } =
          this.parseObjectWithDependencies(
            value,
            subMessageName,
            enumDefinitions,
          );
        subMessages.push(...nested, subMessage);
        fields.push(`  ${subMessageName} ${key} = ${fieldIndex++};`);
        continue;
      }

      // Handle union types (nullable fields)
      if (this.isUnion(value)) {
        const nonNullType = this.getNonNullMember(value);
        if (nonNullType) {
          if (this.isEnum(nonNullType)) {
            const enumName = this.registerEnum(
              key,
              this.getEnumValues(nonNullType),
              enumDefinitions,
            );
            fields.push(`  ${enumName} ${key} = ${fieldIndex++};`);
            continue;
          }

          if (this.isObject(nonNullType)) {
            const subMessageName = this.subMessageName(
              nonNullType,
              parentName,
              key,
            );
            const { message: subMessage, subMessages: nested } =
              this.parseObjectWithDependencies(
                nonNullType,
                subMessageName,
                enumDefinitions,
              );
            subMessages.push(...nested, subMessage);
            fields.push(`  ${subMessageName} ${key} = ${fieldIndex++};`);
            continue;
          }

          fields.push(
            `  ${this.convertType(nonNullType)} ${key} = ${fieldIndex++};`,
          );
          continue;
        }
      }

      // Handle enum fields
      if (this.isEnum(value)) {
        const enumName = this.registerEnum(
          key,
          this.getEnumValues(value),
          enumDefinitions,
        );
        fields.push(`  ${enumName} ${key} = ${fieldIndex++};`);
        continue;
      }

      // Handle regular fields
      fields.push(`  ${this.convertType(value)} ${key} = ${fieldIndex++};`);
    }

    return {
      message: `message ${parentName} {\n${fields.join("\n")}\n}\n`,
      subMessages,
    };
  }

  /**
   * A titled schema embedded twice is emitted twice under the same name, which
   * protobufjs refuses as a duplicate. The same body is kept once; a different
   * body under one name is a real conflict and is reported.
   */
  protected dedupeSubMessages(subMessages: string[]): string[] {
    const bodies = new Map<string, string>();
    const kept: string[] = [];
    for (const subMessage of subMessages) {
      const name = /^message (\w+)/.exec(subMessage)?.[1] ?? subMessage;
      const previous = bodies.get(name);
      if (previous === undefined) {
        bodies.set(name, subMessage);
        kept.push(subMessage);
      } else if (previous !== subMessage) {
        throw new AlephaError(
          `Protobuf message '${name}' is defined twice with different fields; give one of the schemas another title.`,
        );
      }
    }
    return kept;
  }

  /**
   * Name a generated sub-message, preferring an explicit `title` so a schema
   * carrying one keeps a stable name wherever it is embedded.
   */
  protected subMessageName(
    schema: JsonSchema,
    parentName: string,
    key: string,
  ): string {
    return typeof schema.title === "string" && schema.title
      ? schema.title
      : `${parentName}_${key}`;
  }

  /**
   * Convert a primitive JSON Schema node to a Protobuf spec type.
   */
  protected convertType(schema: JsonSchema): string {
    // Before the string check: `z.bigint()` is carried as a string with a
    // `bigint` format, because JSON Schema has no bigint. Testing `type` first
    // would silently widen every 64-bit field to `string`.
    if (this.isBigInt(schema)) return "int64";

    if (this.isBoolean(schema)) return "bool";
    if (this.isInteger(schema)) return "int32";
    if (this.isNumber(schema) && schema.format === "int64") return "int64";
    if (this.isNumber(schema)) return "double";
    if (this.isString(schema)) return "string";

    if (this.isUnion(schema)) {
      const nonNullType = this.getNonNullMember(schema);
      if (nonNullType) {
        return this.convertType(nonNullType);
      }
    }

    throw new AlephaError(
      `Unsupported type for protobuf: ${JSON.stringify(schema)}`,
    );
  }

  /**
   * An object with declared properties — a protobuf message.
   */
  protected isObject(schema: JsonSchema): boolean {
    return schema?.type === "object" && !!schema.properties;
  }

  protected isArray(schema: JsonSchema): boolean {
    return schema?.type === "array";
  }

  /**
   * A record (`map` in protobuf). `z.record()` emits an object with no declared
   * properties whose value schema sits in `additionalProperties`, which is what
   * separates it from `z.object()`.
   */
  protected isRecord(schema: JsonSchema): boolean {
    return (
      schema?.type === "object" &&
      !schema.properties &&
      (this.isSchemaNode(schema.additionalProperties) ||
        this.isSchemaNode(schema.patternProperties))
    );
  }

  protected isSchemaNode(value: unknown): boolean {
    return !!value && typeof value === "object";
  }

  protected isUnion(schema: JsonSchema): boolean {
    return Array.isArray(schema?.anyOf) || Array.isArray(schema?.oneOf);
  }

  protected isNull(schema: JsonSchema): boolean {
    return schema?.type === "null";
  }

  protected isString(schema: JsonSchema): boolean {
    return schema?.type === "string";
  }

  protected isNumber(schema: JsonSchema): boolean {
    return schema?.type === "number";
  }

  protected isInteger(schema: JsonSchema): boolean {
    return schema?.type === "integer";
  }

  protected isBigInt(schema: JsonSchema): boolean {
    return schema?.format === "bigint";
  }

  protected isBoolean(schema: JsonSchema): boolean {
    return schema?.type === "boolean";
  }

  /**
   * Check if a schema is an enum type.
   */
  protected isEnum(schema: JsonSchema): boolean {
    return Array.isArray(schema?.enum);
  }

  /**
   * The first member of a union that is not `null` — i.e. the payload type of a
   * nullable field, which proto3 represents with its type default.
   */
  protected getNonNullMember(schema: JsonSchema): JsonSchema | undefined {
    const members = (schema.anyOf ?? schema.oneOf ?? []) as JsonSchema[];
    return members.find((member) => !this.isNull(member));
  }

  /**
   * The value schema of a record, from either spelling.
   */
  protected getRecordValueSchema(schema: JsonSchema): JsonSchema | undefined {
    if (this.isSchemaNode(schema.additionalProperties)) {
      return schema.additionalProperties as JsonSchema;
    }

    if (this.isSchemaNode(schema.patternProperties)) {
      const patterns = Object.values(
        schema.patternProperties as Record<string, unknown>,
      );
      if (patterns.length > 0 && this.isSchemaNode(patterns[0])) {
        return patterns[0] as JsonSchema;
      }
    }

    return undefined;
  }

  /**
   * Extract enum values from an enum schema.
   */
  protected getEnumValues(schema: JsonSchema): string[] {
    return Array.isArray(schema.enum) ? schema.enum.map(String) : [];
  }

  /**
   * Register an enum and return its type name.
   * Generates a PascalCase name from the field name.
   */
  protected registerEnum(
    fieldName: string,
    values: string[],
    enumDefinitions: Map<string, string[]>,
  ): string {
    const enumName = fieldName.charAt(0).toUpperCase() + fieldName.slice(1);

    // Reuse an identical enum rather than emitting a duplicate definition.
    const valueKey = values.join(",");
    const existingEnum = Array.from(enumDefinitions.entries()).find(
      ([, enumValues]) => enumValues.join(",") === valueKey,
    );

    if (existingEnum) {
      return existingEnum[0];
    }

    // Two fields named alike with different members used to share one
    // definition: the second silently overwrote the first.
    let uniqueName = enumName;
    for (let n = 2; enumDefinitions.has(uniqueName); n++) {
      uniqueName = `${enumName}${n}`;
    }

    enumDefinitions.set(uniqueName, values);
    return uniqueName;
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

/**
 * A JSON Schema node, as produced by `z.toJSONSchema()`. Deliberately loose:
 * this walker reads a handful of well-known keywords and ignores the rest.
 */
export type JsonSchema = Record<string, any>;

export interface CreateProtobufSchemaOptions {
  rootName?: string;
  mainMessageName?: string;
}
