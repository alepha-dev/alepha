import {
  $inject,
  AlephaError,
  type Infer,
  SchemaCodec,
  type ZType,
} from "alepha";

import { type JsonSchema, ProtobufProvider } from "./ProtobufProvider.ts";

/**
 * ProtobufSchemaCodec handles encoding/decoding for Protobuf format.
 *
 * Key differences from the JSON codec:
 * - Binary data (Uint8Array) is kept as-is
 * - Text output is base64, since protobuf is not text-safe
 * - Proto3 default values are applied when decoding (to handle omitted fields)
 */
export class ProtobufSchemaCodec extends SchemaCodec {
  protected protobufProvider = $inject(ProtobufProvider);

  public encodeToString<T extends ZType>(schema: T, value: Infer<T>): string {
    const binary = this.encodeToBinary(schema, value);
    // convert binary to base64 string for text representation
    if (typeof Buffer !== "undefined") {
      return Buffer.from(binary).toString("base64");
    }
    return btoa(String.fromCharCode(...binary));
  }

  public encodeToBinary<T extends ZType>(
    schema: T,
    value: Infer<T>,
  ): Uint8Array {
    const proto = this.protobufProvider.createProtobufSchema(schema);
    return this.protobufProvider.encode(proto, value);
  }

  public decode<T>(schema: ZType, value: unknown): T {
    const proto = this.protobufProvider.createProtobufSchema(schema);
    const json = this.protobufProvider.toJsonSchema(schema);

    if (value instanceof Uint8Array) {
      return this.applyProto3Defaults(
        json,
        this.protobufProvider.decode(proto, value),
      );
    }

    if (typeof value === "string") {
      return this.applyProto3Defaults(
        json,
        this.protobufProvider.decode(proto, this.fromBase64(value)),
      );
    }

    throw new AlephaError(
      `Unsupported value type for Protobuf decoding: ${typeof value}`,
    );
  }

  protected fromBase64(value: string): Uint8Array {
    if (typeof Buffer !== "undefined") {
      return Uint8Array.from(Buffer.from(value, "base64"));
    }
    return Uint8Array.from(
      atob(value)
        .split("")
        .map((c) => c.charCodeAt(0)),
    );
  }

  /**
   * Apply proto3 default values for fields that were omitted during encoding.
   * Proto3 omits fields holding their type default, so decoding has to put them
   * back or the value fails validation against a schema that requires them.
   * Also converts enum integers back to their string values.
   */
  protected applyProto3Defaults(schema: JsonSchema, value: any): any {
    // An enum at any position (a scalar, an array item, a nullable member)
    // comes back as its wire number; only object properties used to be
    // converted, so `z.array(z.enum(...))` failed validation after decode.
    if (this.isEnum(schema)) {
      return this.convertEnumValue(schema, value);
    }
    // Before the object guard below, so an int64 inside an array is converted
    // too — `applyProto3Defaults(schema.items, item)` is how array elements
    // arrive here, and a scalar element would otherwise fall straight through.
    if (this.isInteger(schema)) {
      return this.toSafeInteger(schema, value);
    }
    if (this.isUnion(schema)) {
      const member = this.getNonNullMember(schema);
      if (member) {
        return this.applyProto3Defaults(member, value);
      }
    }

    if (!value || typeof value !== "object") {
      return value;
    }

    if (this.isObject(schema)) {
      const result: any = { ...value };

      for (const [key, raw] of Object.entries(schema.properties ?? {})) {
        const propSchema = raw as JsonSchema;

        if (!(key in result) || result[key] === undefined) {
          result[key] = this.getProto3Default(propSchema);
          continue;
        }

        // Unconditional recursion: every per-kind branch that used to live
        // here is the first thing `applyProto3Defaults` does, and gating on
        // `typeof === "object"` meant a SCALAR needing conversion was skipped
        // whenever its schema was not one of the two spelled out here. That is
        // how `z.integer().nullable()` slipped through — a union, so neither
        // the enum branch nor the object branch, and its decoded int64 string
        // reached validation as a string.
        result[key] = this.applyProto3Defaults(propSchema, result[key]);
      }

      return result;
    }

    if (this.isArray(schema) && Array.isArray(value)) {
      return value.map((item) => this.applyProto3Defaults(schema.items, item));
    }

    return value;
  }

