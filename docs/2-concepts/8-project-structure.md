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

**Bad (Layered):**
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

**Good (Vertical/Modular):**
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
