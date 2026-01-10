# Introduction

Welcome to Alepha.

If you are reading this, you are probably tired. Tired of spending the first two weeks of every project configuring ESLint, choosing a router, wiring up an ORM, figuring out how to share types between your frontend and backend, and debugging Dockerfiles.

We built Alepha because we wanted to stop building "stacks" and start building **products**.

## What is Alepha?

Alepha is an integrated, opinionated, full-stack framework for **Node.js 22+** and **Bun**.

> **Bun-Native Support**
>
> We're working to make Alepha fully Bun-native. When running on Bun, we automatically use Bun's built-in APIs (file system, SQLite, HTTP server, etc.) instead of Node.js equivalents for better performance.

It is not a wrapper around Express or Fastify. It is not just a React meta-framework like Next.js. It is a complete **SaaS Operating System**.

It assumes that if you are building a modern application, you *will* need:
*   A database (Postgres/SQLite)
*   An API (REST)
*   Authentication & Permissions
*   Background Jobs & Queues
*   File Storage
*   A frontend (React)

In other frameworks, you have to assemble these pieces yourself. In Alepha, they are built-in primitives.

## The "Primitive" Architecture

Alepha doesn't use decorators (like NestJS) or file-system magic (like Next.js). Instead, we use **Primitives**. These are factory functions starting with `$` that live directly in your class properties.

You define your logic where it belongs: in your code.

```typescript
import { t } from "alepha";
import { $action } from "alepha/server";
import { $entity, db } from "alepha/orm";

// 1. Define your Database Schema
const product = $entity({
  name: "products",
  schema: t.object({
    id: db.primaryKey(t.uuid()),
    price: t.number(),
    name: t.text()
  })
});

class ProductService {
  repo = $repository(product);

  // 2. Define your API Endpoint
  create = $action({
    method: "POST",
    path: "/products",
    schema: {
      body: t.pick(product.schema, ['name', 'price']),
      response: product.schema
    },
    handler: async ({ body }) => {
      // 3. Business Logic
      return await this.repo.create(body);
    }
  });
}
```

Because Alepha understands what these Primitives are, it gives you superpowers for free:
1.  **Automatic OpenAPI/Swagger** documentation.
2.  **End-to-End Type Safety** without code generation steps.

## The "Zero-Mapping" Philosophy

The biggest source of bugs in full-stack development is the boundary between the server and the client.

Usually, you define a SQL schema, then a Zod schema for the API, then a TypeScript interface for the frontend. If you change one, you break the others.

Alepha uses **TypeBox** as a single source of truth.
*   The `$entity` uses the schema to create the database table.
*   The `$action` uses the *same* schema to validate the HTTP request.
*   The React `$page` uses the *same* schema to type your props.

Data flows from your database to your React component without ever losing its type information or requiring a manual mapping layer.

## Infrastructure as Code (Literally)

Alepha takes the "Batteries Included" concept seriously.

*   Need a background job? Use `$queue`.
*   Need to upload a file? Use `$bucket`.
*   Need a cron job? Use `$scheduler`.
*   Need to verify an email? Use the built-in `VerificationService`.

When you build for production, Alepha compiles everything into a highly optimized, lightweight bundle that runs anywhere: Vercel, Docker, Cloudflare, or a $5 VPS.

## Built for the AI Era

Alepha is designed to work seamlessly with AI coding assistants like Claude, ChatGPT, Cursor, and GitHub Copilot.

We provide a machine-readable documentation file at [alepha.dev/llms.txt](https://alepha.dev/llms.txt) that AI assistants can consume to understand the entire framework. Point your AI tool to this URL and it will know how to write Alepha code correctly.

> **Why this matters**
>
> AI assistants work best when they understand the conventions of your framework. Alepha's opinionated, primitive-based architecture gives AI tools clear patterns to follow - making AI-assisted development faster and more accurate.

## Who is this for?

Alepha is for the **Pragmatic Developer**.

If you enjoy spending days debating which folder structure is best, or if you need to micro-optimize a specific sub-system with a custom C++ module, Alepha might feel too opinionated for you.

But if you are a solo founder, a small team, or an agency that needs to ship robust, scalable SaaS products in days instead of months, you are home.

Ready to build? Let's get your environment set up.
