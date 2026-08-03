# $page

## Import

```typescript
import { $page } from "alepha/react/router";
```

## Overview

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
- Infer generation for pre-rendered pages at build time
- Server-side caching via the `$cache` middleware in `use: [...]`
- Code splitting through lazy component loading

**Error Handling**
- Custom error handlers with support for redirects
- Hierarchical error handling (child → parent)
- HTTP status code handling (404, 401, etc.)

## Options

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `name` | `string` | No | Identifier name for the page |
| `path` | `string` | No | Add a pathname to the page |
| `schema` | `TConfig` | No | Add an input schema to define: - `params`: parameters from the pathname |
| `use` | `Middleware[]` | No | Middleware to apply to the loader function |
| `loader` | `Object` | No | Load data before rendering the page |
| `props` | `Object` | No | Default props to pass to the component when rendering the page |
| `component` | `FC&lt;TProps & TPropsParent&gt;` | No | The component to render when the page is loaded |
| `lazy` | `Object` | No | Lazy load the component when the page is loaded |
| `children` | `Array&lt;PagePrimitive&gt; \| (() =&gt; Array&lt;PagePrimitive&gt;)` | No | Attach child pages to create nested routes, adopting them as children of this page |
| `parent` | `PagePrimitive&lt;PageConfigSchema, TPropsParent, any&gt;` | No | Define a parent page for nested routing |
| `can` | `Object` | No | UI-affordance predicate for this page's navigation entry — **NOT security** |
| `nav` | `PageNav` | No | Navigation metadata — declares this page's presence in navigation surfaces: the sidebar, the breadcrumb trail, and a command palette (Spotlight) |
| `errorHandler` | `ErrorHandler` | No | Catch any error from the `loader` function or during `rendering` |
| `ssr` | `boolean` | No | Enable or disable server-side rendering for this page |
| `stream` | `boolean` | No | Buffer the HTML instead of streaming it, so the page can choose its status code |
| `onServerResponse` | `Object` | No | Called before the server response is sent to the client |
| `onEnter` | `Object` | No | Called when user enters the page |
| `onLeave` | `Object` | No | Called when user leaves the page |
| `animation` | `PageAnimation` | No | Add a css animation when the page is loaded or unloaded |
| `head` | `Head \| ((props: TProps, previous?: Head) =&gt; Head)` | No | Head configuration for the page (title, meta tags, etc.) |
| `redirect` | `string` | No | Redirect to another path when this page is matched |
| `label` | `string` | No | Label for the page, used for navigation menus or breadcrumbs |

## Examples

Simple page with data fetching
```typescript
const userProfile = $page({
  path: "/users/:id",
  schema: {
    params: z.object({ id: z.integer() }),
    query: z.object({ tab: z.text().optional() })
  },
  loader: async ({ params }) => {
    const user = await userApi.getUser(params.id);
    return { user };
  },
  lazy: () => import("./UserProfile.tsx")
});
```

Nested routing with error handling
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

Infer generation with caching
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

