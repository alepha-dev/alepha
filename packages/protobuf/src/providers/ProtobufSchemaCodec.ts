import { SchemaCodec, t, type TSchema } from "@alepha/core";
import type { Type as TypeBoxType } from "typebox";

/**
 * ProtobufSchemaCodec handles encoding/decoding for Protobuf format.
 *
 * Key differences from JSON codec:
 * - BigInt values are kept as BigInt (not converted to string)
 * - Date values are converted to ISO strings for protobuf compatibility
 * - Binary data (Uint8Array) is kept as-is
 */
export class ProtobufSchemaCodec extends SchemaCodec {
  public encodeToString(schema: TSchema, value: any): string {
    throw new Error(
      "ProtobufSchemaCodec does not support string encoding. Use binary encoding instead.",
    );
  }

  /**
   * Transform types for Protobuf compatibility.
   * This method is called for each type in the schema tree.
   */
  protected transformType(schema: TSchema): TSchema | undefined {
    // For bigint: keep as-is, don't convert to string
    // The schema is still a string type with format "int64", but we override encode/decode
    if (t.schema.isBigInt(schema)) {
      return t
        .codec(schema)
        .Decode((value: bigint | number | string) => {
          // From protobuf, we might get a number or bigint
          if (typeof value === "bigint") return value;
          if (typeof value === "number") return BigInt(value);
          if (typeof value === "string") return BigInt(value);
          return value;
        })
        .Encode((value: bigint) => {
          // To protobuf, keep as bigint (protobufjs handles it)
          return value;
        }) as TSchema;
    }

    // For datetime: convert Date to ISO string for protobuf
    if (t.schema.isDatetime(schema)) {
      return t
        .codec(schema)
        .Decode((value: string | Date) => {
          // From protobuf, we get a string
          if (typeof value === "string") return new Date(value);
          return value;
        })
        .Encode((value: Date | string) => {
          // To protobuf, convert Date to ISO string
          if (value instanceof Date) return value.toISOString();
          return value;
        }) as TSchema;
    }

    // For date: convert Date to date string (YYYY-MM-DD) for protobuf
    if (t.schema.isDate(schema)) {
      return t
        .codec(schema)
        .Decode((value: string | Date) => {
          // From protobuf, we get a string
          if (typeof value === "string") return new Date(value);
          return value;
        })
        .Encode((value: Date | string) => {
          // To protobuf, convert Date to YYYY-MM-DD string
          if (value instanceof Date) {
            return value.toISOString().split("T")[0];
          }
          return value;
        }) as TSchema;
    }

    // For URL: convert URL to string for protobuf
    if (
      t.schema.isString(schema) &&
      "format" in schema &&
      schema.format === "uri"
    ) {
      return t
        .codec(schema)
        .Decode((value: string | URL) => {
          // From protobuf, we get a string
          if (typeof value === "string") return new URL(value);
          return value;
        })
        .Encode((value: URL | string) => {
          // To protobuf, convert URL to string
          if (value instanceof URL) return value.toString();
          return value;
        }) as TSchema;
    }

    // Binary data (Uint8Array) is kept as-is (protobuf supports it natively)
    // No transformation needed

    // For other types, use default behavior
    return undefined;
  }
}
