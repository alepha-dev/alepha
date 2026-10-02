# Error Handling

Alepha maps errors to HTTP responses through the `HttpError` class. Unhandled errors become `500 Internal Server Error`.

## HttpError

Throw an `HttpError` to return a specific HTTP status code and message:

```typescript check
import { HttpError } from "alepha/server";

throw new HttpError({ status: 404, message: "Product not found" });
```

## Named Error Classes

Alepha provides error subclasses for common HTTP statuses:

```typescript check
import {
  BadRequestError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  ValidationError,
} from "alepha/server";

throw new NotFoundError("User not found");
throw new BadRequestError("Invalid input");
throw new UnauthorizedError("Not authenticated");
throw new ForbiddenError("Access denied");
throw new ConflictError("Entity already exists");
throw new ValidationError("Validation has failed");
```

Each class has a sensible default message:

| Class               | Status | Default Message                         |
| ------------------- | ------ | --------------------------------------- |
| `BadRequestError`   | 400    | "Invalid request body"                  |
| `ValidationError`   | 400    | "Validation has failed"                 |
| `UnauthorizedError` | 401    | "Not allowed to access this resource"   |
| `ForbiddenError`    | 403    | "No permission to access this resource" |
| `NotFoundError`     | 404    | "Resource not found"                    |
| `ConflictError`     | 409    | "Entity already exists"                 |

## Error Identification

Check whether an error is an HTTP error, optionally filtering by status:

```typescript
import { HttpError } from "alepha/server";

if (HttpError.is(error)) {
  // any HTTP error
}

if (HttpError.is(error, 404)) {
  // specifically a 404
}
```

## Error Chaining

Pass a `cause` to preserve the original error context:

```typescript
try {
  await externalService.call();
} catch (error) {
  throw new HttpError(
    { status: 502, message: "Upstream service failed" },
    error,
  );
}
```

The cause is included in the error JSON response under the `cause` field:

```json
{
  "error": "BadGatewayError",
  "status": 502,
  "message": "Upstream service failed",
  "cause": {
    "name": "FetchError",
    "message": "Connection refused"
  }
}
```

## Error Response Format

All HTTP errors are serialized as JSON with a consistent structure:

```json
{
  "error": "NotFoundError",
  "status": 404,
  "message": "User not found",
  "requestId": "abc-123"
}
```

The `error` field is the class name (e.g. `NotFoundError`, `ConflictError`). For plain `HttpError` instances, it is derived from the status code.

## Production Sanitization

In production (`NODE_ENV=production`), **5xx responses are stripped before they reach the client**: `message` becomes `"Internal Server Error"`, and `cause` and `details` are dropped. A 5xx message is internal - it routinely carries DB connection strings, upstream hostnames, and credentials - so it belongs in your logs, not in the response. The `requestId` is always preserved, which is how you correlate the sanitized response with the full error in your logs.

**4xx responses are never sanitized.** A `BadRequestError("age must be a positive integer")` is deliberate, client-facing context and is passed through verbatim, `cause` included.

Outside production nothing is stripped, so local debugging shows the real error.

This rule applies to every path an error can take to a client, including batched actions (`POST /api/_batch`) - a sub-action that fails with a 5xx reports `"Internal Server Error"` in its `error` field, while a 4xx sub-action keeps its message:

```json
[
  { "action": "getUser", "status": 200, "data": { "id": "1" } },
  { "action": "chargeCard", "status": 500, "error": "Internal Server Error" },
  {
    "action": "updateAge",
    "status": 400,
    "error": "age must be a positive integer"
  }
]
```

Use the `server:onError` hook below to ship the unsanitized error to your logger or Sentry.

## Status Code Mapping

`HttpError` maps status codes to error names automatically:

| Status | Error Name              |
| ------ | ----------------------- |
| 400    | BadRequestError         |
| 401    | UnauthorizedError       |
| 403    | ForbiddenError          |
| 404    | NotFoundError           |
| 409    | ConflictError           |
| 413    | PayloadTooLargeError    |
| 429    | TooManyRequestsError    |
| 500    | InternalServerError     |
| 502    | BadGatewayError         |
| 503    | ServiceUnavailableError |

Less common codes map too: 405 `MethodNotAllowedError`, 410 `GoneError`, 415 `UnsupportedMediaTypeError`, 501 `NotImplementedError`, 504 `GatewayTimeoutError`.

> Outside production, a handler that throws a bare `Error` triggers an explicit dev warning telling you it will surface as `"Internal Server Error"` once deployed - the sanitization above is invisible locally, so the warning is the only signal you get before production.

## Global Error Handling

Use the `server:onError` hook to intercept errors across all routes:

```typescript check
import { $hook } from "alepha";
import { $logger } from "alepha/logger";

class ErrorHandler {
  log = $logger();

  onError = $hook({
    on: "server:onError",
    handler: async ({ error, request }) => {
      this.log.error("Request failed", {
        error,
        path: request.url.pathname,
        method: request.method,
      });
    },
  });
}
```

The `server:onError` hook fires after the error is caught but before the response is sent. The response body is reset at this point and can be modified via `request.reply`.

## Schema Validation Errors

When a request fails schema validation (invalid body, params, or query), Alepha throws a `ValidationError` (status 400) automatically. You do not need to validate request data manually.
