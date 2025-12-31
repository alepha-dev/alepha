# OpenAPI & Swagger

You wrote your schemas. You defined your actions. Now comes the boring part: documenting your API so other developers can use it.

Just kidding. Alepha already did it for you.

## Zero-Config Documentation

Every `$action` you create is automatically documented. No YAML files. No `@ApiProperty()` decorators. No separate documentation step.

Just navigate to `/docs` and you'll see a full Swagger UI:

```
http://localhost:3000/docs
```

That's it. Your entire API — every endpoint, every parameter, every request body, every response — rendered in an interactive explorer. It updates in real-time as you code.

## What Gets Documented

Everything you put in your schema shows up in the docs:

```typescript filename="src/controllers/UserController.ts"
class UserController {
  group = "users";

  list = $action({
    group: this.group,
    path: "/users",
    description: "List all users with optional filtering and pagination.",
    schema: {
      query: t.object({
        page: t.optional(t.integer({ minimum: 1, default: 1 })),
        limit: t.optional(t.integer({ minimum: 1, maximum: 100, default: 20 })),
        role: t.optional(t.enum(["admin", "user", "guest"])),
      }),
      response: t.object({
        users: t.array(t.object({
          id: t.uuid(),
          name: t.text(),
          email: t.email(),
          role: t.enum(["admin", "user", "guest"]),
        })),
        total: t.integer(),
        page: t.integer(),
      }),
    },
    handler: async ({ query }) => {
      // ...
    },
  });
}
```

In Swagger UI, this becomes:

- **Tag**: `users` (from `group`)
- **Summary**: `list` (from property name)
- **Description**: "List all users with optional filtering and pagination."
- **Query Parameters**: `page`, `limit`, `role` — with types, defaults, and constraints
- **Response Schema**: Full object structure with all fields typed

## Grouping Endpoints

The `group` property organizes your endpoints into sections:

```typescript filename="src/controllers/OrderController.ts"
class OrderController {
  group = "orders";

  list = $action({ group: this.group, /* ... */ });
  create = $action({ group: this.group, /* ... */ });
  get = $action({ group: this.group, /* ... */ });
  cancel = $action({ group: this.group, /* ... */ });
}
```

```typescript filename="src/controllers/PaymentController.ts"
class PaymentController {
  group = "payments";

  charge = $action({ group: this.group, /* ... */ });
  refund = $action({ group: this.group, /* ... */ });
}
```

In Swagger UI, you get collapsible sections: **orders** (4 endpoints) and **payments** (2 endpoints). Clean and navigable.

If you don't set a group, it defaults to the class name.

## Adding Descriptions

The `description` field adds context to your endpoints:

```typescript
createUser = $action({
  description: "Creates a new user account. Sends a welcome email upon success.",
  schema: { /* ... */ },
  handler: async ({ body }) => { /* ... */ },
});
```

Short and useful. Tell developers what the endpoint does, not how it does it.

## Schema Descriptions

You can add descriptions to individual fields too:

```typescript
const createUserSchema = t.object({
  email: t.email({ description: "Must be unique across all users" }),
  password: t.text({
    minLength: 8,
    description: "Minimum 8 characters. We recommend using a password manager."
  }),
  role: t.optional(t.enum(["user", "admin"], {
    description: "Defaults to 'user' if not specified"
  })),
});
```

These descriptions appear in the Swagger UI schema viewer. Helpful for complex fields.

## Try It Out

Swagger UI isn't just documentation — it's an API playground.

1. Click on an endpoint
2. Fill in the parameters
3. Hit "Try it out"
4. See the real response from your server

No Postman. No curl. Just click and test. Perfect for quick debugging or demoing to stakeholders.

## Authentication in Swagger

If your API uses authentication (via `alepha/server/security`), Swagger UI shows a lock icon. Click "Authorize" to add your token, and all subsequent requests include it.

```typescript
import { $realm } from "alepha/security";

const apiRealm = $realm({
  name: "api",
  // ...
});
```

Protected endpoints show which realm they require. Swagger handles the rest.

## OpenAPI JSON

Need the raw OpenAPI spec? It's available at:

```
http://localhost:3000/docs/openapi.json
```

Use it to:
- Generate client SDKs (OpenAPI Generator)
- Import into Postman or Insomnia
- Feed into API gateways
- Run contract tests

The spec follows OpenAPI 3.0 and includes everything: paths, schemas, security definitions, and more.

## Customizing the Docs

### Custom Title and Version

Configure via environment variables or the Swagger provider:

```typescript filename="src/main.server.ts"
import { Alepha, run } from "alepha";
import { SwaggerProvider } from "alepha/server/swagger";

const app = Alepha.create().with({
  provide: SwaggerProvider,
  config: {
    title: "My Awesome API",
    version: "2.1.0",
    description: "The API that powers everything.",
  },
});

run(app);
```

### Hiding Internal Endpoints

Some endpoints shouldn't appear in public docs. Use `disabled` or create separate API surfaces:

```typescript
internalHealthCheck = $action({
  group: "internal",
  path: "/internal/health",
  // This still works, just won't be in public docs if you filter by group
  handler: async () => ({ status: "ok" }),
});
```

## Why This Matters

API documentation is usually an afterthought. It gets outdated. It lies. Developers stop trusting it.

With Alepha, documentation is generated from the same schemas that validate your requests and serialize your responses. It *cannot* lie. If the docs say a field is required, it's required. If they say the response has three fields, it has three fields.

Your schemas are your documentation. Keep them accurate, and the docs stay accurate automatically.

## Quick Reference

| URL | Purpose |
|-----|---------|
| `/docs` | Interactive Swagger UI |
| `/docs/openapi.json` | Raw OpenAPI 3.0 specification |

| Option | Where | Purpose |
|--------|-------|---------|
| `group` | `$action` | Groups endpoints into tags |
| `description` | `$action` | Endpoint description |
| `description` | Schema fields | Field-level documentation |
| `name` | `$action` | Override the operation name |
