import { AlephaError } from "../errors/AlephaError.ts";
import { $inject } from "../primitives/$inject.ts";
import { JsonSchemaCodec } from "./JsonSchemaCodec.ts";
import type { SchemaCodec } from "./SchemaCodec.ts";
import { SchemaValidator } from "./SchemaValidator.ts";
import type { Infer, ZType } from "./ZodProvider.ts";

export type Encoding = "object" | "string" | "binary";

export interface EncodeOptions<T extends Encoding = Encoding> {
  /**
   * The output encoding format:
   * - 'object': Returns the validated value as-is
   * - 'string': Returns JSON string
   * - 'binary': Returns Uint8Array (for protobuf, msgpack, etc.)
   *
   * @default "object"
   */
  as?: T;

  /**
   * The encoder to use (e.g., 'json', 'protobuf', 'msgpack')
   *
   * @default "json"
   */
  encoder?: string;

  /**
   * Set to `false` to skip schema validation before encoding.
   */
  validation?: false;
}

export type EncodeResult<
  T extends ZType,
  E extends Encoding,
> = E extends "string" ? string : E extends "binary" ? Uint8Array : Infer<T>;

export interface DecodeOptions {
  /**
   * The encoder to use (e.g., 'json', 'protobuf', 'msgpack')
   *
   * @default "json"
   */
  encoder?: string;

  /**
   * Set to `false` to skip schema validation after decoding.
   */
  validation?: false;
}

/**
 * CodecManager manages multiple codec formats and provides a unified interface
 * for encoding and decoding data with different formats.
 */
export class CodecManager {
  protected readonly codecs: Map<string, SchemaCodec> = new Map();
  protected readonly jsonCodec = $inject(JsonSchemaCodec);
  protected readonly schemaValidator = $inject(SchemaValidator);

  public default = "json";

  constructor() {
    // Register default JSON codec
    this.register({
      name: "json",
      codec: this.jsonCodec,
      default: true,
    });
  }

  /**
   * Register a new codec format.
   */
  public register(opts: CodecRegisterOptions): void {
    this.codecs.set(opts.name, opts.codec);
    if (opts.default) {
      this.default = opts.name;
    }
  }

  /**
   * Get a specific codec by name.
   *
   * @param name - The name of the codec
   * @returns The codec instance
   * @throws {AlephaError} If the codec is not found
   */
  public getCodec(name: string): SchemaCodec {
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
  public encode<T extends ZType, E extends Encoding = "object">(
    schema: T,
    value: unknown,
    options?: EncodeOptions<E>,
  ): EncodeResult<T, E> {
    const codec = this.getCodec(options?.encoder ?? this.default);
    const as = options?.as ?? "object";

    if (options?.validation !== false) {
      value = this.schemaValidator.validate(schema, value);
    }

    if (as === "object") {
      // Return the validated object as-is
      return value as EncodeResult<T, E>;
    }

    if (as === "binary") {
      // not used by JSON, but for other codecs like Protobuf, MsgPack, etc.
      return codec.encodeToBinary(schema, value as Infer<T>) as EncodeResult<
        T,
        E
      >;
    }

    // encode directly to string
    return codec.encodeToString(schema, value as Infer<T>) as EncodeResult<
      T,
      E
    >;
  }

  /**
   * Decode data using the specified codec.
   */
  public decode<T extends ZType>(
    schema: T,
    data: any,
    options?: DecodeOptions,
  ): Infer<T> {
    const encoderName = options?.encoder ?? this.default;
    const codec = this.getCodec(encoderName);
    let value = codec.decode(schema, data);

    if (options?.validation !== false) {
      value = this.schemaValidator.validate(schema, value);
    }

    return value as Infer<T>;
  }

  /**
   * Validate decoded data against the schema.
   *
   * This is automatically called before encoding or after decoding.
   */
  public validate<T extends ZType>(schema: T, value: unknown): Infer<T> {
    return this.schemaValidator.validate(schema, value);
  }
}

// ---------------------------------------------------------------------------------------------------------------------

export interface CodecRegisterOptions {
  name: string;
  codec: SchemaCodec;
  default?: boolean;
}
