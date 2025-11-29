import type {
  TAny,
  TArray,
  TArrayOptions,
  TBoolean,
  TInteger,
  TInterface,
  TKeysToIndexer,
  TNull,
  TNumber,
  TNumberOptions,
  TObject,
  TObjectOptions,
  TOmit,
  TOptionalAdd,
  TPartial,
  TPick,
  TProperties,
  TRecord,
  TSchema,
  TSchemaOptions,
  TString,
  TStringOptions,
  TUnion,
  TUnsafe,
} from "typebox";
import * as TypeBox from "typebox";
import { Type } from "typebox";
import type {
  TLocalizedValidationError,
  TLocalizedValidationMessageCallback,
} from "typebox/error";
import TypeBoxFormat from "typebox/format";
import { Locale } from "typebox/system";
import * as TypeBoxValue from "typebox/value";
import { OPTIONS } from "../constants/OPTIONS.ts";
import { AlephaError } from "../errors/AlephaError.ts";
import type { TypeBoxError } from "../errors/TypeBoxError.ts";
import { isTypeFile, type TFile, type TStream } from "../helpers/FileLike.ts";

export { TypeBox, TypeBoxValue, TypeBoxFormat };

export const isUUID = TypeBoxFormat.IsUuid;
export const isEmail = TypeBoxFormat.IsEmail;
export const isURL = TypeBoxFormat.IsUrl;
export const isDateTime = TypeBoxFormat.IsDateTime;
export const isDate = TypeBoxFormat.IsDate;
export const isTime = TypeBoxFormat.IsTime;
export const isDuration = TypeBoxFormat.IsDuration;

export type {
  StaticDecode,
  StaticDecode as Static,
  StaticEncode,
  TAny,
  TArray,
  TBigInt,
  TBoolean,
  TInteger,
  TKeysToIndexer,
  TNull,
  TNumber,
  TNumberOptions,
  TObject,
  TObjectOptions,
  TOptional,
  TOptionalAdd,
  TPick,
  TProperties,
  TRecord,
  TSchema,
  TString,
  TStringOptions,
  TTuple,
  TUnion,
  TUnsafe,
  TVoid,
} from "typebox";

// ---------------------------------------------------------------------------------------------------------------------

export class TypeGuard {
  // -------------------------------------------------------------------------------------------------------------------
  isBigInt = (value: TSchema): value is TString =>
    TypeBox.IsString(value) && "format" in value && value.format === "bigint";
  isUUID = (value: TSchema): value is TString =>
    TypeBox.IsString(value) && "format" in value && value.format === "uuid";
  isObject = TypeBox.IsObject;
  isNumber = TypeBox.IsNumber;
  isString = TypeBox.IsString;
  isBoolean = TypeBox.IsBoolean;
  isAny = TypeBox.IsAny;
  isArray = TypeBox.IsArray;
  isOptional = TypeBox.IsOptional;
  isUnion = TypeBox.IsUnion;
  isInteger = TypeBox.IsInteger;
  isNull = TypeBox.IsNull;
  isUndefined = TypeBox.IsUndefined;
  isUnsafe = TypeBox.IsUnsafe;
  isRecord = TypeBox.IsRecord;
  isTuple = TypeBox.IsTuple;
  isVoid = TypeBox.IsVoid;
  isLiteral = TypeBox.IsLiteral;
  isSchema = TypeBox.IsSchema;
  // -------------------------------------------------------------------------------------------------------------------
  isFile = isTypeFile;
  isDateTime = (schema: unknown) => {
    return t.schema.isString(schema) && schema.format === "date-time";
  };
  isDate = (schema: unknown) => {
    return t.schema.isString(schema) && schema.format === "date";
  };
  isTime = (schema: unknown) => {
    return t.schema.isString(schema) && schema.format === "time";
  };
  isDuration = (schema: unknown) => {
    return t.schema.isString(schema) && schema.format === "duration";
  };
}

declare module "typebox" {
  interface TString {
    format?: string;
    minLength?: number;
    maxLength?: number;
  }

  interface TNumber {
    format?: "int64";
  }
}

export class TypeProvider {
  static format = TypeBoxFormat;

  static {
    TypeBoxFormat.Set("bigint", (value: string | number) =>
      TypeProvider.isValidBigInt(value),
    );
  }

  static translateError(error: TypeBoxError, locale?: string): string {
    if (!locale) {
      return error.cause.message;
    }

    for (const [key, value] of Object.entries(Locale)) {
      if (key === "Set" || key === "Get" || key === "Reset") continue;
      if (key === locale || key.startsWith(`${locale}_`)) {
        return (value as (error: TLocalizedValidationError) => string)(
          error.cause,
        );
      }
    }
    return error.cause.message;
  }

