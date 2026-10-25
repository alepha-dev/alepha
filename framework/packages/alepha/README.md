<div align="center">
<h1>
<img
  src="https://raw.githubusercontent.com/alepha-dev/alepha/main/packages/alepha/assets/logo.svg"
  width="128"
  height="128"
  alt="Alepha logo"
  valign="middle"
/>
Alepha
</h1>
<a href="https://www.npmjs.com/package/alepha"><img src="https://img.shields.io/npm/v/alepha.svg" alt="npm version"/></a>
<a href="https://www.npmjs.com/package/alepha"><img src="https://img.shields.io/npm/l/alepha.svg" alt="license"/></a>
<a href="https://www.npmjs.com/package/alepha"><img src="https://img.shields.io/npm/dt/alepha.svg" alt="downloads"/></a>
</div>

Alepha is a full-stack TypeScript framework: database, API, jobs and React with SSR. Your code never names its host, so the same build ships to Cloudflare Workers or to a container on any machine.

## 1. Create a project

```bash
npx alepha init my-app --infra cf
cd my-app
npx alepha dev
```

## 2. Add some code

A table, an API and a page. Typed end to end, no codegen.

```tsx
// src/Api.ts
import { z } from "alepha";
import { $entity, $repository, db } from "alepha/orm";
import { $action } from "alepha/server";

const views = $entity({
  name: "views",
  schema: z.object({ id: db.primaryKey(), createdAt: db.createdAt() }),
});

export class Api {
  views = $repository(views);

  inc = $action({
    method: "POST",
    path: "/inc",
    schema: { response: z.object({ count: z.number() }) },
    handler: async () => {
      await this.views.create({});
      return { count: await this.views.count() };
    },
  });
}
```

```tsx
// src/AppRouter.tsx
import { $page } from "alepha/react/router";
import { $client } from "alepha/server/links";

import type { Api } from "./Api.ts";

export class AppRouter {
  api = $client<Api>();

  home = $page({
    loader: () => this.api.inc(),
    component: (props) => <div>Views: {props.count}</div>,
  });
}
```

## 3. Deploy anywhere

Declare where it runs:

```ts
// alepha.config.ts
import { defineConfig } from "alepha/cli/config";
import { cloudflare, infra } from "alepha/cli/infra";

export default defineConfig({
  build: { runtime: ["node", "workerd"] },
  plugins: [
    infra({
      environments: {
        production: cloudflare(),
      },
    }),
  ],
});
```

**Cloudflare.** One command authenticates, provisions the database, bucket and queues, builds, runs migrations, deploys and pushes secrets.

```bash
npx alepha deploy
```

**Docker.** The same build becomes a container image, for any host that runs one.

```bash
npx alepha build
npx alepha image
```

The code above did not change. What sits underneath it did:

| Primitive     | On Cloudflare            | In Docker                                      |
| ------------- | ------------------------ | ---------------------------------------------- |
| `$repository` | D1                       | SQLite, or Postgres with `alepha/orm/postgres` |
| `$storage`    | R2                       | S3 (`S3_ENDPOINT`) or the local disk           |
| `$job`        | Queues and Cron Triggers | Redis (`REDIS_URL`) or in-process              |
| `$cache`      | Cache API or KV          | Redis (`REDIS_URL`) or memory                  |

Start on Cloudflare's free tier, move to your own server when the bill says so, or run both. Leaving is a flag, not a rewrite.

## Start with your agent

<details>
<summary>A prompt for Claude Code, or any coding agent</summary>

```text
Read https://alepha.dev/llms.txt, then create an Alepha app in ./my-app with
`npx alepha init my-app --infra cf`. Add a page that counts its views in the
database, run it with `npx alepha dev`, and tell me how to deploy it.
```

</details>

## Learn more

- [Documentation](https://alepha.dev)
- [llms.txt](https://alepha.dev/llms.txt): the whole API, for your AI assistant
- [Contributing](https://github.com/alepha-dev/alepha/blob/main/.github/CONTRIBUTING.md)
