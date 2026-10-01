import { $inject } from "../primitives/$inject.ts";
import { Json } from "./Json.ts";
import { SchemaCodec } from "./SchemaCodec.ts";
import type { Infer, ZType } from "./ZodProvider.ts";

export class JsonSchemaCodec extends SchemaCodec {
  protected readonly json = $inject(Json);
  protected readonly encoder = new TextEncoder();
  protected readonly decoder = new TextDecoder();

  public encodeToString<T extends ZType>(schema: T, value: Infer<T>): string {
    return this.json.stringify(value);
  }

  public encodeToBinary<T extends ZType>(
    schema: T,
    value: Infer<T>,
  ): Uint8Array {
    return this.encoder.encode(this.encodeToString(schema, value));
  }

  public decode<T>(schema: ZType, value: unknown): T {
    if (value instanceof Uint8Array) {
      const text = this.decoder.decode(value);
      return this.json.parse(text);
    }

    if (typeof value === "string") {
      // Only parse if it looks like JSON (starts with { or [)
      const trimmed = value.trim();
      if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
        return this.json.parse(value);
      }
      // Return plain strings as-is
      return value as T;
    }

    return value as T;
  }
}
