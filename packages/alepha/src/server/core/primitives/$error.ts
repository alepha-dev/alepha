import type { Infer, ZObject } from "alepha";

import { HttpError, statusTextByStatus } from "../errors/HttpError.ts";

/**
 * Declares a typed error with a code, an HTTP status and an optional data schema.
 *
 * The `data` schema types the payload the client receives with the error.
 *
 * `$error` returns an `HttpError` subclass. Declare it once at module level,
 * like `$atom`, in a file the browser can load (`src/errors/QuotaExceeded.ts`),
 * and throw it from any layer: a service needs no reference to the action
 * that will answer it.
 *
 * ```ts
 * export const QuotaExceeded = $error({
 *   code: "QuotaExceeded",
 *   status: 409,
 *   data: z.object({ limit: z.number(), used: z.number() }),
 * });
 *
 * export const UserNotFound = $error({ code: "UserNotFound", status: 404 });
 *
 * throw new QuotaExceeded({ limit: 5, used: 6 }); // data required and typed
 * throw new UserNotFound({ message: "No such user" }); // every argument optional
 *
 * if (e instanceof QuotaExceeded) e.data.limit; // narrows, data typed
 * ```
 *
 * - `code` is required, PascalCase, and equal to the constant's name: it is
 *   what the `error` field of the JSON body carries, the same vocabulary as
 *   the built-in errors (`"NotFoundError"`). The factory cannot see the
 *   constant's name, so it has to be spelled.
 * - The constant registers itself in `HttpError.registry` when its module is
 *   evaluated, so `HttpClient` rebuilds it by code and `instanceof` holds in
 *   the browser.
 * - Not a container primitive: nothing ties it to an `Alepha` instance, and
 *   the browser constructs it too.
 * - A name for signatures is optional:
 *   `export type QuotaExceeded = InstanceType<typeof QuotaExceeded>;`.
 *
 * List it in a `$action`'s `errors` to make it part of that action's
 * contract.
 */
export const $error = <
  const C extends string,
  D extends ZObject | undefined = undefined,
>(
  options: ErrorPrimitiveOptions<C, D>,
): DeclaredErrorClass<C, D> => {
  const defaultMessage =
    options.message ?? statusTextByStatus[options.status] ?? options.code;

  const cls = class extends HttpError {
    static readonly code: C = options.code;
    static readonly status: number = options.status;
    static readonly schema: D = options.data as D;

    constructor(...args: any[]) {
      const [data, init] = (
        options.data ? [args[0], args[1]] : [undefined, args[0]]
      ) as [Record<string, any> | undefined, HttpErrorInit | undefined];
      super(
        {
          status: options.status,
          message: init?.message ?? defaultMessage,
          data,
        },
        init?.cause,
      );
      this.name = options.code;
    }
  };

  Object.defineProperty(cls, "name", { value: options.code });
  HttpError.register(cls);

  return cls as unknown as DeclaredErrorClass<C, D>;
};

// ---------------------------------------------------------------------------------------------------------------------

export interface ErrorPrimitiveOptions<
  C extends string,
  D extends ZObject | undefined,
> {
  /**
   * The wire code, written into the `error` field. PascalCase, equal to the
   * constant's name.
   */
  code: C;

  /**
   * The HTTP status the error answers with.
   */
  status: number;

  /**
   * Schema of the payload the error carries. When set, the constructor takes
   * the payload as its first argument, and the client parses it back with
   * this schema.
   */
  data?: D;

  /**
   * Default message. Without it, the status text ("Not Found").
   */
  message?: string;
}

/**
 * The optional last argument of an `$error` constructor.
 */
export interface HttpErrorInit {
  message?: string;
  cause?: unknown;
}

/**
 * An instance of an `$error` class.
 */
export type DeclaredError<
  C extends string = string,
  D extends ZObject | undefined = ZObject | undefined,
> = Omit<HttpError, "error" | "data"> & {
  readonly error: C;
  readonly data: D extends ZObject ? Infer<D> : undefined;
};

/**
 * The class `$error` returns.
 */
export interface DeclaredErrorClass<
  C extends string = string,
  D extends ZObject | undefined = ZObject | undefined,
> {
  new (
    ...args: D extends ZObject
      ? [data: Infer<D>, init?: HttpErrorInit]
      : [init?: HttpErrorInit]
  ): DeclaredError<C, D>;
  readonly prototype: DeclaredError<C, D>;
  readonly code: C;
  readonly status: number;
  readonly schema: D;
}
