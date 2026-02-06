# Error Handling

Every tool promises "great error handling." Then you get a stack trace 47 levels deep pointing to some internal middleware you've never seen.

Alepha tries to be honest about errors. When something breaks, you should know what, where, and why.

## The Error Hierarchy

All errors thrown by Alepha extend `AlephaError`. This is the base class that ensures consistent behavior across the engine:

```
AlephaError (base)
├── HttpError (server errors with status codes)
│   ├── BadRequestError (400)
│   ├── UnauthorizedError (401)
│   ├── ForbiddenError (403)
│   ├── NotFoundError (404)
│   ├── ConflictError (409)
│   └── ValidationError (400)
├── DbError (500)
│   ├── DbEntityNotFoundError (404)
│   ├── DbConflictError (409)
│   └── DbVersionMismatchError (409)
└── TypeBoxError (400)
```

**If you see an error that doesn't extend `AlephaError`, that's a bug.**
Either in your code or in the engine. All modules use this hierarchy consistently.

## HTTP Errors

For web applications, use the specific error classes from `alepha/server`:

```typescript
import {
  NotFoundError,
  BadRequestError,
  UnauthorizedError,
  ForbiddenError,
  ConflictError,
} from "alepha/server";

class UserController {
  repo = $repository(userEntity);

  // Repository methods already throw DbEntityNotFoundError (404) if not found
  // No need to check for null!
  getUser = $action({
    path: "/users/:id",
    handler: async ({ params }) => {
      return await this.repo.findById(params.id);
    },
  });
}

// When working with non-ORM data sources, throw errors explicitly
class ConfigController {
  protected configs = new Map<string, Config>();

  getConfig = $action({
    path: "/configs/:key",
    handler: async ({ params }) => {
      const config = this.configs.get(params.key);

      if (!config) {
        throw new NotFoundError(`Config '${params.key}' not found`);
      }

      return config;
    },
  });
}
```

The client receives a clean JSON error:

```json
{
  "error": "NotFoundError",
  "message": "User not found",
  "status": 404
}
```

### The Error Response Schema

All HTTP errors follow a consistent schema. This isn't just convention—it's enforced:

```typescript
{
  error: string;      // Error class name ("NotFoundError", "ValidationError", etc.)
  status: number;     // HTTP status code
  message: string;    // Human-readable description
  details?: string;   // Optional detailed explanation
  requestId?: string; // Request tracking ID (when enabled)
  cause?: {           // Original error (development only)
    name: string;
    message: string;
  };
}
```

Need the schema or type in your code? Import it:

```typescript
import { errorSchema, type ErrorSchema } from "alepha/server";
```

This schema is used for OpenAPI documentation, client-side type inference, and response serialization. Your frontend can rely on this shape for every error, every time.

### Available Error Classes

| Class | Status | Default Message |
|-------|--------|-----------------|
| `BadRequestError` | 400 | "Invalid request body" |
| `UnauthorizedError` | 401 | "Not allowed to access this resource" |
| `ForbiddenError` | 403 | "No permission to access this resource" |
| `NotFoundError` | 404 | "Resource not found" |
| `ConflictError` | 409 | "Entity already exists" |
| `ValidationError` | 400 | "Validation has failed" |

For custom status codes, use `HttpError` directly:

```typescript
import { HttpError } from "alepha/server";

class TeapotController {
  brew = $action({
    path: "/brew",
    handler: async () => {
      throw new HttpError({ status: 418, message: "I'm a teapot" });
    },
  });
}
```

## The `status` Field Matters

**Every error in Alepha should have a `status` field.** This is critical for HTTP responses:

- Errors with `status` return that status code to the client
- Errors **without** `status` become **500 Internal Server Error**

**You should never have 500 errors by design.** A 500 means something unexpected happened. If you know an error can occur, give it a proper status code.

```typescript
// Bad: This becomes a 500
throw new Error("User not found");

// Good: This is a proper 404
throw new NotFoundError("User not found");

// Even better: Domain-specific error
throw new ProductNotFoundError(productId);
```

Domain-specific errors are more expressive. `ProductNotFoundError` tells you exactly what's missing. `EmptyStockError` tells you why the order failed. Generic `NotFoundError` makes you dig through logs. Name your errors after business concepts, not HTTP codes.

## Checking Error Types with `HttpError.is()`

The `HttpError.is()` static method is essential for error handling. It checks if an error is HTTP-like and optionally matches a specific status:

```typescript
import { HttpError } from "alepha/server";

class UserService {
  async getOrCreateUser(email: string) {
    try {
      return await this.api.getUser.run({ params: { email } });
    } catch (error) {
      // Check if it's any HTTP error
      if (HttpError.is(error)) {
        console.log("HTTP error with status:", error.status);
      }

      // Check for a specific status code
      if (HttpError.is(error, 404)) {
        // User not found, create one
        return await this.createUser(email);
      }

      // Check for multiple statuses
      if (HttpError.is(error, 401) || HttpError.is(error, 403)) {
        // Auth issue
        throw new UnauthorizedError("Please log in first", error);
      }

      // Unknown error, re-throw
      throw error;
    }
  }
}
```

