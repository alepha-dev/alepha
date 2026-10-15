# Error Handling

Every error in Alepha is declared with `$error`: a name, and a schema for the data it carries. HTTP errors are one family of them, rooted at `HttpError`, whose data carries the HTTP `status`. The router answers any `HttpError` with that status; anything else becomes `500 Internal Server Error`.

To make the errors an action may answer with part of its contract (typed `data`, OpenAPI, `instanceof` in the browser, and a `500` for anything else), declare them on the action: see [Typed errors](/docs/guides-server-typed-errors).

## HttpError

Throw an `HttpError` for a one-off status. The data comes first, the message (and a cause) last, as for `Error`:

```typescript check
import { HttpError } from "alepha/server";

throw new HttpError({ status: 502 }, { message: "Upstream failed" });
```

`error.status` reads `error.data.status`.

## Built-in Errors

Alepha declares the common statuses, each an `HttpError.extend(...)`:

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

Each has a name, a status and a default message:

| Constant                  | Name                    | Status | Default message                         |
| ------------------------- | ----------------------- | ------ | --------------------------------------- |
| `BadRequestError`         | `BAD_REQUEST`           | 400    | "Invalid request body"                  |
| `ValidationError`         | `VALIDATION_FAILED`     | 400    | "Validation has failed"                 |
| `UnauthorizedError`       | `UNAUTHORIZED`          | 401    | "Not allowed to access this resource"   |
| `ForbiddenError`          | `FORBIDDEN`             | 403    | "No permission to access this resource" |
| `NotFoundError`           | `NOT_FOUND`             | 404    | "Resource not found"                    |
| `ConflictError`           | `CONFLICT`              | 409    | "Entity already exists"                 |
| `TooManyRequestsError`    | `TOO_MANY_REQUESTS`     | 429    | "Too Many Requests"                     |
| `InternalServerError`     | `INTERNAL_SERVER_ERROR` | 500    | "Internal Server Error"                 |
| `ServiceUnavailableError` | `SERVICE_UNAVAILABLE`   | 503    | "Service Unavailable"                   |

## Your Own Errors

Derive an error from any of them with `.extend`, adding a schema for the data the client needs:

```typescript check
import { z } from "alepha";
import { HttpError, NotFoundError } from "alepha/server";

export const SlugTaken = HttpError.extend({
  name: "SLUG_TAKEN",
  default: { status: 409 },
  schema: z.object({ slug: z.text() }),
  message: (data) => `Slug '${data.slug}' is already taken`,
});

export const ProjectNotFound = NotFoundError.extend({
  name: "PROJECT_NOT_FOUND",
});

throw new SlugTaken({ slug: "home" });
```

There are no error classes to write: `check:conventions` refuses one. See [Typed errors](/docs/guides-server-typed-errors) for the full `$error` API.

## Error Identification

`instanceof` works on every declared error, its parents included (`ProjectNotFound` is a `NotFoundError` and an `HttpError`). For an error that crossed some boundary without being rebuilt, `isHttpError` checks the shape:

```typescript
import { isHttpError } from "alepha/server";

if (isHttpError(error)) {
  // anything with a numeric status
}

if (isHttpError(error, 404)) {
  // specifically a 404
}
```

## Error Chaining

Pass a `cause` to keep the original error:

```typescript
try {
  await externalService.call();
} catch (error) {
  throw new HttpError(
    { status: 502 },
    { message: "Upstream service failed", cause: error },
  );
}
```

The cause's name and message go to the response under `cause`:

```json
{
  "name": "BAD_GATEWAY",
  "message": "Upstream service failed",
  "data": { "status": 502, "requestId": "abc-123" },
  "cause": { "name": "FetchError", "message": "Connection refused" }
}
```

## Error Response Format

Every error is serialized the same way, `{ name, message, data, cause? }`:

```json
{
  "name": "NOT_FOUND",
  "message": "User not found",
  "data": { "status": 404, "requestId": "abc-123" }
}
```

- `name` is the error's name. A one-off `new HttpError({ status })` is named after its status (`PAYLOAD_TOO_LARGE`).
- `data` is the error's data: `status`, the `requestId`, an optional `details` (longer prose), plus whatever its own schema declares.

`HttpClient` rebuilds the declared class from that body, so `instanceof SlugTaken` holds in the browser.

## Production Sanitization

In production (`NODE_ENV=production`), **5xx responses are stripped before they reach the client**: `message` becomes `"Internal Server Error"`, and `cause` and `data.details` are dropped. A 5xx message is internal - it routinely carries DB connection strings, upstream hostnames, and credentials - so it belongs in your logs, not in the response. The `requestId` is always preserved, which is how you correlate the sanitized response with the full error in your logs.

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

Use the `server:request:error` hook below to ship the unsanitized error to your logger or Sentry.

## Errors from Elsewhere

An error that is not an `HttpError` but carries a numeric `status` (common in upstream libraries) is answered with that status, named after it (`502` is `BAD_GATEWAY`), under the same 5xx sanitization. Anything else becomes a `500 INTERNAL_SERVER_ERROR`.

> Outside production, a handler that throws a bare `Error` triggers an explicit dev warning telling you it will surface as `"Internal Server Error"` once deployed - the sanitization above is invisible locally, so the warning is the only signal you get before production.

## Global Error Handling

Use the `server:request:error` hook to intercept errors across all routes:

```typescript check
import { $hook } from "alepha";
import { $logger } from "alepha/logger";

class ErrorHandler {
  log = $logger();

  onError = $hook({
    on: "server:request:error",
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

The `server:request:error` hook receives `{ error, request, route }` and fires after the error is caught but before the response is sent. The reply's body and status are reset at this point. A hook that sets `request.reply.status` (a custom error page, for instance) owns the response, and the default JSON error is not written.

## Schema Validation Errors

When a request fails schema validation (invalid body, params, or query), Alepha throws a `ValidationError` (`VALIDATION_FAILED`, status 400) automatically, its `data.details` naming the path that failed. You do not need to validate request data manually.
