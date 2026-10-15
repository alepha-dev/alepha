import { AlephaError, type ZType } from "alepha";

import type { ErrorSchema } from "../schemas/errorSchema.ts";

export const isHttpError = (
  error: unknown,
  status?: number,
): error is HttpErrorLike => {
  const isError =
    !!error &&
    typeof error === "object" &&
    "message" in error &&
    typeof error.message === "string" &&
    "status" in error &&
    typeof error.status === "number";

  if (!isError) {
    return false;
  }

  if (status) {
    return (error as HttpErrorLike).status === status;
  }

  return true;
};

export class HttpError extends AlephaError {
  public name = "HttpError";

  static is = isHttpError;

  /**
   * Error classes by wire code, so a client can rebuild the class a server
   * threw from the `error` field of its JSON body.
   *
   * Filled by every `$error` constant when its module is evaluated, and by
   * the built-in subclasses (`NotFoundError`, ...) through their static
   * block. A second registration of a code replaces the first: a dev server
   * re-evaluating a module must never throw.
   */
  static readonly registry = new Map<string, HttpErrorClass>();

  /**
   * Register an error class under its own static `code`, or under the code
   * given explicitly. The last registration of a code wins.
   */
  static register(cls: HttpErrorClass, code?: string): void {
    const key = code ?? (cls as { code?: string }).code;
    if (!key) {
      throw new AlephaError(
        `Cannot register error class '${cls.name}': it has no static code`,
      );
    }
    HttpError.registry.set(key, cls);
  }

  /**
   * Rebuild an error from its JSON body (what {@link HttpError.toJSON}
   * wrote).
   *
   * A code found in the {@link HttpError.registry} yields an instance of that
   * class, so `instanceof` holds on the client. The class's constructor is
   * NOT called, since a built-in takes `(message, cause)` and an `$error`
   * class takes `(data, init)`: the fields are copied as they came, and the
   * instance is re-parented onto the class's prototype.
   *
   * A code matching nothing registered, or `data` failing the class's
   * schema, yields a plain `HttpError`, never a parse error.
   */
  static fromJSON(json: ErrorSchema): HttpError {
    const error = new HttpError(json);
    const cls = HttpError.registry.get(json.error);
    if (!cls) {
      return error;
    }

    const schema = (cls as { schema?: ZType }).schema;
    if (schema) {
      const parsed = schema.safeParse(json.data);
      if (!parsed.success) {
        return error;
      }
      (error as { data?: unknown }).data = parsed.data;
    }

    Object.setPrototypeOf(error, cls.prototype);
    error.name = json.error;
    return error;
  }

  static toJSON(error: HttpError): ErrorSchema {
    const json: Record<string, unknown> = {
      error: error.error,
      status: error.status,
      message: error.message,
    };

    if (error.details) json.details = error.details;
    if (error.data) json.data = error.data;
    if (error.requestId) json.requestId = error.requestId;
    if (error.reason) json.cause = error.reason;

    return json as ErrorSchema;
  }

  public readonly error: string;
  public readonly status: number;

  public readonly requestId?: string;
  public readonly details?: string;

  /**
   * Machine-readable payload for an error the client has to act on rather
   * than merely display. Survives the round trip: the server serializes it
   * in {@link HttpError.toJSON} and `HttpClient` reads it back through
   * `errorSchema`.
   */
  public readonly data?: Record<string, any>;
  public readonly reason?: {
    name: string;
    message: string;
  };

  constructor(options: Partial<ErrorSchema>, cause?: unknown) {
    super(options.message, {
      cause,
    });

    this.status = options.status ?? 500;
    this.details = options.details;
    this.data = options.data;
    this.requestId = options.requestId;

    if (typeof options.cause === "object") {
      this.reason = {
        name: (options.cause as { name: string }).name,
        message: (options.cause as { message: string }).message,
      };
    } else if (cause instanceof Error) {
      this.reason = {
        name: cause.name,
        message: cause.message,
      };
    }

    const ctor = this.constructor as { name: string; code?: string };
    if (ctor === HttpError) {
      this.error =
        options.error ?? errorNameByStatus[this.status] ?? "HttpError";
    } else if (Object.hasOwn(ctor, "code") && ctor.code) {
      // `$error` constants and the registered built-ins carry their code
      // explicitly, so the wire does not depend on the build keeping names.
      // A subclass of a built-in (`InvalidTokenError`) has no own code and
      // keeps its class name, as before.
      this.error = ctor.code;
    } else {
      this.error = ctor.name;
    }
  }
}

export const errorNameByStatus: Record<number, string> = {
  400: "BadRequestError",
  401: "UnauthorizedError",
  403: "ForbiddenError",
  404: "NotFoundError",
  405: "MethodNotAllowedError",
  409: "ConflictError",
  410: "GoneError",
  413: "PayloadTooLargeError",
  415: "UnsupportedMediaTypeError",
  429: "TooManyRequestsError",
  500: "InternalServerError",
  501: "NotImplementedError",
  502: "BadGatewayError",
  503: "ServiceUnavailableError",
  504: "GatewayTimeoutError",
};

/**
 * Text used as the default message of an `$error` declared without one.
 */
export const statusTextByStatus: Record<number, string> = {
  400: "Bad Request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not Found",
  405: "Method Not Allowed",
  409: "Conflict",
  410: "Gone",
  413: "Payload Too Large",
  415: "Unsupported Media Type",
  422: "Unprocessable Content",
  429: "Too Many Requests",
  500: "Internal Server Error",
  501: "Not Implemented",
  502: "Bad Gateway",
  503: "Service Unavailable",
  504: "Gateway Timeout",
};

/**
 * Any `HttpError` class, whatever its constructor takes: a built-in
 * (`NotFoundError`) or an `$error` constant.
 */
export type HttpErrorClass<T extends HttpError = HttpError> = abstract new (
  ...args: any[]
) => T;

export interface HttpErrorLike extends Error {
  status: number;
}
