Here is the continuation of the documentation. I've written these to match the existing structure, focusing on practical "Guides" to build out features and "Concepts" to explain the philosophy, keeping the tone direct and developer-to-developer.

### File: `docs/1-guides/3-building-an-api.md`

```markdown
# Building an API

So you have the server running. Now you need to actually *do* something with it.

In Alepha, we don't write "controllers" full of decorators, and we don't write "route handlers" that are just untyped middleware functions. We write **Actions**.

## The `$action` Primitive

An `$action` is a definition of an HTTP endpoint. It bundles three things together:
1.  **Route Configuration:** Path, Method, etc.
2.  **Validation Schema:** What goes in (Body, Query, Params) and what comes out (Response).
3.  **Handler:** The actual function that runs.

### A Basic GET Endpoint

Let's say you want to fetch a user profile.

```typescript
import { t } from "alepha";
import { $action } from "alepha/server";

class UsersApi {
  // GET /api/users/:id
  getProfile = $action({
    path: "/users/:id",
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
        status: t.literal("created"),
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

Just go to `http://localhost:3000/docs` (or wherever your dev server is). You will see a full, interactive Swagger UI generated from your `$action` definitions. It updates in real-time as you code.

## Calling Actions Internally

Here is a cool trick. Since `$action` is just a property on your class, you can call it like a regular function if you are on the server.

```typescript
class OtherService {
  usersApi = $inject(UsersApi);

  async doSomething() {
    // This doesn't make an HTTP request!
    // It calls the handler directly, bypassing the network stack,
    // but still performing validation logic.
    const user = await this.usersApi.getProfile.run({
      params: { id: "123" }
    });
  }
}
```

This effectively eliminates the need to split your logic into "Controller" vs "Service" layers for simple CRUD operations. The Action *is* the unit of logic.
```

---

### File: `docs/1-guides/4-database-access.md`

```markdown
# Database Access

We use **Postgres** (or SQLite for testing/local dev).
We use **Drizzle ORM** under the hood because it's fast and typesafe.
But we wrap it in Alepha primitives to make it seamless.

## Defining Entities

Instead of writing SQL or complex class mappers, you define an `$entity`.
This acts as the source of truth for both your TypeScript types and your Database table structure.

```typescript
import { t } from "alepha";
import { $entity, pg } from "alepha/orm";

// src/entities/User.ts
export const userEntity = $entity({
  name: "users", // The table name
  schema: t.object({
    // pg.primaryKey() handles UUID/Integer/BigInt generation automatically
    id: pg.primaryKey(),

    // Standard TypeBox types
    email: t.email(),
    name: t.text(),

    // Automatic timestamp management
    createdAt: pg.createdAt(),
    updatedAt: pg.updatedAt(),
  }),
  // Simple index definition
  indexes: ["email"],
});
```

## Using Repositories

To interact with the database, you inject a repository for that entity.

```typescript
import { $repository } from "alepha/orm";
import { userEntity } from "./entities/User";

class UserService {
  // This creates a type-safe repository for the userEntity
  repo = $repository(userEntity);

  async findByEmail(email: string) {
    // .findOne, .findMany, .create, .update, .delete...
    return await this.repo.findOne({
      where: {
        email: { eq: email }
      }
    });
  }

  async listRecent() {
    // Pagination is built-in
    return await this.repo.paginate({
      page: 0,
      size: 20,
      sort: "-createdAt" // Descending sort
    });
  }
}
```

## Migrations

"But how do I create the table?"

Alepha integrates with Drizzle Kit. You don't need to manually write migration files for every little change during development.

1.  **Dev Mode:** When you run `alepha dev`, we check your `$entity` definitions against the database. If they differ, we (safely) suggest or apply changes to your development DB.
2.  **Production:** You generate migration files.

```bash
# Check what changed
npx alepha db:generate

# Apply changes
npx alepha db:migrate
```

## Advanced: Queries & Transactions

Sometimes you need raw power.

### Transactions
Use the `$transaction` primitive to ensure atomicity.

```typescript
import { $transaction } from "alepha/orm";

class BillingService {
  process = $transaction({
    handler: async (tx, userId: string, amount: number) => {
      // Pass { tx } to repository methods to use the transaction scope
      await this.userRepo.updateById(userId, { status: 'paid' }, { tx });
      await this.invoiceRepo.create({ userId, amount }, { tx });
    }
  });
}
```

### Raw SQL
If the repository helper methods aren't enough, you can drop down to raw SQL while keeping some type safety.

```typescript
import { sql } from "alepha/orm";

await this.repo.query(sql`
  SELECT * FROM users WHERE age > 18
`);
```
```

---

### File: `docs/2-concepts/5-type-safety.md`

```markdown
# Type Safety (The `t` Object)

In many full-stack frameworks, you end up defining your data structures three times:
1.  Once for the Database (SQL/ORM)
2.  Once for the API Validation (Zod/Joi)
3.  Once for TypeScript interfaces

If you change one, you have to change the others. It's exhaustive and error-prone.

Alepha solves this with the `t` object.

## One Schema to Rule Them All

Alepha uses **TypeBox** (wrapped as `t`) as its schema definition language. We chose TypeBox because it compiles down to standard JSON Schema, which is extremely portable.

When you define an object with `t`, Alepha uses it for everything:

```typescript
const userSchema = t.object({
  username: t.text(),
  age: t.integer()
});
```

1.  **Runtime Validation:** Used by `$action` to validate incoming HTTP JSON bodies.
2.  **Database Definition:** Used by `$entity` to generate `CREATE TABLE` statements (String -> VARCHAR, Integer -> INT4).
3.  **TypeScript Inference:** Used by your IDE to give you autocomplete (`user.username`).
4.  **Documentation:** Used by `$swagger` to generate OpenAPI specs.

## Specialized Types

We extended TypeBox with Alepha-specific helpers to cover common app scenarios without regex soup.

*   `t.email()`: Validates email format.
*   `t.date()` / `t.datetime()`: Handles ISO date strings.
*   `t.file()`: Handles file uploads (multipart/form-data).
*   `t.uuid()`: Validates UUID format.

## Usage Example

You don't need to manually infer types. It happens automatically.

```typescript
// Define schema
const inputSchema = t.object({
  search: t.text(),
  page: t.number()
});

// TypeScript type helper
import { type Static } from "alepha";
type Input = Static<typeof inputSchema>;
// Input is now: { search: string; page: number }
```

Alepha providers (like the `CodecManager`) handle the serialization/deserialization for you, ensuring that a `t.date()` coming from a JSON API ends up as a real Date object (or DayJS object) in your code, not just a string.
```

---

### File: `docs/2-concepts/6-background-jobs.md`

```markdown
# Background Jobs

Doing everything inside the HTTP request cycle is a recipe for a slow app. Sending emails, generating PDFs, or crunching data should happen in the background.

Alepha provides three primitives for this, depending on *when* you want the code to run.

## 1. `$scheduler`: "Do this later" (Cron)

Use this for recurring tasks.

```typescript
import { $scheduler } from "alepha/scheduler";

class CleanupService {
  // Runs every night at midnight
  purgeOldFiles = $scheduler({
    cron: "0 0 * * *",
    // Optional: distributed lock ensures only ONE instance runs this,
    // even if you have 10 servers running.
    lock: true,
    handler: async () => {
      // ... logic
    }
  });
}
```

## 2. `$queue`: "Do this in the background" (Worker)

Use this when you want to offload work from a user request to a background worker. It handles retries, persistence, and concurrency.

```typescript
import { $queue } from "alepha/queue";

class EmailService {
  // Define the queue and the handler together
  sendEmail = $queue({
    name: "send-email",
    schema: t.object({ to: t.email(), subject: t.text() }),
    handler: async ({ payload }) => {
      await smtp.send(payload);
    }
  });

  // Call it from your API
  async trigger(to: string) {
    await this.sendEmail.push({ to, subject: "Hi!" });
  }
}
```

By default, this uses an **In-Memory** provider (great for dev).
In production, you just switch the provider to **Redis**, and your queues become persistent and scalable across multiple servers without changing your business logic code.

## 3. `$thread`: "Do this heavy math" (CPU Bound)

Node.js is single-threaded. If you calculate Fibonacci(1000) in your API, your whole server freezes for everyone.

`$thread` spawns a Node.js Worker Thread to handle CPU-intensive tasks without blocking the main event loop.

```typescript
import { $thread } from "alepha/thread";

class MathService {
  heavyCalc = $thread({
    handler: async () => {
      // This runs in a separate thread!
      // Main thread is free to handle HTTP requests.
      return doHeavyMath();
    }
  });
}
```
```

---

### File: `docs/1-guides/5-react-integration.md`

```markdown
# React Integration

Alepha isn't just a backend framework. It's a full-stack framework. We treat the frontend as just another part of your application graph.

## The `$page` Primitive

In frameworks like Next.js or Remix, you create files in a `pages/` directory. In Alepha, you define pages as properties on a class, just like API endpoints.

Why? Because it allows Type-Safe linkage between your backend data fetching and your frontend components.

```tsx
// src/app/router.ts
import { $page } from "@alepha/react";
import { t } from "alepha";

export class AppRouter {

  // Define a route
  dashboard = $page({
    path: "/dashboard",

    // Validation for URL Query Params
    schema: {
      query: t.object({
        filter: t.optional(t.text())
      })
    },

    // Server-Side Data Fetching (The "Loader")
    // This runs on the server.
    resolve: async ({ query }) => {
      // You can inject backend services here!
      const stats = await db.stats.get(query.filter);
      return { stats };
    },

    // The React Component
    // Props are typed automatically from the resolve return type
    component: ({ stats }) => {
      return <div>Stats: {stats.count}</div>
    }
  });
}
```

## Hooks

We provide hooks to interact with the framework from inside your React components.

*   `useAlepha()`: Get access to the DI container in the client.
*   `useAction()`: Wrapper around async functions to handle loading/error states.
*   `useForm()`: Manage form state, validation, and submission based on TypeBox schemas.

### Forms Example

Since we share schemas, building forms is trivial.

```tsx
import { useForm } from "@alepha/react/form";
import { TypeForm } from "@alepha/ui";

const MyComponent = () => {
  const form = useForm({
    schema: userSchema, // Reuse the same schema from your DB/API!
    handler: async (values) => {
      await api.users.create(values);
    }
  });

  // Renders a full form with labels, validation, and error handling
  return <TypeForm form={form} />;
};
```

## Server-Side Rendering (SSR)

Alepha handles SSR out of the box.
1.  The server matches the URL to a `$page`.
2.  It runs the `resolve` function to get data.
3.  It renders the React component string.
4.  It sends HTML to the browser.
5.  It "hydrates" the React app on the client side.

You don't need to configure Babel, Webpack, or Vite manually. `alepha dev` and `alepha build` handle the complexity.
```

Here is the next set of documentation. We are going to cover the "scary" parts of backend development—Authentication, Real-time, and Deployment—and show how Alepha makes them boring (in a good way).

### File: `docs/1-guides/6-authentication.md`

```markdown
# Authentication & Security

In most frameworks, adding authentication involves:
1.  Installing Passport.js / NextAuth.
2.  Configuring a session store (Redis).
3.  Writing middleware to check headers.
4.  Manually hashing passwords.
5.  Praying you didn't leave a hole.

In Alepha, authentication is just another set of primitives.

## 1. The Realm

First, you need a **Realm**. Think of a Realm as a container for users, roles, and sessions.

```typescript
import { $userRealm } from "alepha/api/users";

class AuthSystem {
  // Creates a full user management system with 'admin' and 'user' roles.
  // It automatically handles:
  // - Password hashing (Scrypt)
  // - Session management (DB + Cookies)
  // - JWT signing
  realm = $userRealm({
    secret: process.env.APP_SECRET,
    settings: {
      registrationAllowed: true,
      emailRequired: true,
    }
  });
}
```

## 2. Login Providers

Now you need a way to get into that realm. We use the `$auth` primitive for this.

```typescript
import { $authGoogle, $authCredentials } from "alepha/server/auth";

class AuthProviders {
  // Standard Username/Password flow
  credentials = $authCredentials(this.authSystem.realm);

  // Google OAuth2
  google = $authGoogle(this.authSystem.realm, {
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  });
}
```

Once these are registered, Alepha automatically creates the necessary endpoints:
*   `/api/oauth/login?provider=google`
*   `/api/oauth/callback`
*   `/api/_auth/token` (for credentials)

## 3. Protecting Routes

To protect an endpoint, you just tell the `$action` who is allowed in.

```typescript
class UserApi {
  // Only logged-in users can see this
  getProfile = $action({
    path: "/me",
    // 'secure: true' means "User must be logged in"
    secure: true,
    handler: async ({ user }) => {
      return user;
    }
  });

  // Only admins can delete things
  deleteEverything = $action({
    path: "/nuke",
    secure: {
      // You can define permissions in your SecurityProvider
      permission: "system:delete"
    },
    handler: async () => {
      // ...
    }
  });
}
```

## 4. Frontend Integration

On the client (React), you don't need to manage tokens manually. Alepha handles the cookies for you.

```tsx
import { useAuth } from "@alepha/react/auth";

const LoginButton = () => {
  const auth = useAuth();

  if (auth.user) {
    return <div>Welcome, {auth.user.name}</div>;
  }

  return (
    <button onClick={() => auth.login("google")}>
      Sign in with Google
    </button>
  );
};
```

That's it. No complex contexts, no interceptors. It just works.
```

---

### File: `docs/1-guides/7-realtime.md`

```markdown
# Real-time (WebSockets)

WebSockets are usually a pain. You have to manage connections, handle disconnections, figure out how to route messages, and somehow keep your types in sync between the server and client.

Alepha introduces the concept of **Channels** to solve this.

## 1. Define a Channel

A `$channel` is like a contract. It defines *what* can be sent and *what* can be received. It lives in your code, so both backend and frontend can import it.

```typescript
import { t } from "alepha";
import { $channel } from "alepha/websocket";

export const chatChannel = $channel({
  path: "/ws/chat",
  schema: {
    // Messages the Client sends to the Server
    out: t.object({
      content: t.text(),
    }),
    // Messages the Server sends to the Client
    in: t.object({
      user: t.text(),
      content: t.text(),
      timestamp: t.number()
    }),
  }
});
```

## 2. Server Implementation

On the server, you use `$websocket` to implement the logic.

```typescript
import { $websocket } from "alepha/websocket";

class ChatServer {
  socket = $websocket({
    channel: chatChannel,
    handler: async ({ message, reply, connectionId }) => {
      // 'message' is typed as { content: string }

      // Broadcast to everyone in the room
      await reply({
        message: {
          user: `User ${connectionId}`,
          content: message.content,
          timestamp: Date.now()
        },
        // Don't echo back to sender
        exceptSelf: true
      });
    }
  });
}
```

## 3. Client Implementation

On the frontend, use the `useRoom` hook.

```tsx
import { useRoom } from "@alepha/react/websocket";

const ChatRoom = ({ roomId }) => {
  const [messages, setMessages] = useState([]);

  const chat = useRoom({
    channel: chatChannel,
    roomId: roomId,
    handler: (msg) => {
      // 'msg' is fully typed here!
      setMessages(prev => [...prev, msg]);
    }
  }, []);

  return (
    <div>
      {messages.map(m => <div>{m.user}: {m.content}</div>)}

      <button onClick={() => chat.send({ content: "Hello!" })}>
        Send
      </button>
    </div>
  );
};
```

## Scaling?

"But what if I have multiple servers?"

Alepha handles this. The `$websocket` primitive uses the internal Event Bus (`$topic`). If you configure a Redis provider, Alepha automatically broadcasts messages across all your server instances.

You write the code once. It works on one server. It works on ten servers.
```

---

### File: `docs/1-guides/8-deployment.md`

```markdown
# Deployment

You've built your app. Now you need to put it somewhere.
Alepha applications compile down to a standard Node.js app, but we optimize the output structure for different targets.

## The Build Command

```bash
npx alepha build
```

This command does a lot:
1.  Compiles your backend code.
2.  Compiles your frontend code (Vite).
3.  Optimizes assets.
4.  Generates a `dist/` folder.

## Target: Docker / VPS

If you want to run on a VPS (DigitalOcean, Hetzner, AWS EC2) or a container platform (Fly.io, ECS), Alepha generates a `Dockerfile` for you automatically in the `dist/` folder.

```bash
# 1. Build
npx alepha build --docker

# 2. Build image
docker build -t my-app ./dist

# 3. Run
docker run -p 3000:3000 -e DATABASE_URL=... my-app
```

The generated Docker image is extremely lightweight because we prune `node_modules` to only include production dependencies.

## Target: Vercel (Serverless)

Alepha works natively with Vercel. When you build with the `--vercel` flag, we generate the specific `.vercel` output directory structure required by their platform.

```bash
# Build for Vercel
npx alepha build --vercel
```

Your `$action`s become Serverless Functions.
Your `$page`s become SSR functions.
Your `$static` files become CDN assets.

## Environment Variables

Alepha loads environment variables from `.env` files during development.
In production, `Alepha.create()` reads from the system environment variables (`process.env`).

Always ensure your production environment has:
*   `NODE_ENV=production`
*   `APP_SECRET` (A long random string for signing cookies)
*   `DATABASE_URL`
```

---

### File: `docs/2-concepts/7-dependency-injection.md`

```markdown
# Dependency Injection (DI)

Alepha uses a Service Locator pattern wrapped in a strictly typed container.
If you come from Java (Spring) or Angular, this will feel familiar. If you come from Express, this might feel new.

## Why do we need this?

1.  **Testing:** You can swap a real database for an in-memory mock without changing your business logic code.
2.  **Singleton Management:** You don't want to open 50 connections to Redis. You want one connection shared across the app.
3.  **Organization:** It forces you to structure your code into logical units (Services) rather than a mess of loose functions.

## Injecting Services (`$inject`)

In Alepha, you don't use `constructor(private service: Service)`. You use `$inject`.

```typescript
import { $inject } from "alepha";
import { Database } from "./Database";

class UserService {
  // Alepha resolves this dependency lazily when the app starts
  db = $inject(Database);

  async get(id: string) {
    return this.db.users.findById(id);
  }
}
```

## Swapping Implementations

Let's say you have an `EmailProvider`.

```typescript
export class EmailProvider {
  async send(to: string, body: string) {
    // Send via SMTP
  }
}
```

In development, you don't want to spam real emails. You want to log them to the console.

```typescript
export class ConsoleEmailProvider extends EmailProvider {
  async send(to: string, body: string) {
    console.log(`[EMAIL TO ${to}]: ${body}`);
  }
}
```

In your `main.ts`:

```typescript
const app = Alepha.create();

if (process.env.NODE_ENV === 'development') {
  // Magic!
  // Everywhere 'EmailProvider' is injected, 'ConsoleEmailProvider' will be used instead.
  app.with({
    provide: EmailProvider,
    use: ConsoleEmailProvider
  });
}

run(app);
```

## Lifecycle Hooks

Services in Alepha have a lifecycle. You can hook into it using `$hook`.

*   `configure`: Setup configuration, read env vars.
*   `start`: Connect to databases, open ports.
*   `ready`: App is live, start cron jobs.
*   `stop`: Graceful shutdown, close connections.

```typescript
class Database {
  onStart = $hook({
    on: "start",
    handler: async () => {
      console.log("Connecting to DB...");
      await this.client.connect();
    }
  });

  onStop = $hook({
    on: "stop",
    handler: async () => {
      await this.client.close();
    }
  });
}
```

You don't call these manually. `run(alepha)` handles the orchestration for you.

---

### File: `docs/2-concepts/8-project-structure.md`

# Project Structure

Alepha is opinionated about how code *runs*, but fairly loose about how files are *organized*. However, we recommend a structure that scales well from small apps to large monoliths.

## The "Standard" Structure

When you run `alepha init`, we set up something like this:

```
├── src/
│   ├── main.server.ts      # Entry point for the backend
│   ├── main.browser.ts     # Entry point for the frontend
│   ├── AppRouter.ts        # Routes ($page) definition
│   │
│   ├── modules/            # Your feature domains
│   │   ├── auth/
│   │   │   ├── AuthController.ts  # API Actions ($action)
│   │   │   ├── AuthService.ts     # Business Logic
│   │   │   ├── UserEntity.ts      # DB Schema ($entity)
│   │   │   └── index.ts           # Module definition ($module)
│   │   │
│   │   └── billing/
│   │       └── ...
│   │
│   ├── ui/                 # React Components
│   │   ├── layout/
│   │   └── pages/
│   │
│   └── shared/             # Code shared between front and back
│
└── package.json
```

## Organizing by Feature (Vertical Slices)

We strongly recommend organizing by **Feature**, not by Type.

**❌ Bad (Layered):**
```
src/
controllers/
AuthController.ts
BillingController.ts
services/
AuthService.ts
BillingService.ts
entities/
User.ts
Invoice.ts
```

**✅ Good (Vertical/Modular):**
```
src/
modules/
auth/
AuthController.ts
AuthService.ts
User.ts
billing/
BillingController.ts
BillingService.ts
Invoice.ts
```

Why? Because when you work on "Billing", you want everything related to Billing in one place. You don't want to jump between 4 different folders.

Alepha's `$module` primitive supports this pattern natively. You can encapsulate an entire feature (API, DB, Cron jobs, etc.) into a single module export.

```typescript
// src/modules/billing/index.ts
export const BillingModule = $module({
  name: "app.billing",
  services: [
    BillingController,
    BillingService,
    // ...
  ]
});
```
