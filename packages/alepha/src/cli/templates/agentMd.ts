export interface AgentMdOptions {
  react?: boolean;
  ui?: boolean;
  projectName?: string;
}

export type AgentMdType = "claude" | "agents";

export const agentMd = (
  type: AgentMdType,
  options: AgentMdOptions = {},
): string => {
  const { react = false, projectName = "my-app" } = options;

  const header =
    type === "claude"
      ? `# CLAUDE.md

This file provides guidance to Claude Code when working with this Alepha project.`
      : `# AGENTS.md

This file provides guidance to AI coding assistants when working with this Alepha project.`;

  const reactSection = react
    ? `
## React & Frontend

### Pages with \`$page\`
\`\`\`tsx
import { t } from "alepha";
import { $page } from "alepha/react/router";
import { $client } from "alepha/server/links";
import type { UserController } from "./UserController.ts";

class AppRouter {
  api = $client<UserController>();

  users = $page({
    path: "/users",
    loader: async () => ({ users: await this.api.listUsers() }),
    component: ({ users }) => (
      <ul>{users.map(u => <li key={u.id}>{u.email}</li>)}</ul>
    ),
  });

  userDetail = $page({
    path: "/users/:id",
    schema: { params: t.object({ id: t.uuid() }) },
    loader: async ({ params }) => ({ user: await this.api.getUser({ params }) }),
    lazy: () => import("./UserDetail.tsx"), // Code splitting
  });
}
\`\`\`

### React Hooks
\`\`\`typescript
import { useAlepha, useClient, useStore, useAction, useInject } from "alepha/react";
import { useRouter, useActive } from "alepha/react/router";
import { useForm } from "alepha/react/form";
\`\`\`

- \`useClient<Controller>()\` - Type-safe API calls
- \`useStore(atom)\` - Global state (returns \`[value, setValue]\`)
- \`useAction({ handler })\` - Async operations with loading/error state
- \`useRouter<AppRouter>()\` - Type-safe navigation
- \`useForm({ schema, handler })\` - Type-safe forms with validation
`
    : "";

  const projectStructure = react
    ? `
\`\`\`
${projectName}/
├── src/
│   ├── api/              # Backend
│   │   ├── controllers/  # API controllers with $action
│   │   ├── services/     # Business logic
│   │   ├── entities/     # Database entities with $entity
│   │   ├── providers/    # External service wrappers
│   │   └── index.ts      # API module definition with $module
│   ├── web/              # Frontend (React only)
│   │   ├── components/   # React components
│   │   ├── atoms/        # State atoms with $atom
│   │   ├── AppRouter.ts  # Routes with $page
│   │   └── index.ts      # Web module definition with $module
│   ├── main.server.ts    # Server entry
│   ├── main.browser.ts   # Browser entry (React only)
│   └── main.css          # CSS entry (React only)
├── package.json
└── tsconfig.json
\`\`\`
`
    : `
\`\`\`
${projectName}/
├── src/
│   ├── api/              # Backend
│   │   ├── controllers/  # API controllers with $action
│   │   ├── services/     # Business logic
│   │   ├── entities/     # Database entities with $entity
│   │   ├── providers/    # External service wrappers
│   │   └── index.ts      # API module definition with $module
│   └── main.server.ts    # Server entry (always use main.server.ts)
├── package.json
└── tsconfig.json
\`\`\`
`;

  return `${header}

## Overview

This is an **Alepha** project - a convention-driven TypeScript framework for type-safe full-stack applications.

**Key Concepts:**
- **Primitives**: Features defined with \`$\`-prefixed functions (\`$action\`, \`$entity\`, \`$page\`)
- **Class-Based**: Services are classes, primitives are class properties
- **Zero-Config**: Code structure IS the configuration
- **End-to-End Types**: Types flow from database → API → ${react ? "React" : "client"}

## Rules

- Use TypeScript strict mode, always check types (\`alepha typecheck\`)
- Use Biome for formatting (\`alepha lint\`)
- Use Vitest for testing (\`alepha test\`)
- One file = one class, multiple interfaces/types allowed
- Primitives are class properties (except \`$entity\`, \`$atom\`)
- No decorators, no Express/Fastify patterns
- No manual instantiation - use dependency injection
- Use \`protected\` instead of \`private\` for class members
- Import with file extensions: \`import { User } from "./User.ts"\`
- Use \`t\` from Alepha for schemas (not Zod)
- Prefer \`t.text()\` over \`t.string()\` for user input (has default max length, auto-trim, supports lowercase option)
- One file = one schema (schemas/createUserSchema.ts)

## Project Structure
${projectStructure}
## Core Primitives

### API with \`$action\`
\`\`\`typescript
import { t } from "alepha";
import { $action } from "alepha/server";

class UserController {
  getUser = $action({
    path: "/users/:id",  // → GET /api/users/:id
    schema: {
      params: t.object({ id: t.uuid() }),
      response: t.object({ id: t.uuid(), email: t.email() }),
    },
    handler: async ({ params }) => this.userRepo.findById(params.id),
  });

  createUser = $action({
    // POST inferred from body schema
    schema: {
      body: t.object({ email: t.email() }),
      response: userEntity.schema,
    },
    handler: async ({ body }) => this.userRepo.create(body),
  });
}
\`\`\`

### Database with \`$entity\` and \`$repository\`
\`\`\`typescript
import { $entity, $repository, db } from "alepha/orm";

// Entity defined at module level (for drizzle-kit compatibility)
export const userEntity = $entity({
  name: "users",
  schema: t.object({
    id: db.primaryKey(),
    email: t.email(),
    createdAt: db.createdAt(),
  }),
  indexes: [{ column: "email", unique: true }],
});

class UserService {
  userRepository = $repository(userEntity);
}
\`\`\`

### Dependency Injection
\`\`\`typescript
import { $inject } from "alepha";

class OrderService {
  userService = $inject(UserService);  // Within same module
}

// Cross-module: use $client instead of $inject
class AppRouter {
  api = $client<OrderController>();  // Type-safe HTTP client
}
\`\`\`

### Environment Variables
\`\`\`typescript
import { $env, t } from "alepha";

class AppConfig {
  env = $env(t.object({
    DATABASE_URL: t.string(),
    API_KEY: t.optional(t.string()),
  }));
}
\`\`\`
${reactSection}
## Quick Reference

| Primitive | Import | Purpose |
|-----------|--------|---------|
| \`$inject\` | \`alepha\` | Dependency injection |
| \`$env\` | \`alepha\` | Environment variables |
| \`$hook\` | \`alepha\` | Lifecycle hooks |
| \`$logger\` | \`alepha/logger\` | Structured logging |
| \`$action\` | \`alepha/server\` | REST API endpoints |
| \`$route\` | \`alepha/server\` | Low-level HTTP routes |
| \`$entity\` | \`alepha/orm\` | Database tables |
| \`$repository\` | \`alepha/orm\` | Type-safe data access |
| \`$queue\` | \`alepha/queue\` | Background jobs |
| \`$scheduler\` | \`alepha/scheduler\` | Cron tasks |
| \`$cache\` | \`alepha/cache\` | Cached computations |
| \`$bucket\` | \`alepha/bucket\` | File storage |
| \`$issuer\` | \`alepha/security\` | JWT tokens |
| \`$command\` | \`alepha/command\` | CLI commands |${
    react
      ? `
| \`$page\` | \`alepha/react/router\` | React pages with SSR |
| \`$atom\` | \`alepha\` | Global state |`
      : ""
  }

