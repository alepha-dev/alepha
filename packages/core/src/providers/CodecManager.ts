import type { StaticDecode, StaticEncode, TSchema } from "typebox";
import { $inject } from "../descriptors/$inject.ts";
import { AlephaError } from "../errors/AlephaError.ts";
import { JsonSchemaCodec } from "./JsonSchemaCodec.ts";
import type { SchemaCodec } from "./SchemaCodec.ts";

export type Encoding = "object" | "string" | "binary";
export interface EncodeOptions<T extends Encoding = Encoding> {
  /**
   * The output encoding format:
   * - 'object': Returns native types (objects, BigInt, Date, etc.)
   * - 'string': Returns JSON string
   * - 'binary': Returns Uint8Array (for protobuf, msgpack, etc.)
   */
  as?: T;
  /**
   * The encoder to use (e.g., 'json', 'protobuf', 'msgpack')
   * Defaults to 'json'
   */
  encoder?: string;
}
export type EncodeResult<
  T extends TSchema,
  E extends Encoding,
> = E extends "string"
  ? string
  : E extends "binary"
    ? Uint8Array
    : StaticEncode<T>;

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
   * Encode data using the specified codec and output format.
   */
  public encode<T extends TSchema, E extends Encoding = "object">(
    schema: T,
    value: any,
    options?: EncodeOptions<E>,
  ): EncodeResult<T, E> {
    const encoderName = options?.encoder ?? this.default;
    const as = options?.as ?? "object";
    const codec = this.codec(encoderName);

    if (as === "string") {
      // encode directly to string
      return codec.encodeToString(schema, value) as EncodeResult<T, E>;
    }

    if (as === "binary") {
      // not used by JSON, but for other codecs like Protobuf, MsgPack, etc.
      return codec.encodeToBinary(schema, value) as EncodeResult<T, E>;
    }

    // or nothing object encoding
    return codec.encode(schema, value) as EncodeResult<T, E>;
  }

  /**
   * Decode data using the specified codec.
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
