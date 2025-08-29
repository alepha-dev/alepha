## Getting Started

Welcome to Alepha! This guide will walk you through creating your first Alepha application in just a few minutes, demonstrating how easily it integrates into any modern TypeScript project.

### Prerequisites

All you need is a modern JavaScript runtime. Alepha is built and optimized for **Node.js 22+** or the latest version of **Bun**.

*   [Install Node.js](https://nodejs.org/)
*   [Install Bun](https://bun.sh/)

If you're new to TypeScript, don't worry! Alepha is designed to be beginner-friendly, and this guide will help you get started without any prior experience.

### 1. Project Setup

Let's begin by creating a new project directory and initializing it.

```bash
mkdir my-alepha-app
cd my-alepha-app
```

Next, we'll install Alepha as dependency.

```bash
# Install the all-in-one Alepha package
npm install alepha
```

### 2. Configure TypeScript

Alepha is a TypeScript-first framework. Create a `tsconfig.json` file in your project root with the following configuration. This minimal setup enables modern module resolution and JSX support.

**`tsconfig.json`**
```json
{
  "compilerOptions": {
    "module": "nodenext",
    "target": "esnext",
    "strict": true,
    "jsx": "react-jsx"
  }
}
```

You'll also need to update your `package.json` to specify that your project uses ES Modules. Add the following line:

**`package.json`**
```json
{
  "type": "module"
}
```

### 3. Create Your First Server

Now for the fun part! Create an `src/index.ts` file. This will be the entry point for your application.

We'll define a simple server with a single route that responds with "Hello World!". Notice that we are using standard TypeScript classes and methods—**no decorator shims or complex syntax required.**

**`src/index.ts`**
```typescript
import { run } from "alepha";
import { $route } from "alepha/server";

class Server {
  // the $route descriptor declares a new HTTP endpoint
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
> `$route` is a _descriptor_, a factory function usable only in Alepha Context.</br>
> You can learn more about descriptors in the [dedicated page](/docs/descriptors).

That's all it takes to write a complete, working web server. Alepha plugs into your project with zero fuss.

### 4. Run Your Application

You're all set. You can run your server directly with Node.js or Bun. No extra build steps or runtime tools are needed for development.

**Using Node.js:**
```bash
node src/index.ts
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

Voilà! 🎉 You have successfully created and run your first Alepha application using just your runtime's native capabilities.
