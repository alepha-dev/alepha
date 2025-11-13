import type { Static, TSchema } from "./TypeProvider.ts";

export abstract class SchemaCodec {
  /**
   * Encode the value to a string format.
   */
  public abstract encodeToString<T extends TSchema>(
    schema: T,
    value: Static<T>,
  ): string;

  /**
   * Encode the value to a binary format.
   */
  public abstract encodeToBinary<T extends TSchema>(
    schema: T,
    value: Static<T>,
  ): Uint8Array;

  /**
   * Decode string, binary, or other formats to the schema type.
   */
  public abstract decode<T>(schema: TSchema, value: unknown): T;
}
