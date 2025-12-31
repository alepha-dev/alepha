# Building an API

So you have the server running. Now you need to actually *do* something with it.

In Alepha, we don't write controllers full of decorators, and we don't write route handlers that are just untyped middleware functions. We write **Actions**.

## The `$action` Primitive

An `$action` is a type-safe HTTP endpoint. It bundles everything together:

1. **Route Configuration** — Path, method, group
2. **Validation Schema** — What goes in (body, query, params) and what comes out (response)
3. **Handler** — The function that runs

```typescript filename="src/controllers/UserController.ts"
import { t } from "alepha";
import { $action } from "alepha/server";

class UserController {
  getUser = $action({
    path: "/users/:id",
    schema: {
      params: t.object({ id: t.uuid() }),
      response: t.object({
        id: t.uuid(),
        name: t.text(),
        email: t.email(),
      }),
    },
    handler: async ({ params }) => {
      return await db.users.findById(params.id);
    },
  });
}
```

> **The `/api` Prefix**
>
> All `$action` paths are automatically prefixed with `/api`. So `path: "/users"` becomes `/api/users`. This keeps your API cleanly separated from pages and static files. Configure it via `SERVER_API_PREFIX` environment variable if needed.

## The Schema Object

The schema is where the magic happens. It defines everything about your request and response — and it's not just validation.

Your schema tells Alepha:
- **How to parse data** — JSON body? Form data? Raw text? Alepha figures it out from your schema.
- **Which HTTP status to use** — Return `void`? That's a `204 No Content`. Return an object? That's `200 OK`.
- **Which headers to expect** — Define a `headers` schema and Alepha validates them before your handler runs.
- **How to serialize the response** — The `response` schema strips undeclared fields. No accidental data leaks.

### `params` — URL Path Variables

When your URL has `:something`, that's a param.

```typescript filename="src/controllers/UserController.ts"
getUser = $action({
  path: "/users/:id",
  schema: {
    params: t.object({
      id: t.uuid(),  // /api/users/550e8400-e29b-41d4-a716-446655440000
    }),
  },
  handler: async ({ params }) => {
    // params.id is typed as string, validated as UUID
  },
});
```

```typescript filename="src/controllers/PostController.ts"
// Multiple params work too
getComment = $action({
  path: "/posts/:postId/comments/:commentId",
  schema: {
    params: t.object({
      postId: t.uuid(),
      commentId: t.uuid(),
    }),
  },
  handler: async ({ params }) => {
    // params.postId, params.commentId
  },
});
```

### `query` — URL Query Parameters

The stuff after the `?`. Perfect for filtering, pagination, sorting.

```typescript filename="src/controllers/UserController.ts"
listUsers = $action({
  path: "/users",
  schema: {
    query: t.object({
      page: t.optional(t.integer({ minimum: 1, default: 1 })),
      limit: t.optional(t.integer({ minimum: 1, maximum: 100, default: 20 })),
      search: t.optional(t.text()),
      role: t.optional(t.enum(["admin", "user", "guest"])),
    }),
    response: t.object({
      users: t.array(userSchema),
      total: t.integer(),
    }),
  },
  handler: async ({ query }) => {
    // query.page defaults to 1 if not provided
    // query.limit defaults to 20
    // query.search is string | undefined
    // query.role is "admin" | "user" | "guest" | undefined
    return await db.users.findMany({
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      where: { name: { contains: query.search }, role: query.role },
    });
  },
});
```

### `body` — Request Body

The payload. When you define a body schema, Alepha:
- Defaults the method to `POST` (you can override this)
- Parses the JSON body
- Validates it against the schema
- Throws `400 Bad Request` if validation fails — before your handler even runs

```typescript filename="src/controllers/UserController.ts"
createUser = $action({
  path: "/users",
  // method: "POST" is implicit when body is defined
  schema: {
    body: t.object({
      name: t.text({ minLength: 2, maxLength: 100 }),
      email: t.email(),
      password: t.text({ minLength: 8 }),
      role: t.optional(t.enum(["user", "admin"])),
    }),
    response: t.object({
      id: t.uuid(),
      name: t.text(),
      email: t.email(),
    }),
  },
  handler: async ({ body }) => {
    // body is fully validated here
    // body.name has 2-100 chars, body.email is a valid email
    // body.password has at least 8 chars
    // body.role is "user" | "admin" | undefined
    const user = await db.users.create(body);
    return user;
  },
});
```

### `headers` — Request Headers

Sometimes you need to read custom headers.

```typescript filename="src/controllers/WebhookController.ts"
webhookHandler = $action({
  path: "/webhooks/stripe",
  method: "POST",
  schema: {
    headers: t.object({
      "stripe-signature": t.text(),
    }),
    body: t.string(), // raw body for signature verification
  },
  handler: async ({ headers, body }) => {
    const signature = headers["stripe-signature"];
    // verify webhook signature...
  },
});
```

### `response` — The Most Important Schema

Here's where developers often cut corners. Don't.

The response schema isn't just documentation. It's **active serialization**.

```typescript filename="src/controllers/UserController.ts"
getUser = $action({
  schema: {
    params: t.object({ id: t.uuid() }),
    response: t.object({
      id: t.uuid(),
      name: t.text(),
      email: t.email(),
      // notice: no password field
    }),
  },
  handler: async ({ params }) => {
    const user = await db.users.findById(params.id);
    // user has { id, name, email, password, createdAt, ... }
    return user;
    // Alepha strips everything not in response schema
    // Client receives { id, name, email } only
  },
});
```

