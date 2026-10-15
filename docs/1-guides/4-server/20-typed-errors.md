# Typed errors

A `$action` can declare the errors it answers with. Declared errors are part of its contract: they reach the client with their status and a typed `data` payload, they appear in the OpenAPI document, and the browser rebuilds them so `instanceof` works there too. Anything else the handler throws is a bug, and answers a `500` like any other crash.

This is opt-in, per action. An action without `errors` behaves as described in [Error Handling](/docs/guides-server-error-handling).

## Declaring an error

`$error` returns an `HttpError` subclass. Declare it once, at module level, in a file the browser can load (it imports nothing server-only):

```typescript check
// src/errors/QuotaExceeded.ts
import { z } from "alepha";
import { $error } from "alepha/server";

export const QuotaExceeded = $error({
  code: "QuotaExceeded",
  status: 409,
  data: z.object({ limit: z.number(), used: z.number() }),
});

// Optional: a name for function signatures.
export type QuotaExceeded = InstanceType<typeof QuotaExceeded>;

export const ProjectArchived = $error({
  code: "ProjectArchived",
  status: 409,
  message: "This project is archived",
});
```

- `code` is required. It is what the `error` field of the JSON body carries, so write it in PascalCase and make it equal to the constant's name, the same vocabulary as the built-in `"NotFoundError"`. The factory cannot see the constant's name, so it has to be spelled out.
- `status` is the HTTP status it answers with.
- `data` is an optional `z.object` schema. With one, the constructor takes the payload first and it is type-checked; without one, every argument is optional.
- `message` is the default message. Without it, the status text (`"Conflict"`).

## Throwing it

Any layer can throw it. A service needs no reference to the action that will answer:

```typescript check
import { z } from "alepha";
import { $error } from "alepha/server";

const QuotaExceeded = $error({
  code: "QuotaExceeded",
  status: 409,
  data: z.object({ limit: z.number(), used: z.number() }),
});

class ProjectService {
  async create(used: number) {
    if (used >= 5) {
      throw new QuotaExceeded({ limit: 5, used });
    }
    // A message or a cause of your own goes last.
    throw new QuotaExceeded(
      { limit: 5, used },
      { message: "Upgrade to create more projects" },
    );
  }
}
```

## Declaring it on an action

`errors` lists what the handler may throw: `$error` constants and built-in classes (`NotFoundError`, `ForbiddenError`, ...) alike.

```typescript check
import { $inject, z } from "alepha";
import { $action, $error, NotFoundError } from "alepha/server";

const QuotaExceeded = $error({
  code: "QuotaExceeded",
  status: 409,
  data: z.object({ limit: z.number(), used: z.number() }),
});

class ProjectService {
  async create(name: string) {
    return { id: name };
  }
}

class ProjectController {
  projects = $inject(ProjectService);

  createProject = $action({
    errors: [QuotaExceeded, NotFoundError],
    schema: {
      body: z.object({ name: z.text() }),
      response: z.object({ id: z.text() }),
    },
    handler: ({ body }) => this.projects.create(body.name),
  });
}
```

Setting `errors` turns on strict mode for that action:

- An error matching a declared class (`instanceof`) reaches the client with its status and `data`.
- **Anything else becomes a `500 InternalServerError`**, including an undeclared `HttpError` such as a `NotFoundError` the list forgot. In production the body is byte for byte the one any other crash answers: no message, no cause. Outside production the message passes through, prefixed with the class name. Either way a warning names the action and the class: `'createProject' threw NotFoundError, which it does not declare`.
- `errors: []` is strict too: nothing is expected.
- Omitting `errors` changes nothing: any `HttpError` passes with its status, as before.

### What always passes

Only what the handler, and the services it calls, throw is filtered. The framework's own answers sit outside the filter and never need declaring:

| Source                              | Status    |
| ----------------------------------- | --------- |
| Request validation (body, query...) | 400       |
| `$secure`                           | 401 / 403 |
| `$rateLimit`                        | 429       |
| A timeout (`DbTimeoutError`)        | 503       |

Any `use` middleware is outside the filter, and so is any error carrying a `503` (in itself or in its cause chain): a timeout tells the caller to retry, it is never a contract violation.

⚠️ A repository lookup that misses throws `DbEntityNotFoundError`, which carries a 404 but is not an `HttpError`, so strict mode turns it into a 500. Translate it where you look the row up:

```typescript
try {
  return await this.repo.getById(id);
} catch (error) {
  if (error instanceof DbEntityNotFoundError) {
    throw new NotFoundError("Project not found", error);
  }
  throw error;
}
```

## OpenAPI

A strict action's operation documents every declared error under its status, with `error` fixed to its code and `data` typed by its schema (two errors on one status become a `oneOf`), the responses its middlewares declare (`401`, `403`, `429`), `400` when it validates input, and the `500`. Actions without `errors` are documented as before. See [OpenAPI](/docs/guides-server-openapi).

A middleware of your own documents its responses by setting the `MIDDLEWARE_RESPONSES` meta key to a comma-separated list of statuses.

## Branching in React

`HttpClient` rebuilds any error whose code is registered, and an `$error` constant registers itself when its module is imported. A page that writes `instanceof QuotaExceeded` has imported it, so the check holds in the browser:

```tsx
import { useAction } from "alepha/react";

const create = useAction({
  handler: (_ctx, name: string) => api.createProject({ body: { name } }),
  onError: (error) => {
    if (error instanceof QuotaExceeded) {
      // error.data is { limit: number; used: number }
      openUpgradeDialog(error.data.limit);
    }
  },
});
```

`RunResult`'s error stays `Error`; `instanceof` is what narrows it, on `result.error` as in `onError`. An `onError` marks the failure handled, so the app's `ActionErrorToaster` stays quiet.

Built-in classes rebuild too: a `404` from the framework is a `NotFoundError` in the browser. A code nothing registered, or `data` failing its schema, stays a plain `HttpError`.

Where a function needs the whole union an action may reject with, `ActionErrors<typeof action>` names it: the declared classes plus `InternalServerError`.

## The one limit

TypeScript has no checked exceptions. Nothing proves at compile time that a service throws only what the action declares; the warning logged for an undeclared error is what keeps the list honest.
