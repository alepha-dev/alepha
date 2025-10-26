import { $inject, SchemaCodec, type TSchema, t } from "@alepha/core";
import "@alepha/datetime";
import { ProtobufProvider } from "./ProtobufProvider.ts";

/**
 * ProtobufSchemaCodec handles encoding/decoding for Protobuf format.
 *
 * Key differences from JSON codec:
 * - BigInt values are kept as BigInt (not converted to string)
 * - Date values are converted to ISO strings for protobuf compatibility
 * - Binary data (Uint8Array) is kept as-is
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
