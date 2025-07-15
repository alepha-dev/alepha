## What is Alepha?

The name "Alepha" is a play on the mathematical concept of *Aleph numbers* (א), which represent infinite sets. With a feminine "a" suffix, it embodies the idea of creating boundless possibilities from a strong, elegant foundation.

At its core, **Alepha is an opinionated, class-based framework for building full-stack TypeScript applications.** It's designed from the ground up to provide a cohesive development experience, where conventions guide you and type safety protects you, from your database schema all the way to your frontend components.

### The Motivation Behind Alepha

For years, I built countless projects with Fastify. It's a fantastic, high-performance library that I still use and respect. However, I found myself repeating the same patterns on every new project: plugging in the same modules, wiring up a React server connection, and building a custom dependency injection system to handle the required configuration and modularity.

Every project ended up as a heavily customized "in-house" framework.

In 2024, a large-scale project provided the motivation to consolidate five years of ideas, patterns, and boilerplate into a single, cohesive package. That package is Alepha. It was not built to serve the world or compete with the giants; it was built to be a reusable, opinionated library that solves real-world problems for my projects, and now, for yours.


## A Modern Foundation

Alepha is not a wrapper around existing libraries like Express or Fastify. Started in 2024, it is a fresh take on modern backend development, built on the latest features of **Node.js 22+**. It embraces web standards wherever possible and is designed to be lean, with a minimal footprint in your `node_modules` directory.

The entire ecosystem is built with a single goal: **to let you write less boilerplate and ship more features.**

## Platform Support

Alepha is optimized for Node.js but also runs seamlessly on Bun. While a **native** Bun integration is planned for the future, the current version performs robustly in the Bun runtime.

Many packages, especially `@alepha/react`, are designed for both server and browser environments, making it a true full-stack solution.

## A Curated Ecosystem

Alepha is available as an all-in-one package, `alepha`, which includes all the recommended modules for a powerful, batteries-included experience.

```bash
npm install alepha
```

For developers who prefer a more a-la-carte approach, every component is also available individually under the `@alepha/` scope (e.g., `@alepha/server`, `@alepha/postgres`).

```bash
npm install @alepha/core @alepha/server @alepha/server-swagger
```

## Reinventing the Wheel... Selectively

While much of Alepha is a fresh rewrite, we believe in standing on the shoulders of giants for the parts of the stack that are already solved exceptionally well. Alepha's philosophy is to build where we can add unique value and integrate where it makes sense.

**Our three pillars are:**

1.  **[Drizzle ORM](https://orm.drizzle.team/) for Databases:** Alepha uses Drizzle as its foundation for database interaction. You can use Drizzle's powerful query builder and migration tools directly, or you can use Alepha's type-safe repository layer (`$repository`), which provides a streamlined experience for PostgreSQL and SQLite.

2.  **[React](https://react.dev/) for UIs:** For user interfaces, Alepha is built on React. The `@alepha/react` package provides a powerful routing and data-fetching system inspired by the golden era of Next.js—before Server Components. It offers a straightforward and effective model for building Server-Side Rendered (SSR) applications.
    > **Note:** Alepha does not implement and has no plans to implement the `"use client"` or `"use server"` directives. If this paradigm is essential to your workflow, we recommend staying with Next.js.

3.  **[Vite](https://vitejs.dev/) for Building:** Alepha applications are built and bundled using Vite. The `@alepha/vite` plugin provides a seamless build process for both your server and client code, with out-of-the-box support for deploying to Docker, Vercel, or as a static site on GitHub Pages.

These three pillars are foundational but entirely **optional**. You can use Alepha to build a standalone REST API without React, or use the React components without a database.
