# Routing

So you want URLs that actually do things. Wild concept.

Alepha's router (`@alepha/react/router`) gives you SSR, type-safe navigation, nested routes, data loading, and error handling. All without a single `pages/` folder or magic filename convention.

You define routes as class properties. TypeScript knows about them. Your IDE autocompletes them. You sleep better at night.

> **Note:** The router depends on `@alepha/react` (core). If you only need hooks like `useClient` or `useStore` without routing, see [React Integration](./1-react-integration.md).

---

## The `$page` Primitive

In Next.js, you create files. In Remix, you create more files. In Alepha, you define pages as class properties with `$page`.

```tsx
import { $page } from "@alepha/react/router";
import { t } from "alepha";

class AppRouter {
  home = $page({
    path: "/",
    component: () => <div>Welcome!</div>
  });

  about = $page({
    path: "/about",
    lazy: () => import("./pages/About.tsx")
  });
}
```

That's it. Two routes. Type-safe. Ready for SSR.

### Why Class Properties?

Because then TypeScript knows your routes exist. You can `router.go("home")` and get autocomplete. You can generate paths with `router.path("userProfile", { params: { id: "123" } })` and the compiler yells if you misspell it.

File-based routing gives you magic strings. Class-based routing gives you types.

---

## Loading Data

The `loader` function runs before your component renders. On the server during SSR, on the client during navigation. Same code, both places.

```tsx
class AppRouter {
  dashboard = $page({
    path: "/dashboard",
    loader: async () => {
      const stats = await api.getStats();
      return { stats };
    },
    component: ({ stats }) => <Dashboard stats={stats} />
  });
}
```

The return value becomes your component props. Automatically typed. No `useEffect` + `useState` dance on the client. No "loading..." flash.

### With URL Parameters

Got dynamic routes? Declare them in the schema:

```tsx
userProfile = $page({
  path: "/users/:id",
  schema: {
    params: t.object({ id: t.integer() })
  },
  loader: async ({ params }) => {
    // params.id is number, validated
    const user = await api.getUser(params.id);
    return { user };
  },
  component: ({ user }) => <UserCard user={user} />
});
```

Without the schema, `params` is `unknown`. With it, you get full type safety and validation. The framework validates the parameter before your loader even runs.

### Query Parameters

Same deal for query strings:

```tsx
search = $page({
  path: "/search",
  schema: {
    query: t.object({
      q: t.text(),
      page: t.optional(t.integer()),
      sort: t.optional(t.enum(["date", "relevance"]))
    })
  },
  loader: async ({ query }) => {
    // query.q is string
    // query.page is number | undefined
    // query.sort is "date" | "relevance" | undefined
    return await api.search(query);
  },
  component: SearchResults
});
```

### Accessing Parent Data

Nested routes can access parent props:

```tsx
class AppRouter {
  project = $page({
    path: "/p/:projectId",
    schema: { params: t.object({ projectId: t.integer() }) },
    children: () => [this.projectBoard, this.projectSettings],
    loader: async ({ params }) => {
      const project = await api.getProject(params.projectId);
      return { project };
    },
    lazy: () => import("./ProjectLayout.tsx")
  });

  projectBoard = $page({
    path: "/",  // Relative to parent: /p/:projectId/
    loader: async ({ project }) => {
      // project comes from parent loader
      const tasks = await api.getTasks(project.id);
      return { tasks };
    },
    component: ({ project, tasks }) => <Board project={project} tasks={tasks} />
  });

  projectSettings = $page({
    path: "/settings",  // /p/:projectId/settings
    component: ({ project }) => <Settings project={project} />
  });
}
```

Child loaders receive parent props. No prop drilling. No context gymnastics.

---

## Lazy Loading

Use `lazy` for code splitting. It's 2026 (or later). Your users don't need every component on first load:

```tsx
projectCreate = $page({
  path: "/p-new",
  lazy: () => import("./components/ProjectCreate.tsx")
});
```

The component loads when the route matches. Vite handles the bundling. You handle the coffee.

You can also use `component` for small, always-needed pages:

```tsx
notFound = $page({
  path: "/*",
  component: NotFound  // Always bundled
});
```

---

## Nested Routes

Real apps have layouts. A sidebar that persists across pages. A header that knows which project you're in.

