import type { Infer, ZType } from "./ZodProvider.ts";

export abstract class SchemaCodec {
  /**
   * Encode the value to a string format.
   */
  public abstract encodeToString<T extends ZType>(
    schema: T,
    value: Infer<T>,
  ): string;

  /**
   * Encode the value to a binary format.
   */
  public abstract encodeToBinary<T extends ZType>(
    schema: T,
    value: Infer<T>,
  ): Uint8Array;

  /**
   * Decode string, binary, or other formats to the schema type.
   */
  public abstract decode<T>(schema: ZType, value: unknown): T;
}
