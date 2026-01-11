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

React server provider configuration atom
/
export const reactServerOptions = $atom({
  name: "alepha.react.server.options",
  schema: t.object({
    publicDir: t.string(),
    staticServer: t.object({
      disabled: t.boolean(),
      path: t.string({
        description: "URL path where static files will be served.",
      }),
    }),
  }),
  default: {
    publicDir: "public",
    staticServer: {
      disabled: false,
      path: "/",
    },
  },
});

export type ReactServerProviderOptions = Static<
  typeof reactServerOptions.schema
>;

declare module "alepha" {
  interface State {
    [reactServerOptions.key]: ReactServerProviderOptions;
  }
}

// ---------------------------------------------------------------------------------------------------------------------

/**
React server provider responsible for SSR and static file serving.

Coordinates between:
- ReactPageProvider: Page routing and layer resolution
- ReactServerTemplateProvider: HTML template parsing and streaming
- ServerHeadProvider: Head content management
- SSRManifestProvider: Module preload link collection

Uses `react-dom/server` under the hood.

#### ReactServerTemplateProvider

Template slots - the template split into logical parts for efficient streaming.

Static parts are pre-encoded as Uint8Array for zero-copy streaming.
Dynamic parts (attributes, head content) are kept as strings/objects for merging.
/
export interface TemplateSlots {
  // Pre-encoded static parts
  doctype: Uint8Array;
  htmlOpen: Uint8Array; // "<html"
  htmlClose: Uint8Array; // ">"
  headOpen: Uint8Array; // "<head>"
  headClose: Uint8Array; // "</head>"
  bodyOpen: Uint8Array; // "<body"
  bodyClose: Uint8Array; // ">"
  rootOpen: Uint8Array; // '<div id="root">'
  rootClose: Uint8Array; // "</div>"
  scriptClose: Uint8Array; // "</body></html>"

  // Original content (kept for merging)
  htmlOriginalAttrs: Record<string, string>;
  bodyOriginalAttrs: Record<string, string>;
  headOriginalContent: string;
  beforeRoot: string; // content between <body> and root div
  afterRoot: string; // content between root div and </body>
}

/**
Hydration state that gets serialized to window.__ssr
/
export interface HydrationData {
  layers: Array<{
    data?: unknown;
    error?: {
      name: string;
      message: string;
      stack?: string;
    };
  }>;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------------------------------------------------

const templateOptionsAtom = $atom({
  name: "alepha.react.server.template.options",
  schema: t.object({
    rootId: t.string(),
  }),
  default: {
    rootId: "root",
  },
});

export type ReactServerTemplateOptions = Static<
  typeof templateOptionsAtom.schema
>;

declare module "alepha" {
  interface State {
    [templateOptionsAtom.key]: ReactServerTemplateOptions;
  }
}

// ---------------------------------------------------------------------------------------------------------------------

/**
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

SSR Manifest structure from Vite.
Maps source file paths to their required chunks/assets.
/
export type SSRManifest = Record<string, string[]>;

/**
Client manifest structure from Vite.
Maps source files to their output information.
/
export interface ClientManifest {
  [key: string]: {
    file: string;
    src?: string;
    isEntry?: boolean;
    isDynamicEntry?: boolean;
    imports?: string[];
    dynamicImports?: string[];
    css?: string[];
    assets?: string[];
  };
}

/**
Preload manifest mapping short keys to source paths.
Generated by viteAlephaSsrPreload plugin at build time.
/
export type PreloadManifest = Record<string, string>;

/**
Provider for SSR manifest data used for module preloading.

The manifest is populated at build time by embedding data into the
generated index.js via the ssrManifestAtom. This eliminates filesystem
reads at runtime, making it optimal for serverless deployments.

Manifest files are generated during `vite build`:
- manifest.json (client manifest)
- ssr-manifest.json (SSR manifest)
- preload-manifest.json (from viteAlephaSsrPreload plugin)
