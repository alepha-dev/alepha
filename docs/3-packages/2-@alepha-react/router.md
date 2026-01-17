# @alepha/react - Router

## Installation

```bash
npm install @alepha/react
```

## Overview

Provides declarative routing with the `$page` primitive for building type-safe React routes.

This module enables:
- URL pattern matching with parameters (e.g., `/users/:id`)
- Nested routing with parent-child relationships
- Type-safe URL parameter and query string validation
- Server-side data fetching with the `loader` function
- Lazy loading and code splitting
- Page animations and error handling

## API Reference

### Primitives

Primitives are functions that define and configure various aspects of your application. They follow the convention of starting with ` $ ` and return configured primitive instances.

For more details, see the [Primitives documentation](/docs/concepts-primitives).

#### $page()

Main primitive for defining a React route in the application.

The $page primitive is the core building block for creating type-safe, SSR-enabled React routes.
It provides a declarative way to define pages with powerful features:

**Routing & Navigation**
- URL pattern matching with parameters (e.g., `/users/:id`)
- Nested routing with parent-child relationships
- Type-safe URL parameter and query string validation

**Data Loading**
- Server-side data fetching with the `loader` function
- Automatic serialization and hydration for SSR
- Access to request context, URL params, and parent data

**Component Loading**
- Direct component rendering or lazy loading for code splitting
- Client-only rendering when browser APIs are needed
- Automatic fallback handling during hydration

**Performance Optimization**
- Static generation for pre-rendered pages at build time
- Server-side caching with configurable TTL and providers
- Code splitting through lazy component loading

**Error Handling**
- Custom error handlers with support for redirects
- Hierarchical error handling (child → parent)
- HTTP status code handling (404, 401, etc.)

**Page Animations**
- CSS-based enter/exit animations
- Dynamic animations based on page state
- Custom timing and easing functions

**Lifecycle Management**
- Server response hooks for headers and status codes
- Page leave handlers for cleanup (browser only)
- Permission-based access control

```typescript
const userProfile = $page({
  path: "/users/:id",
  schema: {
    params: t.object({ id: t.integer() }),
    query: t.object({ tab: t.optional(t.text()) })
  },
  loader: async ({ params }) => {
    const user = await userApi.getUser(params.id);
    return { user };
  },
  lazy: () => import("./UserProfile.tsx")
});
```

```typescript
const projectSection = $page({
  path: "/projects/:id",
  children: () => [projectBoard, projectSettings],
  loader: async ({ params }) => {
    const project = await projectApi.get(params.id);
    return { project };
  },
  errorHandler: (error) => {
    if (HttpError.is(error, 404)) {
      return <ProjectNotFound />;
    }
  }
});
```

```typescript
const blogPost = $page({
  path: "/blog/:slug",
  static: {
    entries: posts.map(p => ({ params: { slug: p.slug } }))
  },
  loader: async ({ params }) => {
    const post = await loadPost(params.slug);
    return { post };
  }
});
```

### Hooks

Hooks provide a way to tap into various lifecycle events and extend functionality. They follow the convention of starting with `use` and return configured hook instances.

#### useActive()

Hook to determine if a given route is active and to provide anchor props for navigation.
This hook refreshes on router state changes.

#### useQueryParams()

Hook to manage query parameters in the URL using a defined schema.

#### useRouter()

Use this hook to access the React Router instance.

You can add a type parameter to specify the type of your application.
This will allow you to use the router in a typesafe way.

class App {
  home = $page();
}

const router = useRouter<App>();
router.go("home"); // typesafe

### Providers

Providers are classes that encapsulate specific functionality and can be injected into your application. They handle initialization, configuration, and lifecycle management.

For more details, see the [Providers documentation](/docs/concepts-providers).

#### ReactBrowserRendererProvider

Browser specific React renderer (react-dom/client interface)

#### ReactBrowserRouterProvider

Implementation of AlephaRouter for React in browser environment.

#### ReactPageProvider

Handle page routes for React applications. (Browser and Server)

#### ReactServerProvider

React server provider responsible for SSR and static file serving.

Coordinates between:
- ReactPageProvider: Page routing and layer resolution
- ReactServerTemplateProvider: HTML template parsing and streaming
- ServerHeadProvider: Head content management
- SSRManifestProvider: Module preload link collection

Uses `react-dom/server` under the hood.

#### ReactServerTemplateProvider

Handles HTML template parsing, preprocessing, and streaming for SSR.

Responsibilities:
- Parse template once at startup into logical slots
- Pre-encode static parts as Uint8Array for zero-copy streaming
- Render dynamic parts (attributes, head content) efficiently
- Build hydration data for client-side rehydration

This provider is injected into ReactServerProvider to handle all
template-related operations, keeping ReactServerProvider focused
on request handling and React rendering coordination.

#### SSRManifestProvider

Provider for SSR manifest data used for module preloading.

The manifest is populated at build time by embedding data into the
generated index.js via the ssrManifestAtom. This eliminates filesystem
reads at runtime, making it optimal for serverless deployments.

Manifest files are generated during `vite build`:
- manifest.json (client manifest)
- ssr-manifest.json (SSR manifest)
- preload-manifest.json (from viteAlephaSsrPreload plugin)

### Environment Variables

Environment variables used to configure this module. These can be set in your `.env` file or through your deployment configuration.

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `REACT_SSR_ENABLED` | boolean | - |  |
| `REACT_STRICT_MODE` | boolean | true |  |
