import {
  DeclaredError,
  type DeclaredErrorInit,
  type ErrorJson,
} from "../errors/DeclaredError.ts";
import type { Infer, ZObject } from "../providers/ZodProvider.ts";

/**
 * Declares an error: a name, and a schema for the data it carries.
 *
 * `$error` returns a class, declared once at module level like `$atom`. Throw
 * it from anywhere, and derive more specific errors from it with `.extend`:
 *
 * ```ts
 * export const QuotaExceeded = $error({
 *   name: "QUOTA_EXCEEDED",
 *   schema: z.object({ limit: z.number(), used: z.number() }),
 *   default: { limit: 5 },
 *   message: "Quota exceeded",
 * });
 *
 * throw new QuotaExceeded({ used: 6 }); // `limit` has a default
 * throw new QuotaExceeded({ used: 6 }, { message: "Upgrade", cause });
 *
 * if (error instanceof QuotaExceeded) error.data.used; // narrows, typed
 * ```
 *
 * - `name` is SCREAMING_SNAKE (`"QUOTA_EXCEEDED"`). It is the error's
 *   `Error.name` and its identity on the wire, so it must be unique.
 * - `schema` types `data`. `default` makes the keys it covers optional when
 *   constructing; when every key is optional, `new X("message", { cause })`
 *   works as it does for `Error`.
 * - `message` is the default message, a string or a function of the data.
 * - `.extend({ name, schema?, default?, message? })` derives a real subclass
 *   (`instanceof` the parent holds), its schema merged into the parent's and
 *   its defaults over the parent's.
 * - Every declared error registers under its name, so `X.fromJSON(json)`
 *   rebuilds the right class from `X.toJSON(error)`, across a process or a
 *   network.
 *
 * HTTP errors are one family of declared errors: `HttpError` from
 * `alepha/server` is an `$error` whose schema carries `status`, and
 * `NotFoundError` is `HttpError.extend({ name: "NOT_FOUND", default: { status: 404 } })`.
 */
export const $error = <
  S extends ZObject | undefined = undefined,
  const D extends Partial<SchemaData<S>> = {},
>(
  options: ErrorPrimitiveOptions<SchemaData<S>, S, D>,
): ErrorClass<Simplify<SchemaData<S>>, keyof D> =>
  DeclaredError.extend(options as any) as unknown as ErrorClass<
    Simplify<SchemaData<S>>,
    keyof D
  >;

// ---------------------------------------------------------------------------------------------------------------------

export interface ErrorPrimitiveOptions<
  T extends ErrorData,
  S extends ZObject | undefined,
  D,
> {
  /**
   * The error's name: SCREAMING_SNAKE, unique, its identity on the wire.
   */
  name: string;

  /**
   * Schema of `data`. On `.extend`, merged into the parent's.
   */
  schema?: S;

  /**
   * Default data. The keys it covers become optional when constructing. On
   * `.extend`, merged over the parent's.
   */
  default?: D;

  /**
   * The default message, or a function of the data. Without one, the
   * parent's, else the name.
   */
  message?: string | ((data: T) => string);

  /**
   * Prose for OpenAPI and the docs.
   */
  description?: string;
}

/**
 * The data of an error: an object.
 */
export type ErrorData = Record<string, any>;

/**
 * A declared error's instance, typed by its data.
 *
 * An interface over the `DeclaredError` class rather than an intersection, so
 * `instanceof` narrows both ways: `x instanceof X` removes `X` from a union in
 * the `else` branch, which TypeScript only does for class-derived types.
 */
export interface ErrorInstance<
  T extends ErrorData = ErrorData,
> extends DeclaredError {
  readonly data: T;
}

/**
 * The instance type of each family of declared errors, by kind. A module that
 * adds members to its family's instances (`alepha/server` adds `status` to
 * every HTTP error) augments this interface with its own kind.
 */
export interface ErrorInstanceKinds<T extends ErrorData> {
  base: ErrorInstance<T>;
}

export type ErrorKind = keyof ErrorInstanceKinds<ErrorData>;

/**
 * The instance of a declared error of kind `I` carrying data `T`.
 */
export type ErrorInstanceOf<
  I extends ErrorKind,
  T extends ErrorData,
> = ErrorInstanceKinds<T>[I];

/**
 * The class `$error` and `.extend` return.
 *
 * `T` is the data, `K` the keys a default covers, `I` the family's kind.
 */
export interface ErrorClass<
  T extends ErrorData = ErrorData,
  K extends PropertyKey = never,
  I extends ErrorKind = "base",
> {
  new (...args: ErrorConstructorArgs<T, K>): ErrorInstanceOf<I, T>;
  readonly prototype: ErrorInstanceOf<I, T>;

  /**
   * The error's name.
   */
  readonly name: string;
  readonly schema: ZObject | undefined;
  readonly defaults: Partial<T>;
  readonly description: string | undefined;

  /**
   * Derive a more specific error. See `$error`.
   */
  extend<
    S extends ZObject | undefined = undefined,
    const D extends Partial<T & SchemaData<S>> = {},
  >(
    options: ErrorPrimitiveOptions<T & SchemaData<S>, S, D>,
  ): ErrorClass<Simplify<T & SchemaData<S>>, K | keyof D, I>;

  /**
   * Rebuild an error from `toJSON`'s output: the registered class when the
   * name is this one or a descendant and its data passes the schema, else an
   * instance of this class carrying what it was given.
   */
  fromJSON(json: ErrorJson): ErrorInstanceOf<I, T>;

  /**
   * An error as `{ name, message, data?, cause? }`.
   */
  toJSON(error: Error & { data?: ErrorData }): ErrorJson;

  /**
   * This error in `error` or its cause chain, or `undefined`.
   */
  find(error: unknown): ErrorInstanceOf<I, T> | undefined;
}

/**
 * The constructor's arguments: `(data, init?)`, and `(message?, init?)` when
 * every data key is optional.
 */
export type ErrorConstructorArgs<T extends ErrorData, K extends PropertyKey> =
  {} extends ErrorInput<T, K>
    ?
        | [message?: string, init?: Omit<DeclaredErrorInit, "message">]
        | [data?: ErrorInput<T, K>, init?: DeclaredErrorInit]
    : [data: ErrorInput<T, K>, init?: DeclaredErrorInit];

/**
 * The data a constructor takes: the keys a default covers are optional.
 */
export type ErrorInput<T extends ErrorData, K extends PropertyKey> = Simplify<
  Omit<T, K> & Partial<Pick<T, Extract<K, keyof T>>>
>;

type SchemaData<S> = S extends ZObject ? Infer<S> : {};

type Simplify<T> = { [K in keyof T]: T[K] } & {};
