import type { TSchema } from "typebox";
import { Compile, type Validator } from "typebox/compile";
import { TypeBoxError } from "../errors/TypeBoxError.ts";
import type { Static } from "./TypeProvider.ts";

export class SchemaValidator {
  protected cache = new Map<TSchema, Validator>();

  /**
   * Validate the value against the provided schema.
   *
   * Validation create a new value by applying some preprocessing. (e.g., trimming text)
   */
  public validate<T extends TSchema>(
    schema: T,
    value: unknown,
    options: ValidateOptions = {},
  ): Static<T> {
    const newValue = this.beforeParse(schema, value, {
      trim: options.trim ?? true,
      nullToUndefined: options.nullToUndefined ?? true,
      deleteUndefined: options.deleteUndefined ?? true,
    });

    try {
      return this.getValidator(schema).Parse(newValue);
    } catch (error: any) {
      if (error.cause?.errors?.[0]) {
        throw new TypeBoxError(error.cause.errors[0]);
      }
      throw error;
    }
  }

  protected getValidator<T extends TSchema>(schema: T): Validator<{}, T> {
    if (this.cache.has(schema)) {
      return this.cache.get(schema) as Validator<{}, T>;
    }

    const validator = Compile(schema);
    this.cache.set(schema, validator);
    return validator as Validator<{}, T>;
  }

  /**
   * Preprocess the value based on the schema before validation.
   *
   * - If the value is `null` and the schema does not allow `null`, it converts it to `undefined`.
   * - If the value is a string and the schema has a `~options.trim` flag, it trims whitespace from the string.
   */
  public beforeParse(schema: any, value: any, options: ValidateOptions): any {
    if (!schema) {
      return value;
    }

    if (
      value === null &&
      !this.isSchemaNullable(schema) &&
      options.nullToUndefined
    ) {
      return undefined;
    }

    if (Array.isArray(value)) {
      return value.map((it) => this.beforeParse(schema.items, it, options));
    }

    if (
      options.trim &&
      typeof value === "string" &&
      schema.type === "string" &&
      schema["~options"]?.trim
    ) {
      return String(value).trim();
    }

    if (
      typeof value === "object" &&
      value !== null &&
      schema.type === "object"
    ) {
      const obj: any = {};

      for (const key in value) {
        const newValue = this.beforeParse(
          schema.properties?.[key],
          value[key],
          options,
        );

        if (newValue === undefined && options.deleteUndefined) {
          continue;
        }

        obj[key] = newValue;
      }

      return obj;
    }

    return value;
  }

  /**
   * Used by `beforeParse` to determine if a schema allows null values.
   */
  protected isSchemaNullable = (schema: any): boolean => {
    if (!schema) {
      return false;
    }
    if (schema.type === "null") {
      return true;
    }
    if (Array.isArray(schema.type) && schema.type.includes("null")) {
      return true;
    }
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

export interface ValidateOptions {
  trim?: boolean;
  nullToUndefined?: boolean;
  deleteUndefined?: boolean;
}
