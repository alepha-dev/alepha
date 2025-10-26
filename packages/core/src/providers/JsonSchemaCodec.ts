import type { StaticDecode, TSchema } from "typebox";
import { $inject } from "../descriptors/$inject.ts";
import { Json } from "./Json.ts";
import { SchemaCodec } from "./SchemaCodec.ts";
import { t } from "./TypeProvider.ts";

export class JsonSchemaCodec extends SchemaCodec {
  protected readonly json = $inject(Json);
  protected readonly encoder = new TextEncoder();
  protected readonly decoder = new TextDecoder();

  protected transformType = undefined;

  public encodeToString(schema: TSchema, value: any): string {
    return this.json.stringify(this.encode(schema, value));
  }

  public encodeToBinary(schema: TSchema, value: any): Uint8Array {
    const jsonString = this.encodeToString(schema, value);
    return this.encoder.encode(jsonString);
  }

  public decode<T extends TSchema>(schema: T, value: any): StaticDecode<T> {
    if (value instanceof Uint8Array) {
      value = this.json.parse(this.decoder.decode(value));
    } else if (typeof value === "string" && !t.schema.isString(schema)) {
      value = this.json.parse(value);
    }

    return super.decode(schema, value);
  }
}
