import type { StaticDecode, StaticEncode, TSchema } from "typebox";
import { $inject } from "../descriptors/$inject.ts";
import { AlephaError } from "../errors/AlephaError.ts";
import { JsonSchemaCodec } from "./JsonSchemaCodec.ts";
import type { SchemaCodec } from "./SchemaCodec.ts";

export interface EncodeOptions {
  /**
   * The output encoding format:
   * - 'raw': Returns native types (objects, BigInt, Date, etc.)
   * - 'string': Returns JSON string
   * - 'binary': Returns Uint8Array (for protobuf, msgpack, etc.)
   */
  encoding?: "raw" | "string" | "binary";
  /**
   * The encoder to use (e.g., 'json', 'protobuf', 'msgpack')
   * Defaults to 'json'
   */
  encoder?: string;
}

export interface DecodeOptions {
  /**
   * The encoder to use (e.g., 'json', 'protobuf', 'msgpack')
   * Defaults to 'json'
   */
  encoder?: string;
}

/**
 * CodecManager manages multiple codec formats and provides a unified interface
 * for encoding and decoding data with different formats.
 */
export class CodecManager {
  protected readonly codecs: Map<string, SchemaCodec> = new Map();
  protected readonly jsonCodec = $inject(JsonSchemaCodec);

  public default = "json";

  constructor() {
    // Register default JSON codec
    this.register(this.default, this.jsonCodec);
  }

  /**
   * Register a new codec format.
   * @param name - The name of the codec (e.g., 'json', 'protobuf')
   * @param codec - The codec implementation
   */
  public register(name: string, codec: SchemaCodec): void {
    this.codecs.set(name, codec);
  }

  /**
   * Get a specific codec by name.
   * @param name - The name of the codec
   * @returns The codec instance
   * @throws {AlephaError} If the codec is not found
   */
  public codec(name: string): SchemaCodec {
    const codec = this.codecs.get(name);
    if (!codec) {
      throw new AlephaError(
        `Codec "${name}" not found. Available codecs: ${Array.from(this.codecs.keys()).join(", ")}`,
      );
    }
    return codec;
  }

  /**
   * Encode data using the specified codec and encoding format.
   * @param schema - The TypeBox schema
   * @param value - The value to encode
   * @param options - Encoding options
   * @returns The encoded value
   */
  public encode<T extends TSchema>(
    schema: T,
    value: any,
    options?: EncodeOptions,
  ): StaticEncode<T> | string | Uint8Array {
    const encoderName = options?.encoder ?? this.default;
    const encoding = options?.encoding ?? "raw";
    const codec = this.codec(encoderName);

    const encoded = codec.encode(schema, value);

    // Handle encoding format
    if (encoding === "string") {
      return codec.encodeToString(schema, value);
    }

    if (encoding === "binary") {
      // For binary encoding, the codec should return Uint8Array
      // This is handled by specific codecs like ProtobufCodec
      return codec.encodeToBinary(schema, value);
    }

    // Default: raw encoding
    return encoded;
  }

  /**
   * Decode data using the specified codec.
   * @param schema - The TypeBox schema
   * @param value - The value to decode
   * @param options - Decoding options
   * @returns The decoded value
   */
  public decode<T extends TSchema>(
    schema: T,
    value: any,
    options?: DecodeOptions,
  ): StaticDecode<T> {
    const encoderName = options?.encoder ?? this.default;
    const codec = this.codec(encoderName);
    return codec.decode(schema, value);
  }
}