```tsx
class AppRouter {
  api = $client<ProjectController>();
  alepha = $inject(Alepha);

  layout = $page({
    children: () => [
      this.home,
      this.project,
      this.settings,
      this.notFound
    ],
    lazy: () => import("./Layout.tsx"),
    loader: async ({ user }) => {
      if (user) {
        // Load user's projects for sidebar
        this.alepha.set(userProjectsAtom, await api.getMyProjects());
      }
    }
  });

  home = $page({
    path: "/",
    lazy: () => import("./Home.tsx")
  });

  project = $page({
    path: "/p/:projectId",
    children: () => [
      this.projectBoard,
      this.projectSettings
    ],
    // ...
  });
}
```

The `Layout` component renders, then the matched child renders inside it. Layouts persist during navigation between children. No re-mount, no flicker.

### NestedView Component

In your layout, use `NestedView` to render children:

```tsx
// Layout.tsx
import { NestedView } from "@alepha/react/router";

export default function Layout({ children }) {
  return (
    <div className="app">
      <Sidebar />
      <main>
        <NestedView />  {/* Child page renders here */}
      </main>
    </div>
  );
}
```

---

## Navigation

### The `useRouter` Hook

Navigate programmatically with full type safety:

```tsx
import { useRouter } from "@alepha/react/router";

const Navigation = () => {
  const router = useRouter<AppRouter>();

  return (
    <div>
      {/* By page name */}
      <button onClick={() => router.go("home")}>Home</button>

      {/* With params */}
      <button onClick={() => router.go("userProfile", { params: { id: 123 } })}>
        View User
      </button>

      {/* With query */}
      <button onClick={() => router.go("search", { query: { q: "test" } })}>
        Search
      </button>

      {/* History */}
      <button onClick={() => router.back()}>Back</button>
      <button onClick={() => router.forward()}>Forward</button>

      {/* Reload current page */}
      <button onClick={() => router.reload()}>Refresh</button>
    </div>
  );
};
```

### Generating Paths

Need a URL string? Use `router.path()`:

```tsx
const UserNav = () => {
  const router = useRouter<AppRouter>();

  const profileUrl = router.path("userProfile", { params: { id: 123 } });
  // "/users/123"

  const searchUrl = router.path("search", { query: { q: "test", page: 2 } });
  // "/search?q=test&page=2"

  return (
    <nav>
      <a href={profileUrl}>Profile</a>
      <a href={searchUrl}>Search</a>
    </nav>
  );
};
```

### Anchor Props

Get both `href` and `onClick` for client-side navigation:

```tsx
const NavLink = ({ page, children }) => {
  const router = useRouter<AppRouter>();

  return (
    <a {...router.anchor(page)}>
      {children}
    </a>
  );
};

// Usage
<NavLink page="home">Home</NavLink>
<NavLink page="dashboard">Dashboard</NavLink>
```

The `onClick` handler prevents default, navigates client-side. The `href` is there for SEO, right-click "open in new tab", and accessibility.

---

## Active States

Build navigation that knows where you are:

```tsx
import { useActive } from "@alepha/react/router";

const NavLink = ({ href, children }) => {
  const { isActive, isPending, anchorProps } = useActive(href);

  return (
    <a
      {...anchorProps}
      className={isActive ? "active" : isPending ? "loading" : ""}
    >
      {children}
    </a>
  );
};
```

### Prefix Matching

For nested routes, use `startWith`:

```tsx
const SidebarLink = ({ href, children }) => {
  const { isActive, anchorProps } = useActive({ href, startWith: true });

  // isActive is true for /users, /users/123, /users/settings...
  return (
    <a {...anchorProps} className={isActive ? "active" : ""}>
      {children}
    </a>
  );
};
```

---

## Error Handling

Things go wrong. APIs fail. Users bookmark pages that no longer exist. Handle it gracefully:

```tsx
projectTask = $page({
  path: "/q/:taskId",
  schema: { params: t.object({ taskId: t.integer() }) },
  loader: async ({ params }) => {
    const task = await api.getTask(params.taskId);
    return { task };
  },
  errorHandler: (error) => {
    if (HttpError.is(error, 404)) {
      return <NotFound style={{ height: "100%" }} />;
    }
    // Return undefined to let error propagate to parent
  },
  lazy: () => import("./TaskView.tsx")
});
```