`HttpError.is()` works with any error that has `status` and `message` properties, not just `HttpError` instances. This makes it compatible with errors from the ORM and other modules.

## Database Errors

The ORM module throws errors with proper `status` fields automatically:

```typescript
class UserService {
  repo = $repository(userEntity);

  async updateUser(id: string, data: UserUpdate) {
    // This throws DbEntityNotFoundError (status: 404) if user doesn't exist
    return await this.repo.updateById(id, data);
  }
}
```

Available database errors:

| Class | Status | When |
|-------|--------|------|
| `DbEntityNotFoundError` | 404 | `findById`, `updateById`, `deleteById` when entity missing |
| `DbConflictError` | 409 | Unique constraint violation |
| `DbVersionMismatchError` | 409 | Optimistic locking conflict |

Because these errors have `status`, they automatically translate to proper HTTP responses:

```typescript
class UserController {
  updateUser = $action({
    path: "/users/:id",
    schema: { body: userUpdateSchema },
    handler: async ({ params, body }) => {
      // If user not found, client gets 404 automatically
      return await this.repo.updateById(params.id, body);
    },
  });
}
```

## Schema Validation Errors

When TypeBox schema validation fails, Alepha throws a `TypeBoxError`:

```typescript
class UserController {
  createUser = $action({
    schema: {
      body: t.object({
        email: t.email(),
        age: t.integer({ minimum: 18 }),
      }),
    },
    handler: async ({ body }) => {
      // body is guaranteed valid here
    },
  });
}
```

If someone sends `{ email: "not-an-email", age: 15 }`, they get a 400:

```json
{
  "error": "ValidationError",
  "status": 400,
  "message": "Invalid request body",
  "cause": {
    "name": "TypeBoxError",
    "message": "Invalid email format at /email"
  }
}
```

You don't write validation code. You don't catch validation errors. They just work.

## Error Chaining with `cause`

All Alepha errors support the standard `cause` property for error chaining. This lets you see the full error trail:

```typescript
class PaymentService {
  async processPayment(userId: string, amount: number) {
    try {
      await this.stripe.charge(userId, amount);
    } catch (stripeError) {
      // Wrap the original error as the cause
      throw new BadRequestError("Payment failed", stripeError);
    }
  }
}
```

The error chain is preserved:

```
BadRequestError: Payment failed
  └── cause: StripeError: Card declined
        └── cause: NetworkError: Connection timeout
```

## Global Error Handling

### Server-Side

Use a hook to intercept all errors:

```typescript
class ErrorHandler {
  log = $logger();

  onError = $hook({
    on: "server:onError",
    handler: async ({ error, request }) => {
      // Log every error
      this.log.error("Request failed", {
        url: request.url,
        error: error.message,
        status: HttpError.is(error) ? error.status : 500,
      });

      // Send to Sentry
      Sentry.captureException(error, {
        extra: { url: request.url },
      });
    },
  });
}
```

### Client-Side (React)

Use the event system:

```typescript
class ErrorHandler {
  log = $logger();

  onError = $hook({
    // catch all action errors in React (from useAction, useForm and router)
    on: "react:action:error",
    handler: async ({ error, request }) => {
      // Log to analytics
      analytics.track("error", {
        message: error.message,
        action: type,
      });
    },
  });
}
```

One listener. Every error. No try/catch everywhere.

## Error Handling Patterns

### Transform at Boundaries

Convert internal errors to HTTP errors at the API layer:

```typescript
class UserController {
  getUser = $action({
    path: "/users/:id",
    handler: async ({ params }) => {
      try {
        return await this.userService.findById(params.id);
      } catch (error) {
        if (error instanceof UserNotFoundError) {
          throw new NotFoundError(error.message, error);
        }
        throw error; // Re-throw unknown errors
      }
    },
  });
}
```

### Graceful Degradation

For non-critical features, fail silently:

```typescript
class UserController {
  getUser = $action({
    path: "/users/:id",
    handler: async ({ params }) => {
      const user = await this.users.findById(params.id);

      // Recommendations are nice to have, not critical
      let recommendations = [];
      try {
        recommendations = await this.recommendationService.get(params.id);
      } catch (e) {
        this.log.warn("Recommendations failed, continuing without");
      }

      return { ...user, recommendations };
    },
  });
}
```

## Summary

| Scenario | Solution |
|----------|----------|
| Resource not found | `throw new NotFoundError()` |
| Invalid input | Let schema validation handle it |
| Auth failure | `throw new UnauthorizedError()` |
| No permission | `throw new ForbiddenError()` |
| Duplicate entity | `throw new ConflictError()` |
| Business rule violation | Custom error extending `AlephaError` with `status` |
| Check error type | `HttpError.is(error, 404)` |
| Global logging | `$hook({ on: "server:onError" })` |

**Remember:**
- All errors should extend `AlephaError`
- All errors should have a `status` field
- 500 errors mean something is wrong with your error handling
- Use `cause` to chain errors for debugging
