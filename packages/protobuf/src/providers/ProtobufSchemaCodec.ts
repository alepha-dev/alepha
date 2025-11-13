import {
  $inject,
  AlephaError,
  SchemaCodec,
  type Static,
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

  public encodeToString<T extends TSchema>(
    schema: T,
    value: Static<T>,
  ): string {
    const binary = this.encodeToBinary(schema, value);
    // convert binary to base64 string for text representation
    if (typeof Buffer !== "undefined") {
      return Buffer.from(binary).toString("base64");
    } else {
      return btoa(String.fromCharCode(...binary));
    }
  }

  public encodeToBinary<T extends TSchema>(
    schema: T,
    value: Static<T>,
  ): Uint8Array {
    const proto = this.protobufProvider.createProtobufSchema(schema);
    return this.protobufProvider.encode(proto, value);
  }

  public decode<T>(schema: TSchema, value: unknown): T {
    // First decode from protobuf binary to object
    const proto = this.protobufProvider.createProtobufSchema(schema);

    if (value instanceof Uint8Array) {
      return this.applyProto3Defaults(
        schema,
        this.protobufProvider.decode(proto, value),
      );
    }

    if (typeof value === "string") {
      return this.applyProto3Defaults(
        schema,
        this.protobufProvider.decode(
          proto,
          typeof Buffer !== "undefined"
            ? Uint8Array.from(Buffer.from(value, "base64"))
            : Uint8Array.from(
                atob(value)
                  .split("")
                  .map((c) => c.charCodeAt(0)),
              ),
        ),
      );
    }

    throw new AlephaError(
      `Unsupported value type for Protobuf decoding: ${typeof value}`,
    );
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
}
