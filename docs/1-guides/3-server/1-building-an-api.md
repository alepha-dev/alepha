# Building an API

So you have the server running. Now you need to actually *do* something with it.

In Alepha, we don't write controllers full of "decorators", and we don't write "route handlers" that are just untyped middleware functions. We write **Actions**.

## The `$action` Primitive

An `$action` is a definition of an HTTP endpoint. It bundles three things together:
1.  **Route Configuration:** Path, Method, etc.
2.  **Validation Schema:** What goes in (Body, Query, Params) and what comes out (Response).
3.  **Handler:** The actual function that runs.

> **Important:** All `$action` paths are automatically prefixed with `/api`.
>
> | You write | Actual URL |
> |-----------|------------|
> | `path: "/users"` | `/api/users` |
> | `path: "/users/:id"` | `/api/users/:id` |
> | `path: "/hello"` | `/api/hello` |
>
> This keeps your API routes cleanly separated from pages and static files. The prefix is configurable via `SERVER_API_PREFIX` environment variable.

### A Basic GET Endpoint

Let's say you want to fetch a user profile.

```typescript
import { t } from "alepha";
import { $action } from "alepha/server";

class UserController {
  path = "/users";

  // GET /api/users/:id
  getProfile = $action({
    path: `${this.path}/:id`,
    schema: {
      // 1. Define the URL parameters
      params: t.object({
        id: t.text(),
      }),
      // 2. Define what the frontend/client will receive
      response: t.object({
        id: t.text(),
        name: t.text(),
        email: t.email(),
      }),
    },
    // 3. The handler receives strictly typed arguments
    handler: async ({ params }) => {
      // params.id is typed as string here automatically.
      // If you return something that doesn't match 'response', TS will yell at you.
      return {
        id: params.id,
        name: "John Doe",
        email: "john@example.com",
      };
    },
  });
}
```

### Handling POST and Bodies

When you define a `body` in the schema, Alepha automatically:
*   Defaults the method to `POST`.
*   Parses the JSON body.
*   Validates it against the schema.
*   Throws a `400 Bad Request` if the data is wrong (before your handler even runs).

```typescript
  createPost = $action({
    path: "/posts",
    schema: {
      body: t.object({
        title: t.text({ minLength: 3 }),
        content: t.text(),
        tags: t.array(t.text()),
      }),
      response: t.object({
        id: t.uuid(),
        status: t.const("created"),
      }),
    },
    handler: async ({ body }) => {
      // 'body' is safe here. We know title has min 3 chars.
      // We know tags is an array of strings.
      const newId = await db.posts.create(body);

      return {
        id: newId,
        status: "created"
      };
    }
  });
```

## The Swagger/OpenAPI Bonus

Because you were a good developer and defined your schemas using `t` (TypeBox), Alepha rewards you.

You don't need to write a YAML file. You don't need to add `@ApiProperty()` decorators to random classes.

Just go to `http://localhost:3000/docs/` (or wherever your dev server is). You will see a full, interactive Swagger UI generated from your `$action` definitions. It updates in real-time as you code.