  static setLocale(locale: string) {
    for (const [key, value] of Object.entries(Locale)) {
      if (key === "Set" || key === "Get" || key === "Reset") continue;
      if (key === locale || key.startsWith(`${locale}_`)) {
        Locale.Set(value as TLocalizedValidationMessageCallback);
        return;
      }
    }
    throw new AlephaError(`Locale not found: ${locale}`);
  }

  static isValidBigInt(value: string | number) {
    if (typeof value === "number") {
      return Number.isInteger(value);
    }

    // Reject empty or whitespace-only strings
    if (!value.trim()) return false;
    // Regex: optional minus, then digits only
    if (!/^-?\d+$/.test(value)) return false;

    try {
      BigInt(value); // Will throw if invalid
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Default maximum length for strings.
   *
   * It can be set to a larger value:
   * ```ts
   * TypeProvider.DEFAULT_STRING_MAX_LENGTH = 1000000;
   * TypeProvider.DEFAULT_STRING_MAX_LENGTH = undefined; // no limit (not recommended)
   * ```
   */
  static DEFAULT_STRING_MAX_LENGTH: number | undefined = 255;

  /**
   * Maximum length for short strings, such as names or titles.
   */
  static DEFAULT_SHORT_STRING_MAX_LENGTH: number | undefined = 64;

  /**
   * Maximum length for long strings, such as descriptions or comments.
   * It can be overridden in the string options.
   *
   * It can be set to a larger value:
   * ```ts
   * TypeProvider.DEFAULT_LONG_STRING_MAX_LENGTH = 2048;
   * ```
   */
  static DEFAULT_LONG_STRING_MAX_LENGTH: number | undefined = 1024;

  /**
   * Maximum length for rich strings, such as HTML or Markdown.
   * This is a large value to accommodate rich text content.
   * > It's also the maximum length of PG's TEXT type.
   *
   * It can be overridden in the string options.
   *
   * It can be set to a larger value:
   * ```ts
   * TypeProvider.DEFAULT_RICH_STRING_MAX_LENGTH = 1000000;
   * ```
   */
  static DEFAULT_RICH_STRING_MAX_LENGTH: number | undefined = 65535;

  /**
   * Maximum number of items in an array.
   * This is a default value to prevent excessive memory usage.
   * It can be overridden in the array options.
   */
  static DEFAULT_ARRAY_MAX_ITEMS = 1000;

  // -------------------------------------------------------------------------------------------------------------------
  public raw = Type; // typebox reference
  public any = Type.Any;
  public void = Type.Void;
  public undefined = Type.Undefined;
  public record = Type.Record;
  public union = Type.Union;
  public tuple = Type.Tuple;
  public null = Type.Null;
  public const = Type.Literal;
  public options = Type.Options;
  // -------------------------------------------------------------------------------------------------------------------

  /**
   * Type guards to check the type of schema.
   * This is not a runtime type check, but a compile-time type guard.
   *
   * @example
   * ```ts
   * if (t.schema.isString(schema)) {
   *   // schema is TString
   * }
   * ```
   */
  public readonly schema = new TypeGuard();

  // -------------------------------------------------------------------------------------------------------------------

  public extend<T extends TSchema[], U extends TProperties>(
    schema: [...T],
    properties: U,
    options?: TSchemaOptions,
  ): TInterface<T, U>;
  public extend<T extends TObject, U extends TProperties>(
    schema: T,
    properties: U,
    options?: TSchemaOptions,
  ): TInterface<[T], U>;
  public extend(
    schema: TSchema | TSchema[],
    properties: Record<string, any>,
    options?: TSchemaOptions,
  ): any {
    return Type.Interface(
      Array.isArray(schema) ? schema : [schema],
      properties,
      {
        additionalProperties: false,
        ...options,
      },
    );
  }

  public pick<T extends TObject, Indexer extends PropertyKey[]>(
    schema: T,
    keys: [...Indexer],
    options?: TObjectOptions,
  ): TPick<T, TKeysToIndexer<Indexer>> {
    return Type.Pick(schema, keys, {
      additionalProperties: false,
      ...options,
    });
  }

  public omit<T extends TObject, Indexer extends PropertyKey[]>(
    schema: T,
    keys: [...Indexer],
    options?: TObjectOptions,
  ): TOmit<T, TKeysToIndexer<Indexer>> {
    return Type.Omit(schema, keys, {
      additionalProperties: false,
      ...options,
    });
  }

  public partial<T extends TSchema>(
    schema: T,
    options?: TSchemaOptions,
  ): TPartial<T> {
    return Type.Partial(schema, {
      additionalProperties: false,
      ...options,
    });
  }

  /**
   * Create a schema for an object.
   * By default, additional properties are not allowed.
   *
   * @example
   * ```ts
   * const userSchema = t.object({
   *   id: t.integer(),
   *   name: t.string(),
   * });
   * ```
   */
  public object<T extends TProperties>(
    properties: T,
    options?: TObjectOptions,
  ): TObject<T> {
    return Type.Object(properties, {
      additionalProperties: false,
      ...options,
    });
  }

  /**
   * Create a schema for an array.
   * By default, the maximum number of items is limited to prevent excessive memory usage.
   *
   * @see TypeProvider.DEFAULT_ARRAY_MAX_ITEMS
   */
  public array<T extends TSchema>(
    schema: T,
    options?: TArrayOptions,
  ): TArray<T> {
    return Type.Array(schema, {
      maxItems: TypeProvider.DEFAULT_ARRAY_MAX_ITEMS,
      ...options,
    });
  }

  /**
   * Create a schema for a string.
   * For db or input fields, consider using `t.text()` instead, which has length limits.
   *
   * If you need a string with specific format (e.g. email, uuid), consider using the corresponding method (e.g. `t.email()`, `t.uuid()`).
   */
  public string(options: TStringOptions = {}): TString {
    return Type.String({
      ...options,
    });
  }

  /**
   * Create a schema for a string with length limits.
   * For internal strings without length limits, consider using `t.string()` instead.
   *
   * Default size is "regular", which has a max length of 255 characters.
   */
  public text(options: TTextOptions = {}): TString {
    const { size, ...rest } = options;
    const maxLength =
      size === "short"
        ? TypeProvider.DEFAULT_SHORT_STRING_MAX_LENGTH
        : size === "long"
          ? TypeProvider.DEFAULT_LONG_STRING_MAX_LENGTH
          : size === "rich"
            ? TypeProvider.DEFAULT_RICH_STRING_MAX_LENGTH
            : TypeProvider.DEFAULT_STRING_MAX_LENGTH;

    return Type.String({
      maxLength,
      "~options": {
        trim: options.trim ?? true,
        lowercase: options.lowercase ?? false,
      },
      ...rest,
    });
  }

  /**
   * Create a schema for a JSON object.
   * This is a record with string keys and any values.
   */
  public json(options?: TSchemaOptions): TRecord<string, TAny> {
    return t.record(t.text(), t.any(), options);
  }

  /**
   * Create a schema for a boolean.
   */
  public boolean(options?: TSchemaOptions): TBoolean {
    return Type.Boolean({
      ...options,
    });
  }

  /**
   * Create a schema for a number.
   */
  public number(options?: TNumberOptions): TNumber {
    return Type.Number({
      ...options,
    });
  }

  /**
   * Create a schema for an integer.
   */
  public integer(options?: TNumberOptions): TInteger {
    return Type.Integer({
      ...options,
    });
  }

  public int32(options?: TNumberOptions): TInteger {
    return Type.Integer({
      minimum: -2147483647,
      maximum: 2147483647,
      ...options,
    });
  }

  /**
   * Mimic a signed 64-bit integer.
   *
   * This is NOT a true int64, as JavaScript cannot represent all int64 values.
   * It is a number that is an integer and between -9007199254740991 and 9007199254740991.
   * Use `t.bigint()` for true int64 values represented as strings.
   */
  public int64(options?: TNumberOptions): TNumber {
    return Type.Number({
      format: "int64",
      multipleOf: 1,
      minimum: -9007199254740991,
      maximum: 9007199254740991,
      ...options,
    });
  }

  /**
   * Make a schema optional.
   */
  public optional<T extends TSchema>(schema: T): TOptionalAdd<T> {
    return Type.Optional(schema);
  }

  /**
   * Make a schema nullable.
   */
  public nullable<T extends TSchema>(
    schema: T,
    options?: TObjectOptions,
  ): TUnion<[TNull, T]> {
    return Type.Union([Type.Null(), schema], options);
  }

  /**
   * Create a schema that maps all properties of an object schema to nullable.
   */
  public nullify = <T extends TSchema>(schema: T, options?: TObjectOptions) =>
    Type.Mapped(
      Type.Identifier("K"),
      Type.KeyOf(schema),
      Type.Ref("K"),
      Type.Union([Type.Index(schema, Type.Ref("K")), Type.Null()]),
      options,
    );

  /**
   * Create a schema for a string enum.
   */
  public enum<T extends string[]>(
    values: [...T],
    options?: TTextOptions,
  ): TUnsafe<T[number]> {
    return Type.Unsafe<T[number]>(
      t.text({
        enum: values,
        pattern: values.map((v) => `^${v}$`).join("|"),
        ...options,
      }),
    );
  }

  // -------------------------------------------------------------------------------------------------------------------

  // Codec types

  /**
   * Create a schema for a bigint represented as a string.
   * This is a string that validates bigint format (e.g. "123456789").
   */
  public bigint(options?: TStringOptions) {
    return t.string({
      ...options,
      format: "bigint",
    });
  }

  /**
   * Create a schema for a URL represented as a string.
   */
  public url(options?: TStringOptions) {
    return this.string({
      ...options,
      format: "url",
    });
  }

  /**
   * Create a schema for binary data represented as a base64 string.
   */
  public binary(options: TStringOptions) {
    return this.string({
      ...options,
      format: "binary",
    });
  }

  /**
   * Create a schema for uuid.
   */
  public uuid(options?: TStringOptions): TString {
    return this.string({
      ...options,
      format: "uuid",
    });
  }

  /**
   * Create a schema for a file-like object.
   *
   * File like mimics the File API in browsers, but is adapted to work in Node.js as well.
   *
   * Implementation of file-like objects is handled by "alepha/file" package.
   */
  public file(options?: { maxSize?: number }): TFile {
    return Type.Unsafe(
      Type.Any({
        [OPTIONS]: options,
        format: "binary",
      }),
    );
  }

  /**
   * @experimental
   */
  public stream(): TStream {
    return Type.Unsafe(
      Type.Any({
        format: "stream",
        type: "string",
      }),
    );
  }

  // -------------------------------------------------------------------------------------------------------------------
  // Exotic types

  public email(options?: TStringOptions): TString {
    return this.text({
      ...options,
      format: "email",
      trim: true,
      lowercase: true,
    });
  }

  public e164(options?: TStringOptions): TString {
    return this.text({
      ...options,
      description: "Phone number in E.164 format, e.g. +1234567890.",
      pattern: "^\\+[1-9]\\d{1,14}$",
    });
  }

  public bcp47(options?: TStringOptions): TString {
    return this.text({
      ...options,
      description: "BCP 47 language tag, e.g. en, en-US, fr, fr-CA.",
      pattern: "^[a-z]{2,3}(?:-[A-Z]{2})?$",
    });
  }

  /**
   * Create a schema for short text, such as names or titles.
   * Default max length is 64 characters.
   */
  public shortText(options?: TStringOptions): TString {
    return this.text({
      size: "short",
      ...options,
    });
  }

  /**
   * Create a schema for long text, such as descriptions or comments.
   * Default max length is 1024 characters.
   */
  public longText(options?: TStringOptions): TString {
    return this.text({
      size: "long",
      ...options,
    });
  }

  /**
   * Create a schema for rich text, such as HTML or Markdown.
   * Default max length is 65535 characters.
   */
  public richText(options?: TStringOptions): TString {
    return this.text({
      size: "rich",
      ...options,
    });
  }

  /**
   * Create a schema for a string enum e.g. LIKE_THIS.
   */
  public snakeCase = (options?: TStringOptions) =>
    this.text({
      pattern: "^[A-Z_-]+$",
      ...options,
    });

  /**
   * Create a schema for an object with a value and label.
   */
  public valueLabel = (options?: TObjectOptions) =>
    this.object(
      {
        value: this.snakeCase({
          description: "Machine-readable value.",
        }),
        label: this.text({
          description: "Human-readable label.",
        }),
        description: this.optional(
          this.text({
            description: "Description of the value.",
            size: "long",
          }),
        ),
      },
      options,
    );

  public datetime = (options?: TStringOptions) =>
    t.text({
      ...options,
      format: "date-time",
    });

  public date = (options?: TStringOptions) =>
    t.text({
      ...options,
      format: "date",
    });

  public time = (options?: TStringOptions) =>
    t.text({
      ...options,
      format: "time",
    });

  public duration = (options?: TStringOptions) =>
    t.text({
      ...options,
      format: "duration",
    });
}

// ---------------------------------------------------------------------------------------------------------------------

export type TextLength = "short" | "regular" | "long" | "rich";

export interface TTextOptions extends TStringOptions {
  /**
   * Predefined size of the text.
   *
   * - `short` - short text, such as names or titles. Default max length is 64 characters.
   * - `regular` - regular text, such as single-line input. Default max length is 255 characters.
   * - `long` - long text, such as descriptions or comments. Default max length is 1024 characters.
   * - `rich` - rich text, such as HTML or Markdown. Default max length is 65535 characters.
   *
   * You can override the default max length by specifying `maxLength` in the options.
   *
   * @default "regular"
   */
  size?: TextLength;

  /**
   * Trim whitespace from both ends of the string.
   *
   * @default true
   */
  trim?: boolean;

  /**
   * Convert the string to lowercase.
   *
   * @default false
   */
  lowercase?: boolean;
}

// ---------------------------------------------------------------------------------------------------------------------

export const t: TypeProvider = new TypeProvider();
