# Getting Started

Let's get your hands dirty.

This guide isn't going to ask you to configure Webpack, Babel, or ESLint. Alepha is designed to get out of your way so you can write code.

## Prerequisites

You need a modern JavaScript runtime. Alepha requires **Node.js 22+** or **Bun 1.1+**.

- [Download Node.js](https://nodejs.org/)
- [Download Bun](https://bun.sh/)

> Bun works great with Alepha. However, this documentation uses Node.js and npm in all examples. If you're using Bun, just replace `npm` with `bun` and `npx` with `bunx`.

## Project Setup

Create a new folder for your project. We like to start clean.

```bash
mkdir my-app
cd my-app
```

Now, initialize the project. This command doesn't scaffold a massive bloat of files; it just creates a `package.json` and a `tsconfig.json` configured correctly for Alepha.

```bash
npx alepha init
```

## Your First Server

Alepha uses classes to organize logic. Forget about `app.get()` or `router.use()` chains.

Create a file at `src/main.server.ts`:

```typescript filename="src/main.server.ts"
import { run } from "alepha";
import { $route } from "alepha/server";

class Server {
  // The $route primitive defines an endpoint directly in your class.
  // No mapping files, no separate router configuration.
  hello = $route({
    path: "/",
    handler: () => "Hello World!",
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

You can run your server right now using `alepha dev`.

This gives you:
1.  **Hot Module Replacement (HMR):** Change code, server updates instantly.
2.  **TypeScript Support:** No build step required for dev.
3.  **Pretty Logs:** Readable, structured logging out of the box.

```bash
npx alepha dev
```

You should see the engine starting up:

```
[22:05:51.123] INFO <alepha.core.Alepha>: Starting App...
[22:05:51.160] INFO <alepha.server.NodeHttpServerProvider>: Server listening on http://localhost:3000
[22:05:51.160] INFO <alepha.core.Alepha>: App is now ready [37ms]
```

Open `http://localhost:3000` in your browser. You've just built a server.

### "Can I run it with just Node?"

Yes. Alepha doesn't rely on a magical runner. In production, or for simple scripts, you can run it directly if you compile it first, or use a runtime like `tsx` or `bun`:

```bash
# Works perfectly fine, no lock-in
node src/main.server.ts
```

## Building for Production

When you are ready to ship, don't ship your source code. Build it.

```bash
npx alepha build
```

This produces a `dist/` folder.

Unlike other frameworks that output a mess of files, Alepha (powered by Vite) produces a highly optimized bundle. You can deploy this folder to:
*   **Docker:** We generate the Dockerfile for you.
*   **Vercel:** We adapt the output to Serverless functions automatically.
*   **VPS:** Just run `node dist/index.js`.

## Next Steps

"Hello World" is boring. You want to build a SaaS.

*   **[Build an API](/docs/guides-server-building-an-api):** Learn how to use `$action` to create type-safe endpoints with automatic Swagger docs.
*   **[Connect a Database](/docs/guides-data-database-access):** See how `$entity` creates your tables and types simultaneously.
*   **[Add a Frontend](/docs/guides-frontend-react-integration):** Add React to the mix with `$page`.
