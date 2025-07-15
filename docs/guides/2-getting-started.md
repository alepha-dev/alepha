## Getting Started

Welcome to Alepha! This guide will walk you through creating your first Alepha application in just a few minutes, demonstrating how easily it integrates into any modern TypeScript project.

### Prerequisites

All you need is a modern JavaScript runtime. Alepha is built and optimized for **Node.js 22+** or the latest version of **Bun**.

That's it. You don't need `ts-node`, `tsx`, or any other runtime transpilers. Alepha leverages the native capabilities of modern Node.js and Bun.

*   [Install Node.js](https://nodejs.org/)
*   [Install Bun](https://bun.sh/)

### 1. Project Setup

Let's begin by creating a new project directory and initializing it.

```bash
mkdir my-alepha-app
cd my-alepha-app
```

Next, we'll install Alepha and add TypeScript as a development dependency.

```bash
# Install the all-in-one Alepha package
npm install alepha

# Install TypeScript
npm install -D typescript
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
  // ... other properties
  "type": "module"
}
```

### 3. Create Your First Server

Now for the fun part! Create an `index.ts` file. This will be the entry point for your application.

We'll define a simple server with a single route that responds with "Hello World!". Notice that we are using standard TypeScript classes and methods—**no decorator shims or complex syntax required.**

**`index.ts`**
```typescript
import { run } from "alepha";
import { $route } from "alepha/server";

class Server {
  // The $route descriptor declares a new HTTP endpoint.
  // By default, it's a GET request.
  hello = $route({
    path: "/",
    handler: () => "Hello World!",
  });
}

// The run function initializes the Alepha application
// and starts the server.
run(Server);
```

> **Note:** Did you notice the $ on $route ?</br>
> `$route` is a _descriptor_, a powerful factory function usable only in Alepha Context.
> You can learn more about descriptors in the [dedicated page](/docs/descriptors).

That's all it takes to write a complete, working web server. Alepha plugs into your project with zero fuss.

### 4. Run Your Application

You're all set. You can run your server directly with Node.js or Bun. No extra build steps or runtime tools are needed for development.

**Using Node.js:**
```bash
node index.ts
```

**Using Bun:**
```bash
bun run index.ts
```

You should see a message indicating that the server has started:

```
[20:43:12] INFO: Server listening on http://localhost:3000
```

Now, open your web browser or use a tool like `curl` to access the endpoint:

```bash
curl http://localhost:3000
```

You should see the response: `Hello World!`

Voilà! 🎉 You have successfully created and run your first Alepha application using just your runtime's native capabilities.

### Next Steps

You've just scratched the surface. Here’s where you can go from here:
*   Learn how to create more complex APIs in the **[Your First API](./your-first-api.md)** guide.
*   Explore the power of Alepha's type-safe database layer with the **[Database ORM](/packages/postgres/overview.md)** documentation.
*   Dive into building a full-stack application with the **[Full-Stack Tutorial](./full-stack-tutorial.md)**.
