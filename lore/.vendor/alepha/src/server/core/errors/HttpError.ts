import {
  $error,
  type DeclaredError,
  type ErrorClass,
  type ErrorData,
} from "alepha";

import { httpErrorDataSchema } from "../schemas/httpErrorDataSchema.ts";

/**
 * The root of every HTTP error: a declared error whose data carries the
 * HTTP `status`.
 *
 * Throw it directly for a one-off status, or derive a named error from it:
 *
 * ```ts
 * throw new HttpError({ status: 502 }, { message: "Upstream failed", cause });
 *
 * export const QuotaExceeded = HttpError.extend({
 *   name: "QUOTA_EXCEEDED",
 *   default: { status: 409 },
 *   schema: z.object({ limit: z.number() }),
 * });
 * ```
 *
 * The router answers any `HttpError` with `data.status` and the body
 * `{ name, message, data }`; `HttpClient` rebuilds the registered class from
 * it. `error.status` is a shortcut for `error.data.status`.
 */
export const HttpError = $error({
  name: "HTTP",
  schema: httpErrorDataSchema,
}) as unknown as ErrorClass<
  {
    status: number;
    requestId?: string;
    details?: string;
  },
  never,
  "http"
>;

// `status` reads through to the data: every HTTP error is checked by status,
// and the data is where it lives.
Object.defineProperty(HttpError.prototype, "status", {
  get(this: { data: { status: number } }) {
    return this.data.status;
  },
  enumerable: false,
  configurable: true,
});

export type HttpError = InstanceType<typeof HttpError>;

/**
 * The instance of an HTTP error carrying data `T`: a declared error with the
 * `status` shortcut.
 */
export interface HttpErrorInstance<
  T extends ErrorData = ErrorData,
> extends DeclaredError {
  readonly data: T;
  readonly status: number;
}

declare module "alepha" {
  interface ErrorInstanceKinds<T extends ErrorData> {
    http: HttpErrorInstance<T>;
  }
}

/**
 * Any HTTP error class: `HttpError` or a descendant.
 */
export type HttpErrorClass<T extends HttpError = HttpError> = abstract new (
  ...args: any[]
) => T;

/**
 * Whether a value is an HTTP error, optionally of one status: an `HttpError`,
 * or anything carrying a numeric `status` (in itself or in its `data`) and a
 * message, such as an error rebuilt elsewhere or thrown by a library.
 */
export const isHttpError = (
  error: unknown,
  status?: number,
): error is HttpErrorLike => {
  if (!error || typeof error !== "object" || !("message" in error)) {
    return false;
  }
  const own = (error as { status?: unknown }).status;
  const fromData = (error as { data?: { status?: unknown } }).data?.status;
  const value = typeof own === "number" ? own : fromData;
  if (typeof value !== "number") {
    return false;
  }
  return status === undefined || value === status;
};

/**
 * The name the router gives an error that carries a status but no name of
 * its own (a library's error, a `status` field on a plain object).
 */
export const errorNameByStatus: Record<number, string> = {
  400: "BAD_REQUEST",
  401: "UNAUTHORIZED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  405: "METHOD_NOT_ALLOWED",
  409: "CONFLICT",
  410: "GONE",
  413: "PAYLOAD_TOO_LARGE",
  415: "UNSUPPORTED_MEDIA_TYPE",
  422: "UNPROCESSABLE_CONTENT",
  429: "TOO_MANY_REQUESTS",
  500: "INTERNAL_SERVER_ERROR",
  501: "NOT_IMPLEMENTED",
  502: "BAD_GATEWAY",
  503: "SERVICE_UNAVAILABLE",
  504: "GATEWAY_TIMEOUT",
};

/**
 * Status text, for OpenAPI descriptions and default messages.
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

export interface HttpErrorLike extends Error {
  status: number;
}
