import {
  $inject,
  SchemaCodec,
  type StaticDecode,
  type TSchema,
  t,
} from "@alepha/core";
import "@alepha/datetime";
import { ProtobufProvider } from "./ProtobufProvider.ts";

/**
 * ProtobufSchemaCodec handles encoding/decoding for Protobuf format.
 *
 * Key differences from JSON codec:
 * - BigInt values are kept as BigInt (not converted to string)
 * - Date values are converted to ISO strings for protobuf compatibility
 * - Binary data (Uint8Array) is kept as-is
 * - Proto3 default values are applied when decoding (to handle omitted fields)
 */
export class ProtobufSchemaCodec extends SchemaCodec {
  protected protobufProvider = $inject(ProtobufProvider);
  protected decoder = new TextDecoder();

  public encodeToString(schema: TSchema, value: any): string {
    const binary = this.encodeToBinary(schema, value);
    return this.decoder.decode(binary);
  }

  public encodeToBinary(schema: TSchema, value: any): Uint8Array {
    const proto = this.protobufProvider.createProtobufSchema(schema);
    return this.protobufProvider.encode(proto, this.encode(schema, value));
  }

  public decode<T extends TSchema>(schema: T, value: any): StaticDecode<T> {
    // First decode from protobuf binary to object
    const proto = this.protobufProvider.createProtobufSchema(schema);
    const decoded = this.protobufProvider.decode(proto, value);

    // Apply proto3 default values for missing fields
    const withDefaults = this.applyProto3Defaults(schema, decoded);

    // Then use the parent decode to validate and transform
    return super.decode(schema, withDefaults);
  }

  /**
   * Apply proto3 default values for fields that were omitted during encoding.
   * Proto3 omits fields with default values, so we need to restore them.
   * Also converts enum integers back to their string values.
   */
  protected applyProto3Defaults(schema: TSchema, value: any): any {
    if (!value || typeof value !== "object") {
      return value;
    }

    if (t.schema.isObject(schema)) {
      const result: any = { ...value };

      for (const [key, propSchema] of Object.entries(schema.properties)) {
        if (!(key in result) || result[key] === undefined) {
          // Apply proto3 default values based on type
          result[key] = this.getProto3Default(propSchema);
        } else {
          // Convert enum integers to strings
          if (this.isEnum(propSchema)) {
            result[key] = this.convertEnumValue(propSchema, result[key]);
          } else if (typeof result[key] === "object" && result[key] !== null) {
            // Recursively apply defaults to nested objects
            result[key] = this.applyProto3Defaults(propSchema, result[key]);
          }
        }
      }

      return result;
    }

    if (t.schema.isArray(schema) && Array.isArray(value)) {
      return value.map((item) => this.applyProto3Defaults(schema.items, item));
    }

    return value;
  }

  /**
   * Check if a schema is an enum type.
   */
  protected isEnum(schema: TSchema): boolean {
    return "enum" in schema && Array.isArray(schema.enum);
  }

  /**
   * Convert an enum value from protobuf integer to TypeBox string.
   */
  protected convertEnumValue(schema: TSchema, value: any): any {
    if (
      typeof value === "number" &&
      "enum" in schema &&
      Array.isArray(schema.enum)
    ) {
      // Protobuf encodes enums as integers, convert back to string
      return schema.enum[value];
    }
    return value;
  }

  /**
   * Get the proto3 default value for a schema type.
   */
  protected getProto3Default(schema: TSchema): any {
    // Handle nullable/optional types - they can be undefined
    if (t.schema.isOptional(schema) || t.schema.isUnion(schema)) {
      return undefined;
    }

    // Handle arrays - default is empty array
    if (t.schema.isArray(schema)) {
      return [];
    }

    // Handle records (maps) - default is empty object
    if (t.schema.isRecord(schema)) {
      return {};
    }

    // Handle primitive types
    if (t.schema.isString(schema)) return "";
    if (t.schema.isNumber(schema)) return 0;
    if (t.schema.isInteger(schema)) return 0;
    if (t.schema.isBigInt(schema)) return BigInt(0);
    if (t.schema.isBoolean(schema)) return false;

    // For objects, return empty object (will be filled in recursively)
    if (t.schema.isObject(schema)) {
      return {};
    }

    return undefined;
  }

  /**
   * Transform types for Protobuf compatibility.
   * This method is called for each type in the schema tree.
   */
  protected transformType(schema: TSchema): TSchema | undefined {
    // For bigint: keep as-is, don't convert to string
    // The schema is still a string type with format "int64", but we override encode/decode
    if (t.schema.isBigInt(schema)) {
      return t.bigint();
    }

    // For other types, use default behavior
    return undefined;
  }
}
