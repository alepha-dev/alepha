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
│   ├── controllers/        # API Controllers ($action)
│   ├── services/           # Business Logic
│   ├── entities/           # DB Schemas ($entity)
│   ├── schemas/            # Validation Schemas (Zod)
│   ├── providers/          # Custom Providers
│   ├── atoms/              # Shared State (Jotai)
│   │
│   ├── components/         # React Components
│   └── styles/             # CSS Styles
│
└── package.json
```

This is a minimalist structure for small projects. Alepha uses a **layered** organization by type—all controllers together, all entities together, etc.

## Scaling with Modules

As your project grows, add a module layer to group related features:

```
├── src/
│   ├── main.server.ts
│   ├── main.browser.ts
│   │
│   ├── users/
│   │   ├── controllers/
│   │   ├── services/
│   │   ├── entities/
│   │   ├── schemas/
│   │   └── index.ts          # UsersModule
│   │
│   ├── billing/
│   │   ├── controllers/
│   │   ├── services/
│   │   ├── entities/
│   │   ├── schemas/
│   │   └── index.ts          # BillingModule
│   │
│   └── shared/
│       ├── components/
│       └── styles/
│
└── package.json
```

Each module exports a `$module` that groups its services:

```typescript
// src/users/index.ts
export const MyappUsers = $module({
  name: "myapp.users",
  services: [
    UserController,
    UserService,
    // ...
  ]
});
```

You can also separate by concern (frontend/backend):

```
├── src/
│   ├── backend/
│   │   ├── controllers/
│   │   ├── services/
│   │   └── entities/
│   │
│   ├── frontend/
│   │   ├── components/
│   │   ├── atoms/
│   │   └── styles/
│   │
│   └── shared/
│       └── schemas/
│
└── package.json
```

The layered structure stays the same—you just add a directory level to organize by module or concern.
