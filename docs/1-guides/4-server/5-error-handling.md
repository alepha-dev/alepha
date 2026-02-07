# Error Handling

Alepha maps errors to HTTP responses through the `HttpError` class. Unhandled errors become `500 Internal Server Error`.

## HttpError

Throw an `HttpError` to return a specific HTTP status code and message:

```typescript
import { HttpError } from "alepha/server";

throw new HttpError({ status: 404, message: "Product not found" });
```

## Named Error Classes

Alepha provides error subclasses for common HTTP statuses:

```typescript
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

| Class | Status | Default Message |
|-------|--------|-----------------|
| `BadRequestError` | 400 | "Invalid request body" |
| `ValidationError` | 400 | "Validation has failed" |
| `UnauthorizedError` | 401 | "Not allowed to access this resource" |
| `ForbiddenError` | 403 | "No permission to access this resource" |
| `NotFoundError` | 404 | "Resource not found" |
| `ConflictError` | 409 | "Entity already exists" |

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

## Status Code Mapping

`HttpError` maps status codes to error names automatically:

| Status | Error Name |
|--------|-----------|
| 400 | BadRequestError |
| 401 | UnauthorizedError |
| 403 | ForbiddenError |
| 404 | NotFoundError |
| 409 | ConflictError |
| 413 | PayloadTooLargeError |
| 429 | TooManyRequestsError |
| 500 | InternalServerError |
| 502 | BadGatewayError |
| 503 | ServiceUnavailableError |

## Global Error Handling

Use the `server:onError` hook to intercept errors across all routes:

```typescript
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
