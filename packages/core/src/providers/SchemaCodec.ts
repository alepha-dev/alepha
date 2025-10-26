import type { Static, StaticDecode, StaticEncode, TSchema } from "typebox";
import { Compile, type Validator } from "typebox/compile";
import { TypeBoxError } from "../errors/TypeBoxError.ts";
import { TypeGuard } from "./TypeProvider.ts";

export abstract class SchemaCodec {
  protected cache: Map<TSchema, Validator> = new Map();
  protected guard = new TypeGuard();

  // -------------------------------------------------------------------------------------------------------------------

  /**
   * Encode the value to a string format.
   */
  public abstract encodeToString(schema: TSchema, value: any): string;

  /**
   * Encode the value to a binary format.
   */
  public abstract encodeToBinary(schema: TSchema, value: any): Uint8Array;

  /**
   * Transform a specific type for this codec.
   * Return undefined to use the default schema, or return a new schema to replace it.
   *
   * Override this method to customize how specific types are handled in this codec.
   * For example, a ProtobufCodec might keep BigInt as-is instead of converting to string.
   */
  protected abstract transformType(schema: TSchema): TSchema | false | void;

  // -------------------------------------------------------------------------------------------------------------------

  public encode<T extends TSchema>(schema: T, value: any): StaticEncode<T> {
    try {
      return this.validator(schema).Encode(value);
    } catch (error: any) {
      if (error.cause?.errors?.[0]) {
        throw new TypeBoxError(error.cause.errors[0]);
      }
      throw error;
    }
  }

  public decode<T extends TSchema>(schema: T, value: any): StaticDecode<T> {
    const newValue = this.preprocess(schema, value);

    try {
      return this.validator(schema).Decode(newValue) as Static<T>;
    } catch (error: any) {
      if (error.cause?.errors?.[0]) {
        throw new TypeBoxError(error.cause.errors[0]);
      }
      throw error;
    }
  }

  protected validator<T extends TSchema>(schema: T): Validator<{}, T> {
    if (this.cache.has(schema)) {
      return this.cache.get(schema) as Validator<{}, T>;
    }

    const validator = Compile(this.transformSchema(schema));
    this.cache.set(schema, validator);
    return validator as Validator<{}, T>;
  }

  // -------------------------------------------------------------------------------------------------------------------

  /**
   * Transform the schema for this codec.
   * Override this method to provide custom schema transformations.
   * This method should recursively transform all nested schemas.
   */
  protected transformSchema<T extends TSchema>(schema: T): TSchema {
    // First, allow codec-specific type transformation
    const customType = this.transformType(schema);
    if (customType === false) {
      return schema;
    }

    if (customType) {
      return customType;
    }

    // Then recursively transform nested structures
    if ("properties" in schema && schema.properties) {
      const properties: Record<string, TSchema> = {};
      for (const [key, value] of Object.entries(schema.properties)) {
        properties[key] = this.transformSchema(value as TSchema);
      }
      return { ...schema, properties } as TSchema;
    }

    if ("items" in schema && schema.items) {
      return {
        ...schema,
        items: this.transformSchema(schema.items as TSchema),
      } as TSchema;
    }

    if ("anyOf" in schema && Array.isArray(schema.anyOf)) {
      return {
        ...schema,
        anyOf: schema.anyOf.map((s) => this.transformSchema(s as TSchema)),
      } as TSchema;
    }

    if ("allOf" in schema && Array.isArray(schema.allOf)) {
      return {
        ...schema,
        allOf: schema.allOf.map((s) => this.transformSchema(s as TSchema)),
      } as TSchema;
    }

    if ("oneOf" in schema && Array.isArray(schema.oneOf)) {
      return {
        ...schema,
        oneOf: schema.oneOf.map((s) => this.transformSchema(s as TSchema)),
      } as TSchema;
    }

    // Handle records (additionalProperties)
    if ("additionalProperties" in schema && schema.additionalProperties) {
      return {
        ...schema,
        additionalProperties: this.transformSchema(
          schema.additionalProperties as TSchema,
        ),
      } as TSchema;
    }

    // Handle tuples
    if (
      Array.isArray(schema) ||
      ("prefixItems" in schema && Array.isArray(schema.prefixItems))
    ) {
      const items = Array.isArray(schema)
        ? schema
        : (schema.prefixItems as TSchema[]);
      return {
        ...schema,
        prefixItems: items.map((s) => this.transformSchema(s as TSchema)),
      } as TSchema;
    }

    return schema;
  }

  /**
   * Preprocess the value based on the schema before validation.
   *
   * - If the value is `null` and the schema does not allow `null`, it converts it to `undefined`.
   * - If the value is a string and the schema has a `~options.trim` flag, it trims whitespace from the string.
   */
  public preprocess = (schema: any, value: any): any => {
    if (!schema) {
      return value;
    }

    if (value === null && !this.isSchemaNullable(schema)) {
      return undefined;
    }

    if (Array.isArray(value)) {
      return value.map((it) => this.preprocess(schema.items, it));
    }

    if (
      typeof value === "string" &&
      schema.type === "string" &&
      schema["~options"]?.trim
    ) {
      return String(value).trim();
    }

    if (typeof value === "object" && value !== null) {
      const obj: any = {};

      for (const key in value) {
        const newValue = this.preprocess(schema.properties?.[key], value[key]);

        if (newValue !== undefined) {
          obj[key] = newValue;
        }
      }

      return obj;
    }

    return value;
  };

  /**
   * Used by `preprocess` to determine if a schema allows null values.
   */
  protected isSchemaNullable = (schema: any): boolean => {
    if (!schema) return false;
    if (schema.type === "null") return true;
    if (Array.isArray(schema.type) && schema.type.includes("null")) return true;
    if (schema.anyOf) {
      return schema.anyOf.some((it: any) => this.isSchemaNullable(it));
    }
    if (schema.oneOf) {
      return schema.oneOf.some((it: any) => this.isSchemaNullable(it));
    }
    if (schema.allOf) {
      return schema.allOf.some((it: any) => this.isSchemaNullable(it));
    }
    return false;
  };
}
