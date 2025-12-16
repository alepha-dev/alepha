import { AlephaError } from "alepha";
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

  static toJSON(error: HttpError): ErrorSchema {
    const json: Record<string, unknown> = {
      error: error.error,
      status: error.status,
      message: error.message,
    };

    if (error.details) json.details = error.details;
    if (error.requestId) json.requestId = error.requestId;
    if (error.reason) json.cause = error.reason;

    return json as ErrorSchema;
  }

  public readonly error: string;
  public readonly status: number;

  public readonly requestId?: string;
  public readonly details?: string;
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

    if (this.constructor.name === "HttpError") {
      this.error =
        options.error ?? errorNameByStatus[this.status] ?? "HttpError";
    } else {
      this.error = this.constructor.name;
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

export interface HttpErrorLike extends Error {
  status: number;
}