## Testing

\`\`\`typescript
import { describe, it, expect } from "vitest";
import { Alepha } from "alepha";

describe("UserService", () => {
  it("should create user", async () => {
    const alepha = Alepha.create().with(UserService);
    const service = alepha.inject(UserService);
    await alepha.start();

    const user = await service.create({ email: "test@example.com" });
    expect(user.email).toBe("test@example.com");
  });

  it("should mock dependencies", async () => {
    const alepha = Alepha.create()
      .with(OrderService)
      .with({ provide: PaymentGateway, use: MockPaymentGateway });

    const service = alepha.inject(OrderService);
    // PaymentGateway is now mocked
  });
});
\`\`\`

## Common Mistakes

1. **DON'T use decorators** - Use primitives (\`$action\`, not \`@Get()\`)
2. **DON'T use Zod** - Use TypeBox via \`t\` from Alepha
3. **DON'T use Express patterns** - No \`app.get()\`, \`router.use()\`
4. **DON'T inject across modules** - Use \`$client\` for cross-module calls
5. **DON'T use async constructors** - Use \`$hook({ on: "start" })\`
6. **DON'T instantiate manually** - Let DI container manage instances

## After Code Changes

Always run:
\`\`\`bash
alepha lint      # Format and lint
alepha typecheck # Type checking
alepha test      # Run tests (if applicable)
alepha build     # Build the project
\`\`\`

## Documentation

- Full docs: https://alepha.dev/llms.txt
- Detailed docs: https://alepha.dev/llms-full.txt

## Source Code Access

Full framework source available at \`node_modules/alepha/src/\`.

**IMPORTANT:** When answering questions about Alepha primitives, APIs, or internals:
1. ALWAYS read the local source code first at \`node_modules/alepha/src/\` or \`node_modules/@alepha/ui/src/\` for UI-related questions
2. Use \`Glob\` to find relevant files: \`node_modules/alepha/src/**/primitives/$<name>.ts\`
3. Read the implementation AND the \`.spec.ts\` test files for usage examples
4. Use external documentation as a fallback if source code is insufficient
`.trim();
};
