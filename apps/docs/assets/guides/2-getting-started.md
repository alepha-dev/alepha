## Getting Started

This guide will walk you through creating your first Alepha application in just a few minutes, demonstrating how easily it allows you to build any kind of application within a modern TypeScript project.

### Prerequisites

All you need is a modern JavaScript runtime. Alepha is built and optimized for **Node.js 22+**.

*   [Install Node.js](https://nodejs.org/)

If you're new to TypeScript, don't worry! Alepha is designed to be beginner-friendly, and this guide will help you get started without any prior experience.

### Project Setup

Let's begin by creating a new project directory and initializing it.

```bash
mkdir my-app
cd my-app
```

Next, we'll use Alepha CLI to create the required configuration files.

```bash
npx alepha init --api
```

### Create Your First Server

Now for the fun part! Create an `src/main.ts` file. This will be the entry point for your application.

We'll define a simple server with a single route that responds with "Hello World!".

Notice that we are using standard TypeScript classes and methods—**no decorator shims or complex syntax required.**

```typescript
// src/main.ts
import { run } from "alepha";
import { $route } from "alepha/server";

class Server {
  // the $route primitive declares a new HTTP endpoint
  // by default, it's a GET request
  hello = $route({
    path: "/",
    handler: () => "Hello World!",
  });
}

// the run function initializes the Alepha application
// and starts the server
run(Server);
```

> **Note:** Did you notice the `$` on `$route`  ?</br>
> `$route` is a _primitive_, a factory function usable only in Alepha Context.</br>
> You can learn more about primitives in the [dedicated page](/docs/primitives).

That's all it takes to write a complete, working web server. Alepha plugs into your project with zero fuss.

### Run Your Application

You're all set. You can run your server directly with Node.js or Bun. No extra build steps or runtime tools are needed for development.

**Using Node.js:**
```bash
node src/main.ts
```

But for development, it's better to use `alepha dev`, which provides hot-reloading and other niceties.
It's also mandatory when working with `@alepha/react` package, as TSX files are not natively supported by Node.js yet.

```bash
npx alepha dev
```

You should see a message indicating that the server has started:

```
[22:05:51.123] INFO <alepha.core.Alepha>: Starting App...
[22:05:51.160] INFO <alepha.server.NodeHttpServerProvider>: Server listening on http://localhost:3000
[22:05:51.160] INFO <alepha.core.Alepha>: App is now ready [37ms]
```

Now, open your web browser or use a tool like `curl` to access the endpoint:

```bash
curl http://localhost:3000
```

You should see the response: `Hello World!`

Voilà! You have successfully created and run your first Alepha application using just your runtime's native capabilities.

## Building for Production

When you're ready to deploy your application, you can build it for production using the Alepha CLI:

```bash
npx alepha build
```

This command will compile your TypeScript code and prepare it for deployment.

By default, output is generic, but you can also target specific platforms like Docker or Vercel.
