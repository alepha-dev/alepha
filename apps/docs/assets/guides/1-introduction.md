## What is Alepha?

The name "Alepha" is a play on the mathematical concept of *Aleph numbers* (א),
which represent infinite sets. With a feminine "a" suffix,
it embodies the idea of creating boundless possibilities from a strong, elegant foundation.

At its core, **Alepha is an opinionated,
class-based framework for building full-stack TypeScript applications with React, Drizzle, and Vite.**
Alepha is designed from the ground up to provide a cohesive development experience,
where conventions guide you and type safety protects you,
from your database schema all the way to your frontend components.

### The Motivation Behind Alepha

Years of project development with various tools revealed a recurring pattern: wiring up the same modules,
configuring React server connections, and building custom dependency injection systems to handle required modularity. Every project evolved into a heavily customized, in-house framework.

Alepha is the consolidation of those patterns—a cohesive,
opinionated framework built to solve these real-world problems.

## A Modern, Integrated Foundation

Alepha is not a wrapper around existing libraries like Express or Fastify.
Started in 2024, it is a fresh take on modern backend development.
The framework builds for the future of the platform,
targeting **Node.js 22+** to leverage the latest features of the runtime.

The entire ecosystem is built with a single goal: to let you write less boilerplate and ship more features.

### An Opinionated Stack, Not a Box of Parts

While much of Alepha is a fresh rewrite, it also stands on the shoulders of giants. The framework's philosophy is to build where unique value can be added and integrate where it makes sense. To provide a seamless, end-to-end typed experience, Alepha is built upon a mandatory foundation of three exceptional tools:

1.  **[React](https://react.dev/) for UIs:** The `@alepha/react` package provides a powerful routing and data-fetching system inspired by the golden era of Next.js—before Server Components. It offers a straightforward and effective model for building Server-Side Rendered (SSR) applications.
    > **Note:** Alepha does not implement and has no plans to implement the `"use client"` or `"use server"` directives. The framework is built on a simpler, more direct model for full-stack development.

2.  **[Drizzle ORM](https://orm.drizzle.team/) for Databases:** Alepha uses Drizzle as its foundation for database interaction. You can use Drizzle's powerful query builder directly, or leverage Alepha's type-safe repository layer (`$repository`), which provides a streamlined and integrated experience for PostgreSQL and SQLite.

3.  **[Vite](https://vitejs.dev/) for Building:** Alepha applications are built and bundled using Vite. The `@alepha/vite` plugin provides a seamless build process for both your server and client code, with out-of-the-box support for deploying to Docker or Serverless.

These three technologies are not optional pillars; they are the core of the Alepha experience.

## Platform Support

Alepha is optimized for Node.js but also runs seamlessly on Bun. While a native Bun integration is planned for the future, the current version performs robustly in the Bun runtime.

Many packages, especially `@alepha/react`, are designed for both server and browser environments, making it a true full-stack solution.