  protected isObject(schema: JsonSchema): boolean {
    return schema?.type === "object" && !!schema.properties;
  }

  protected isArray(schema: JsonSchema): boolean {
    return schema?.type === "array";
  }

  protected isEnum(schema: JsonSchema): boolean {
    return Array.isArray(schema?.enum);
  }

  /**
   * Turn an int64 field back into the number its schema declares.
   *
   * `decode()` passes `longs: String` so 64-bit fields survive as decimal
   * strings — which is what `z.bigint()` wants, and exactly what a
   * `z.integer()` field does not: the schema says `type: "integer"`, so a
   * string fails validation on the way back in.
   *
   * A value that cannot be a JS number is refused rather than rounded. Losing
   * the low bits of an id while reporting success is the failure this whole
   * change exists to stop, and returning it as a `bigint` instead would fail
   * the same validation for the same reason.
   */
  protected toSafeInteger(
    schema: JsonSchema,
    value: unknown,
    field?: string,
  ): unknown {
    // `z.bigint()` is carried as a string ON PURPOSE — it is declared
    // `type: "string", format: "bigint"`, so it never reaches here, but the
    // guard keeps that true if the mapping ever changes.
    if (typeof value !== "string" || schema.format === "bigint") {
      return value;
    }

    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed)) {
      throw new AlephaError(
        `Protobuf field ${field ? `'${field}' ` : ""}decoded to ${value}, which is outside the safe integer range. Declare it as z.bigint() to carry it exactly.`,
      );
    }

    return parsed;
  }

  protected isUnion(schema: JsonSchema): boolean {
    return Array.isArray(schema?.anyOf) || Array.isArray(schema?.oneOf);
  }

  protected isRecord(schema: JsonSchema): boolean {
    return (
      schema?.type === "object" &&
      !schema.properties &&
      !!schema.additionalProperties &&
      typeof schema.additionalProperties === "object"
    );
  }

  /**
   * Convert an enum value from its protobuf integer back to the string member.
   */
  protected convertEnumValue(schema: JsonSchema, value: any): any {
    if (typeof value === "number" && Array.isArray(schema.enum)) {
      return schema.enum[value];
    }
    return value;
  }

  /**
   * Get the proto3 default value for a schema node.
   */
  protected getProto3Default(schema: JsonSchema): any {
    // Enums default to their zero value — the first member — and the wire
    // format omits it. Returning "" here (an enum is carried as a string) would
    // hand back a value the schema rejects.
    if (this.isEnum(schema)) {
      return this.getEnumDefault(schema);
    }

    // proto3 has no null: a nullable field was written as its base type, so it
    // decodes to that type's default. Returning undefined instead would drop a
    // field the schema still requires — nullable is not optional.
    if (this.isUnion(schema)) {
      const nonNull = this.getNonNullMember(schema);
      return nonNull ? this.getProto3Default(nonNull) : undefined;
    }

    if (this.isArray(schema)) {
      return [];
    }

    if (this.isRecord(schema)) {
      return {};
    }

    // Before the string branch: bigint rides on a string schema.
    if (schema?.format === "bigint") return "0";

    if (this.isString(schema)) return "";
    if (this.isNumber(schema)) return 0;
    if (this.isInteger(schema)) return 0;
    if (this.isBoolean(schema)) return false;

    if (this.isObject(schema)) {
      return {};
    }

    return undefined;
  }

  protected getEnumDefault(schema: JsonSchema): any {
    return Array.isArray(schema.enum) ? schema.enum[0] : undefined;
  }

  /**
   * The first member of a union that is not `null`.
   */
  protected getNonNullMember(schema: JsonSchema): JsonSchema | undefined {
    const members = (schema.anyOf ?? schema.oneOf ?? []) as JsonSchema[];
    return members.find((member) => member?.type !== "null");
  }

  protected isString(schema: JsonSchema): boolean {
    return schema?.type === "string";
  }

  protected isNumber(schema: JsonSchema): boolean {
    return schema?.type === "number";
  }

  protected isInteger(schema: JsonSchema): boolean {
    return schema?.type === "integer";
  }

  protected isBoolean(schema: JsonSchema): boolean {
    return schema?.type === "boolean";
  }
}
