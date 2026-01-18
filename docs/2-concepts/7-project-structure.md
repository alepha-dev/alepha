# Project Structure

Alepha is opinionated about how code *runs*, but fairly loose about how files are *organized*. However, we recommend a structure that scales well from small APIs to large full-stack applications.

## API-Only Projects

For backend-only projects (APIs, microservices, CLI tools):

```
my-api/
├── src/
│   ├── api/                   # Backend code
│   │   ├── controllers/       # API controllers ($action)
│   │   ├── services/          # Business logic
│   │   ├── entities/          # Database schemas ($entity)
│   │   ├── providers/         # External service wrappers
│   │   ├── schemas/           # Shared validation schemas
│   │   └── index.ts           # API module definition ($module)
│   └── main.server.ts         # Entry point (always main.server.ts)
├── package.json
└── tsconfig.json
```

Note: Even for API-only projects, use `main.server.ts` instead of `main.ts`. This keeps things consistent and makes it easy to add a frontend later.

## Full-Stack Projects

For projects with React frontend:

```
my-app/
├── src/
│   ├── api/                   # Backend code
│   │   ├── controllers/       # API controllers ($action)
│   │   ├── services/          # Business logic
│   │   ├── entities/          # Database schemas ($entity)
│   │   ├── providers/         # External service wrappers
│   │   └── index.ts           # API module definition ($module)
│   │
│   ├── web/                   # Frontend code (React only)
│   │   ├── app/               # App-level components
│   │   │   ├── AppRouter.ts   # Routes ($page)
│   │   │   ├── atoms/         # State atoms ($atom)
│   │   │   └── components/    # Shared components
│   │   ├── styles/            # CSS styles
│   │   └── index.ts           # Web module definition ($module)
│   │
│   ├── shared/                # Code shared between api and web
│   │   └── schemas/           # Validation schemas used by both
│   │
│   ├── main.server.ts         # Server entry point
│   └── main.browser.ts        # Browser entry point (React only)
│
├── index.html                 # HTML template (React only)
├── package.json
└── tsconfig.json
```

The `src/web/`, `main.browser.ts`, and `index.html` are only needed when using `@alepha/react` for the frontend.

## Scaling with Modules

As your project grows, add a module layer to group related features:

```
├── src/
│   ├── api/
│   │   ├── users/
│   │   │   ├── controllers/
│   │   │   ├── services/
│   │   │   ├── entities/
│   │   │   └── index.ts       # UsersModule
│   │   │
│   │   ├── billing/
│   │   │   ├── controllers/
│   │   │   ├── services/
│   │   │   ├── entities/
│   │   │   └── index.ts       # BillingModule
│   │   │
│   │   └── shared/
│   │       └── providers/
│   │
│   ├── web/
│   │   ├── app/
│   │   │   └── AppRouter.ts
│   │   └── components/
│   │
│   ├── main.server.ts
│   └── main.browser.ts
│
└── package.json
```

Each module exports a `$module` that groups its services:

```typescript
// src/api/index.ts - Main API module
import { $module } from "alepha";
import { UsersModule } from "./users/index.ts";
import { BillingModule } from "./billing/index.ts";

export const ApiModule = $module({
  name: "app.api",
  services: [UsersModule, BillingModule],
});

// src/api/users/index.ts - Feature module
export const UsersModule = $module({
  name: "app.users",
  services: [
    UserController,
    UserService,
  ]
});

// src/web/index.ts - Web module (React only)
export const WebModule = $module({
  name: "app.web",
  services: [AppRouter, Toaster],
  register(alepha) {
    // Optional: configure additional services or atoms
    alepha.with(SomeUILibrary);
  },
});
```

## Naming Conventions

| Directory | Contains | Example Files |
|-----------|----------|---------------|
| `controllers/` | API endpoints with `$action` | `UserController.ts` |
| `services/` | Business logic | `UserService.ts`, `EmailService.ts` |
| `entities/` | Database schemas with `$entity` | `userEntity.ts` |
| `providers/` | External service wrappers | `StripeProvider.ts` |
| `schemas/` | Shared TypeBox schemas | `userSchema.ts` |
| `atoms/` | State definitions with `$atom` | `currentUserAtom.ts` |
| `components/` | React components | `UserCard.tsx` |
| `index.ts` | Module definition with `$module` | `src/api/index.ts`, `src/web/index.ts` |

## Entry Points

| File | Purpose | When Needed |
|------|---------|-------------|
| `main.server.ts` | Server entry point | Always |
| `main.browser.ts` | Browser entry point | React/full-stack only |
| `index.html` | HTML template | React/full-stack only |

The `main.server.ts` file bootstraps your Alepha application using modules:

```typescript
// src/main.server.ts
import { run } from "alepha";
import { ApiModule } from "./api/index.ts";
import { WebModule } from "./web/index.ts"; // React only

run(ApiModule, WebModule);
```

For React apps, `main.browser.ts` hydrates the client:

```typescript
// src/main.browser.ts
import { hydrate } from "@alepha/react/router";
import { WebModule } from "./web/index.ts";

hydrate(WebModule);
```
