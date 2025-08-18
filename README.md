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
🚧
</p>
<a href="https://www.npmjs.com/package/alepha"><img src="https://img.shields.io/npm/v/alepha.svg" alt="npm"/></a>
<a href="https://www.npmjs.com/package/alepha"><img src="https://img.shields.io/npm/l/alepha.svg" alt="npm"/></a>
<a href="https://codecov.io/gh/feunard/alepha"><img src="https://codecov.io/gh/feunard/alepha/graph/badge.svg?token=ZDLWI514CP" alt="npm"/></a>
<a href="https://www.npmjs.com/package/alepha"><img src="https://img.shields.io/npm/dt/alepha.svg" alt="npm"/></a>
<a href="https://github.com/feunard/alepha"><img src="https://img.shields.io/github/stars/feunard/alepha.svg?style=social" alt="GitHub stars"/></a>
</div>

Alepha is a convention-driven TypeScript framework for building robust, end-to-end type-safe applications, from serverless APIs to full-stack React apps.

## Installation

```bash
npm install alepha
```

## Usage

Minimalist http server with a single endpoint.

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

👉 For more information, please visit the [documentation](https://feunard.github.io/alepha/).

## Modules

Alepha is modular, with a LOT of modules.

### Core & Application Layer

*   **Core (`@alepha/core`) 📦:** The heart of the framework, providing a powerful dependency injection container, application lifecycle management, and the core descriptor system.
*   **Server (`@alepha/server`) 🌐:** A high-performance, minimalist HTTP server for creating type-safe REST APIs using declarative `$action` descriptors.
*   **Database (`@alepha/postgres`) 🗄️:** A powerful and type-safe ORM built on Drizzle. Define your schema with `$entity` and get fully-typed repositories with `$repository`.
*   **React (`@alepha/react`) ⚛️:** Build full-stack, server-side rendered React applications with a file-based routing system (`$page`) that handles data fetching, hydration, and type-safe props.

### Backend Infrastructure & Abstractions

*   **Security (`@alepha/security`) 🛡️:** A complete authentication and authorization system. Manage roles (`$role`), permissions (`$permission`), JWTs, and realms (`$realm`).
*   **Queue (`@alepha/queue`) ⏳:** A simple and robust interface for background job processing. Define workers with the `$queue` descriptor and integrate with backends like Redis.
*   **Cache (`@alepha/cache`) ⚡:** A flexible caching layer with support for TTL, automatic function caching (`$cache`), and multiple backends like in-memory or Redis.
*   **Bucket (`@alepha/bucket`) ☁️:** A unified API for file and object storage. Abstract away the details of local, in-memory, or cloud storage providers like Azure Blob Storage.
*   **Scheduler (`@alepha/scheduler`) ⏰:** Schedule recurring tasks using cron expressions or fixed intervals with the `$scheduler` descriptor, with built-in support for distributed locking.
*   **Topic (`@alepha/topic`) 📢:** A publish-subscribe (pub/sub) messaging interface for building event-driven architectures with `$topic` and `$subscriber`.
*   **Lock (`@alepha/lock`) 🔒:** A distributed locking mechanism to ensure safe concurrent access to shared resources, using Redis or other backends.

### Server Middleware & Plugins

*   **Links (`@alepha/server-links`) 🔗:** Enables end-to-end type-safe communication between your frontend and backend, or between microservices, with the `$client` descriptor.
*   **Swagger (`@alepha/server-swagger`) 📜:** Automatically generate OpenAPI 3.0 documentation and a beautiful Swagger UI for all your `$action` API endpoints.
*   **Helmet (`@alepha/server-helmet`) 🎩:** Enhance your application's security by automatically applying essential HTTP security headers like CSP and HSTS.
*   **CORS (`@alepha/server-cors`) ↔️:** A configurable middleware to handle Cross-Origin Resource Sharing (CORS) for your server.
*   **Multipart (`@alepha/server-multipart`) 📎:** Seamlessly handle `multipart/form-data` requests for file uploads.
*   **Compress (`@alepha/server-compress`) 📦💨:** Automatically compress server responses with Gzip or Brotli to improve performance.

And more, like **Request Logging**, **Error Handling**, and **Response Caching**, cookie parsers, and more, to enhance your server's capabilities.

### Full-Stack & React Ecosystem

*   **Auth (`@alepha/react-auth`) 🔑:** Simplifies frontend authentication flows, providing the `useAuth` hook to manage user sessions and permissions in your React components.
*   **Head (`@alepha/react-head`)  SEO:** Manage your document's `<head>` for SEO and metadata. Control titles, meta tags, and more, both on the server and client.
*   **i18n (`@alepha/react-i18n`) 🌍:** A complete internationalization solution for your React applications, with support for lazy-loaded translation files and the `useI18n` hook.
*   **Form (`@alepha/react-form`) 📝:** Create powerful, type-safe forms with automatic validation using the `useForm` hook, powered by your TypeBox schemas.

### Tooling & Utilities

*   **Vite (`@alepha/vite`) ✨:** A seamless Vite plugin that handles all the complex build and development server configurations for your full-stack Alepha applications.
*   **Command (`@alepha/command`) ⌨️:** Build powerful, type-safe command-line interfaces and scripts directly within your application using the `$command` descriptor.
*   **Retry (`@alepha/retry`) 🔄:** A declarative and powerful decorator (`$retry`) for automatically retrying failed operations with exponential backoff.

