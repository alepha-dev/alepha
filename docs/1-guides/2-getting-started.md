# Getting Started

Let's get your hands dirty.

This guide isn't going to ask you to configure Webpack, Babel, or ESLint. Alepha is designed to get out of your way so you can write code.

## Prerequisites

You need a modern JavaScript runtime. Alepha requires **Node.js 22+** or **Bun 1.1+**.

- [Download Node.js](https://nodejs.org/) *(recommended for beginners)*
- [Download Bun](https://bun.sh/)

## Project Setup

Create a new folder for your project. We like to start clean.

```bash
mkdir my-app
cd my-app
```

Now, initialize the project. This command doesn't scaffold a massive bloat of files; it just creates a `package.json` and a `tsconfig.json` configured correctly for Alepha.

```bash
npx alepha@latest init
```

## Your First Server

Alepha uses classes to organize logic. Forget about `app.get()` or `router.use()` chains.

Let's have a look at entry file.

```typescript filename="src/main.ts"
import { run } from "alepha";
import { $route } from "alepha/server";

class Server {
  // The $route primitive defines an endpoint directly in your class.
  // No mapping files, no separate router configuration.
  hello = $route({
    path: "/",
    handler: () => "Hello, Alepha!",
  });
}

// Run handles the lifecycle, error trapping, and graceful shutdowns.
run(Server);
```

> **Wait, what is `$route`?**
>
> That `$` function is what we call a **Primitive**. It's a factory function that tells Alepha: *"This property isn't just data; it's logic."*
>
> You can learn more about Primitives in the [Concepts](/docs/concepts-primitives) page.

## Running the App

You can run your server right now using `npm run dev`.

This gives you:
1.  **Hot Module Replacement (HMR):** Change code, server updates instantly.
2.  **TypeScript Support:** No build step required for dev.
3.  **Pretty Logs:** Readable, structured logging out of the box.

```bash
npm run dev
```

You should see the engine starting up:

```
[22:05:51.123] INFO <alepha.core.Alepha>: Starting App...
[22:05:51.160] INFO <alepha.server.NodeHttpServerProvider>: Server listening on http://localhost:3000
[22:05:51.160] INFO <alepha.core.Alepha>: App is now ready [37ms]
```

Open `http://localhost:3000` in your browser. You've just built a server.

### "Can I run it with just Node?"

Yes. Alepha doesn't rely on a magical runner.
Behind the scenes, Alepha uses `tsx`, `vite`, or `bun`, depending on what your context.
But you can run it with plain Node or Bun as well.

```bash
# Works perfectly fine, no lock-in
node src/main.ts
bun src/main.ts
```

## Building for Production

When you are ready to ship, don't ship your source code. Build it.

```bash
npm run build
```

This produces a `dist/` folder.

Unlike other frameworks that output a mess of files, Alepha (powered by Vite) produces a highly optimized bundle. You can deploy this folder to:
*   **Docker:** We generate the Dockerfile for you.
*   **Vercel,Cloudflare:** We adapt the output to Serverless functions automatically.
*   **VPS:** Just run `node dist` or `bun dist`.

You can run the production build locally as well:

```bash
node dist # or bun dist
```

## Next Steps

"Hello World" is boring. You want to build a real app.

*   **[Build an API](/docs/guides-server-building-an-api):** Learn how to use `$action` to create type-safe endpoints with automatic Swagger docs.
*   **[Connect a Database](/docs/guides-data-database-access):** See how `$entity` creates your tables and types simultaneously.
*   **[Add a Frontend](/docs/guides-frontend-react-integration):** Add React to the mix with `$page`.