**Why this matters:**

1. **Security** — Accidentally returning `password`, `internalNotes`, or `deletedAt`? The response schema strips them out. You can't leak what you don't declare.

2. **Contract Enforcement** — Your API promises a shape. The schema enforces it. If your handler returns something wrong, you'll know immediately.

3. **Client Type Safety** — When using `$client`, the response type is inferred from the schema. Your frontend code gets autocomplete.

4. **OpenAPI Documentation** — Swagger UI shows exactly what clients will receive.

Without a response schema, you're flying blind. With one, you have a contract.

## Path is Optional

Let's be honest: REST can be annoying.

You spend more time debating "should it be `/users/:id/posts` or `/posts?userId=:id`" than actually building features. PUT vs PATCH wars. Plural vs singular nouns. It's exhausting.

Alepha makes all that optional. Don't want to think about paths? Don't. Alepha generates them from your property names. Don't want to specify HTTP methods? Don't. Alepha infers them from your schema. You can build a fully functional API without writing a single path or method — and it just works.

Of course, if you *want* clean RESTful URLs, you can have them. But you're not forced to. Ship first, bikeshed later.

If you don't specify a path, Alepha generates one from the property name:

```typescript filename="src/controllers/UserController.ts"
class UserController {
  // path: "/getUser" → GET /api/getUser
  getUser = $action({
    handler: async () => ({ name: "John" }),
  });

  // path: "/createUser" → POST /api/createUser (because of body)
  createUser = $action({
    schema: { body: t.object({ name: t.text() }) },
    handler: async ({ body }) => ({ id: "123", name: body.name }),
  });
}
```

Even better — if you have a `params` schema, the path auto-appends them:

```typescript filename="src/controllers/UserController.ts"
class UserController {
  // Auto-generates path: "/getUser/:id"
  getUser = $action({
    schema: {
      params: t.object({ id: t.uuid() }),
    },
    handler: async ({ params }) => {
      return await db.users.findById(params.id);
    },
  });
}
```

This convention-over-configuration approach means less boilerplate. But explicit paths are always clearer for complex routes.

## Method is Optional

Alepha infers the HTTP method:

- **No body schema** → `GET`
- **Has body schema** → `POST`

```typescript filename="src/controllers/UserController.ts"
// GET /api/users
listUsers = $action({
  path: "/users",
  handler: async () => [],
});

// POST /api/users (implicit because of body)
createUser = $action({
  path: "/users",
  schema: { body: t.object({ name: t.text() }) },
  handler: async ({ body }) => ({ id: "1", name: body.name }),
});

// PUT /api/users/:id (explicit override)
updateUser = $action({
  method: "PUT",
  path: "/users/:id",
  schema: {
    params: t.object({ id: t.uuid() }),
    body: t.object({ name: t.text() }),
  },
  handler: async ({ params, body }) => {
    return await db.users.update(params.id, body);
  },
});

// DELETE /api/users/:id
deleteUser = $action({
  method: "DELETE",
  path: "/users/:id",
  schema: { params: t.object({ id: t.uuid() }) },
  handler: async ({ params }) => {
    await db.users.delete(params.id);
  },
});
```

## Grouping Actions

The `group` property organizes related actions together.

```typescript filename="src/controllers/OrderController.ts"
class OrderController {
  group = "orders";

  list = $action({
    group: this.group,
    path: "/orders",
    handler: async () => [],
  });

  create = $action({
    group: this.group,
    path: "/orders",
    schema: { body: orderSchema },
    handler: async ({ body }) => {},
  });

  get = $action({
    group: this.group,
    path: "/orders/:id",
    schema: { params: t.object({ id: t.uuid() }) },
    handler: async ({ params }) => {},
  });
}
```

**What group does:**

1. **Swagger/OpenAPI Tags** — Actions with the same group appear together in the docs. Makes the API explorer navigable.

2. **Permission Names** — When using `alepha/server/security`, permissions are generated as `group:action`. So `orders:create`, `orders:list`, etc.

If you don't set `group`, it defaults to the class name (`OrderController`).

## Other Options

### `name`

Override the action name (used for path generation and logging):

```typescript
list = $action({
  name: "listAllUsers",  // Instead of "list"
  handler: async () => [],
});
```

### `description`

Document what the action does. Shows up in Swagger:

```typescript
createUser = $action({
  description: "Creates a new user account. Sends welcome email.",
  schema: { ... },
  handler: async ({ body }) => {},
});
```

### `disabled`

Kill switch. The route won't be registered, but the action can still be called directly via `run()`:

```typescript
dangerousAction = $action({
  disabled: this.alepha.isProduction(),
  handler: async () => {
    // Only available in development
  },
});
```

## Quick Reference

| Option | Required | Default | Purpose |
|--------|----------|---------|---------|
| `handler` | Yes | — | The function that runs |
| `path` | No | `/${propertyName}` | URL path |
| `method` | No | `GET` (or `POST` if body) | HTTP method |
| `schema.params` | No | — | URL path variables |
| `schema.query` | No | — | URL query parameters |
| `schema.body` | No | — | Request body |
| `schema.headers` | No | — | Request headers |
| `schema.response` | No | — | Response body (serialization!) |
| `group` | No | Class name | Tag for docs & permissions |
| `name` | No | Property name | Action identifier |
| `description` | No | — | Swagger description |
| `disabled` | No | `false` | Disable HTTP registration |
