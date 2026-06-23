import type { TSchema } from "typebox";
import { Compile, type Validator } from "typebox/compile";
import * as Value from "typebox/value";
import { TypeBoxError } from "../errors/TypeBoxError.ts";
import { $hook } from "../primitives/$hook.ts";
import { type Static, t } from "./TypeProvider.ts";

export class SchemaValidator {
  // WeakMap allows GC of compiled validators when their schema key is no longer
  // referenced elsewhere (e.g. dynamically-created schemas from join queries).
  // Static singleton schemas (entity schemas) stay cached as long as reachable.
  protected cache = new WeakMap<object, Validator>();
  protected useEval: boolean = true;

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
      //
      if (!this.useEval) {
        return Value.Parse(schema, newValue) as Static<T>;
      }
      return this.getValidator(schema).Parse(newValue) as Static<T>;
    } catch (error: any) {
      if (error.cause?.errors?.[0]) {
        throw new TypeBoxError(error.cause.errors[0]);
      }
      throw error;
    }
  }

  /**
   * Deep clone a schema. Useful when a schema is going to be mutated.
   */
  public clone<T extends TSchema>(schema: T): T {
    return Value.Clone(schema);
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

    // Unwrap optional/union to access the inner type schema (e.g. array items, object properties).
    // Must happen after the null check above which needs the original schema for nullability.
    if (!schema.type && schema.anyOf) {
      schema =
        schema.anyOf.find(
          (s: any) => s.type !== "null" && s.type !== "undefined",
        ) || schema;
    }

    if (Array.isArray(value)) {
      return value.map((it) => this.beforeParse(schema.items, it, options));
    }

    if (typeof value === "string" && schema.type === "string") {
      let str = value;

      if (options.trim && schema["~options"]?.trim) {
        str = str.trim();
      }

      if (schema["~options"]?.lowercase) {
        str = str.toLowerCase();
      }

      return str;
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

  protected onConfigure = $hook({
    on: "configure",
    handler: () => {
      this.useEval = this.canEval();
    },
  });

  protected canEval(): boolean {
    try {
      Compile(t.object({ test: t.string() })).Parse({ test: "value" });
      return true;
    } catch {
      return false;
    }
  }
}

export interface ValidateOptions {
  trim?: boolean;
  nullToUndefined?: boolean;
  deleteUndefined?: boolean;
}
