# Alepha React

Build server-side rendered (SSR) or single-page React applications.

## Installation

This package is part of the Alepha framework and can be installed via the all-in-one package:

```bash
npm install alepha
```

## Module

Provides full-stack React development with declarative routing, server-side rendering, and client-side hydration.

The React module enables building modern React applications using the `$page` descriptor on class properties.
It delivers seamless server-side rendering, automatic code splitting, and client-side navigation with full
type safety and schema validation for route parameters and data.

This module can be imported and used as follows:

```typescript
import { Alepha, run } from "alepha";
import { AlephaReact } from "alepha/react";

const alepha = Alepha.create()
	.with(AlephaReact);

run(alepha);
```

## API Reference

### Descriptors

Descriptors are functions that define and configure various aspects of your application. They follow the convention of starting with ` $ ` and return configured descriptor instances.

For more details, see the [Descriptors documentation](/docs/descriptors).

#### $page()

Main descriptor for defining a React route in the application.

The $page descriptor is the core building block for creating type-safe, SSR-enabled React routes.
It provides a declarative way to define pages with powerful features:

**Routing & Navigation**
- URL pattern matching with parameters (e.g., `/users/:id`)
- Nested routing with parent-child relationships
- Type-safe URL parameter and query string validation

**Data Loading**
- Server-side data fetching with the `resolve` function
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
    params: t.object({ id: t.int() }),
    query: t.object({ tab: t.optional(t.text()) })
  },
  resolve: async ({ params }) => {
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
  resolve: async ({ params }) => {
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
  resolve: async ({ params }) => {
    const post = await loadPost(params.slug);
    return { post };
  }
});
```

### Hooks

Hooks provide a way to tap into various lifecycle events and extend functionality. They follow the convention of starting with `use` and return configured hook instances.

#### useAlepha()

Main Alepha hook.

It provides access to the Alepha instance within a React component.

With Alepha, you can access the core functionalities of the framework:

- alepha.state() for state management
- alepha.inject() for dependency injection
- alepha.events.emit() for event handling
etc...

#### useClient()

Hook to get a virtual client for the specified scope.

It's the React-hook version of `$client()`, from `AlephaServerLinks` module.

#### useEvents()

Allow subscribing to multiple Alepha events. See {@link Hooks} for available events.

useEvents is fully typed to ensure correct event callback signatures.

```tsx
useEvents(
  {
    "react:transition:begin": (ev) => {
      console.log("Transition began to:", ev.to);
    },
    "react:transition:error": {
      priority: "first",
      callback: (ev) => {
        console.error("Transition error:", ev.error);
      },
    },
  },
  [],
);
```

#### useInject()

Hook to inject a service instance.
It's a wrapper of `useAlepha().inject(service)` with a memoization.

#### useQueryParams()

Not well tested. Use with caution.

#### useRouter()

Use this hook to access the React Router instance.

You can add a type parameter to specify the type of your application.
This will allow you to use the router in a typesafe way.

class App {
  home = $page();
}

const router = useRouter<App>();
router.go("home"); // typesafe

#### useStore()

Hook to access and mutate the Alepha state.