### Redirects on Error

Handle authentication failures:

```tsx
layout = $page({
  children: () => [/* ... */],
  errorHandler: (error, state) => {
    if (HttpError.is(error, 401) && state.url.pathname !== "/login") {
      return new Redirection(`/login?r=${state.url.pathname}`);
    }
  },
  lazy: () => import("./Layout.tsx")
});
```

### Error Bubbling

If a child page doesn't handle an error, it bubbles up to the parent. Define a catch-all error handler in your root layout:

```tsx
import { createElement } from "react";
import ErrorPage from "./ErrorPage.tsx";

layout = $page({
  children: () => [/* ... */],
  errorHandler: (error, state) => {
    // Only show generic error page in production
    if (!this.alepha.isProduction()) {
      return;  // Let Alepha show the dev error overlay
    }

    return createElement(ErrorPage, { error });
  }
});
```

---

## Lifecycle

### onLeave

Clean up when users navigate away:

```tsx
project = $page({
  path: "/p/:projectId",
  loader: async ({ params }) => {
    const project = await api.getProject(params.projectId);
    this.alepha.set(currentProjectAtom, project);
    return { project };
  },
  onLeave: () => {
    // Clear atoms when leaving
    this.alepha.set(currentProjectAtom, undefined);
  }
});
```

This runs in the browser only, when the user navigates to a different route.

## Static Pages & Caching

Pre-render pages at build time:

```tsx
blogPost = $page({
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

Or just mark a page as static (with server-side caching):

```tsx
termsOfService = $page({
  path: "/terms",
  static: true,
  component: TermsOfService
});
```

---

## Router State

Access the current router state anywhere:

```tsx
import { useRouterState } from "@alepha/react/router";

const Debug = () => {
  const state = useRouterState();

  return (
    <pre>
      URL: {state.url.pathname}
      Params: {JSON.stringify(state.params)}
      User: {state.user?.name}
    </pre>
  );
};
```

Or via the router:

```tsx
const router = useRouter<AppRouter>();
console.log(router.pathname);  // "/users/123"
console.log(router.query);     // { tab: "settings" }
console.log(router.state);     // Full state object
```

---

## Client-Only Pages

Some pages need browser APIs. Force client-side rendering:

```tsx
canvasEditor = $page({
  path: "/editor",
  ssr: false,  // Renders loading state during SSR
  lazy: () => import("./CanvasEditor.tsx")
});

// Or with custom fallback
client: {
  fallback: <div>Loading editor...</div>
}
```

---

## Auto-Loading

When you use `$page` in your module's primitives, the router module loads automatically:

```typescript
import { $module } from "alepha";
import { $page } from "@alepha/react/router";

export const MyAppModule = $module({
  name: "my-app",
  primitives: [$page],  // Router auto-loads
});
```

No manual `.with(AlephaReactRouter)` needed.

---

## Quick Reference

```typescript
// Define a page
$page({
  path: "/users/:id",
  schema: {
    params: t.object({ id: t.integer() }),
    query: t.object({ tab: t.optional(t.text()) })
  },
  loader: async ({ params, query, user }) => ({ ... }),
  component: MyComponent,         // or...
  lazy: () => import("./Page"),   // Code splitting
  children: () => [childPage],    // Nested routes
  head: (props) => ({ title: props.user.name }),
  errorHandler: (error, state) => <Error />,
  onLeave: () => cleanup(),
  animation: "fadeIn",
  static: true,
  cache: { store: { ttl: [1, "hour"] } },
  client: true,
});

// Navigation
const router = useRouter<AppRouter>();
router.go("home");
router.go("userProfile", { params: { id: 123 } });
router.back();
router.forward();
router.reload();

// Paths
router.path("home");                           // "/"
router.path("search", { query: { q: "test" }}); // "/search?q=test"

// Links
<a {...router.anchor("home")}>Home</a>

// Active state
const { isActive, isPending, anchorProps } = useActive("/users");
const { isActive } = useActive({ href: "/users", startWith: true });

// Query params
router.query;  // { page: "2", sort: "name" }
router.setQueryParams({ page: 3 });

// State
router.pathname;  // "/users/123"
router.state;     // Full router state
```

---

Next up: [State Management](./3-state-management.md) | [Head & SEO](./4-head-and-seo.md)
