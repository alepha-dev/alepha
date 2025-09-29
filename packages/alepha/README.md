<div align="center">
<h1 >
<img
	src="https://raw.githubusercontent.com/feunard/alepha/main/assets/logo.png"
	width="128"
	height="128"
	alt="Logo"
  valign="middle"
/>
Alepha
</h1>
<p style="max-width: 512px">
</p>
<a href="https://www.npmjs.com/package/alepha"><img src="https://img.shields.io/npm/v/alepha.svg" alt="npm"/></a>
<a href="https://www.npmjs.com/package/alepha"><img src="https://img.shields.io/npm/l/alepha.svg" alt="npm"/></a>
<a href="https://codecov.io/gh/feunard/alepha"><img src="https://codecov.io/gh/feunard/alepha/graph/badge.svg?token=ZDLWI514CP" alt="npm"/></a>
<a href="https://www.npmjs.com/package/alepha"><img src="https://img.shields.io/npm/dt/alepha.svg" alt="npm"/></a>
<a href="https://github.com/feunard/alepha"><img src="https://img.shields.io/github/stars/feunard/alepha.svg?style=social" alt="GitHub stars"/></a>
</div>

A convention-driven TypeScript framework for building type-safe full-stack applications.

## Quick Start

```bash
npx @alepha/cli create my-app
```

Or manually:

```bash
npm install alepha
```

## What is this?

Alepha is an opinionated framework that handles everything from database to frontend. It uses a descriptor-based architecture (`$action`, `$page`, `$repository`, etc.) and enforces type safety across the entire stack.

```ts
import { run } from "alepha";
import { $action } from "alepha/server";

class App {
  hello = $action({
    handler: () => "Hello world!",
  })
}

run(App);
```

## Examples

### Type-safe API endpoint

```ts
import { $action } from "alepha/server";
import { t } from "alepha/core";

class UserController {
  getUser = $action({
    schema: {
      params: t.object({ id: t.string() }),
      response: t.object({
        name: t.string(),
        email: t.string()
      })
    },
    handler: async ({ params }) => {
      return { name: "John", email: "john@example.com" };
    }
  });
}
```

### Database with Drizzle ORM

```ts
import {$entity, $repository, pg} from "alepha/postgres";
import {t, Static} from "alepha";

export const users = $entity({
  id: pg.primaryKey(),
  name: t.string(),
  email: t.string()
});

type CreateUser = Static<typeof users.$insertSchema>;

class UserService {
  users = $repository(users);

  async create(data: CreateUser) {
    return await this.users.create(data);
  }
}
```

### React SSR Page

```tsx
import { $page } from "alepha/react";

class HomePage {
  index = $page({
    component: () => <div>Hello from React SSR!</div>
  });
}
```

## Core Concepts

- **Descriptors**: Define your app logic with `$action`, `$page`, `$repository`, `$cache`, `$email`, etc.
- **Type Safety**: TypeBox schemas validate data from DB to API to frontend
- **DI Container**: Built-in dependency injection using `$inject()`
- **Convention over Config**: Minimal boilerplate, sensible defaults
- **Full-Stack**: React SSR, Vite, class-based router with type-safe routing

## Stack

- Node.js 22+
- TypeScript
- React (SSR)
- Vite
- Drizzle ORM
- PostgreSQL

👉 For more information, please visit the [documentation](https://feunard.github.io/alepha/).

## License

MIT
