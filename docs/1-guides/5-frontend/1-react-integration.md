# React Integration

Alepha isn't just a backend framework. It's a full-stack framework that treats your frontend as a first-class citizen of your application graph. No more "backend team vs frontend team" drama. Just code.

## Installation

The `@alepha/react` package ships separately from the main `alepha` package. Why? Because not everyone needs React. Some people are still writing jQuery. We don't judge.

**Recommended:** Use the CLI to scaffold a React-ready project:

```bash
npx alepha init --react
```

This sets up everything:
- Installs `@alepha/react` and peer dependencies
- Creates `index.html` entry point
- Configures `main.browser.ts` for client hydration
- Sets up Vite for SSR builds

**Manual installation:**

```bash
npm install @alepha/react
```

Note: You'll need to manually create `index.html` and configure the browser entry point. But you knew that.

---

## Part 1: Core Module

The core module (`@alepha/react`) provides essential React utilities that work **anywhere**. Next.js, Expo, your weird custom setup - doesn't matter. No router required.

### What's in Core?

```tsx
import {
  // Hooks
  useAlepha,       // Access the Alepha instance
  useInject,       // Dependency injection in React
  useClient,       // Type-safe HTTP client
  useStore,        // Global state management
  useAction,       // Async action handler with loading/error/cancel
  useEvents,       // Subscribe to Alepha events

  // Components
  ClientOnly,      // Render only on client (skip SSR)
  ErrorBoundary,   // Catch and display errors gracefully

  // Module
  AlephaReact,     // Core module registration
} from "@alepha/react";
```

### `useAlepha` - Access the Framework

Need the Alepha instance? Here you go:

```tsx
const MyComponent = () => {
  const alepha = useAlepha();

  // Access store, events, services...
  const user = alepha.store.get("current_user");

  return <div>Hello, {user?.name}</div>;
};
```

### `useInject` - Dependency Injection in React

Your services shouldn't live outside React. Inject them:

```tsx
const Dashboard = () => {
  const analytics = useInject(AnalyticsService);

  useEffect(() => {
    analytics.trackPageView("dashboard");
  }, []);

  return <div>Dashboard</div>;
};
```

Same DI container, same services, works in your components.

### `useClient` - Type-Safe API Calls

Call your backend with full type safety:

```tsx
import { useClient } from "@alepha/react";
import type { UserController } from "../api/UserController";

const UserProfile = () => {
  const client = useClient<UserController>();
  const [user, setUser] = useState(null);

  useEffect(() => {
    client.getUser({ params: { id: "123" } }).then(setUser);
  }, []);

  return <div>{user?.name}</div>;
};
```

No more guessing endpoint URLs or request shapes. TypeScript knows.

### `useStore` - Global State

Read and write global state without Redux boilerplate:

```tsx
import { useStore } from "@alepha/react";
import { themeAtom } from "./atoms/theme";

const ThemeToggle = () => {
  const [theme, setTheme] = useStore(themeAtom);

  return (
    <button onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
      Current: {theme}
    </button>
  );
};
```

See the [State Management guide](./2-state-management.md) for the full story.

### `useAction` - Async Operations Done Right

Handle async operations with loading states, error handling, and cancellation:

```tsx
import { useAction } from "@alepha/react";

const SaveButton = () => {
  const [save, { loading, error }] = useAction(async () => {
    await api.saveDocument(document);
  });

  return (
    <button onClick={save} disabled={loading}>
      {loading ? "Saving..." : "Save"}
    </button>
  );
};
```

Features:
- **Single execution**: Prevents double-clicks
- **Cancellation**: Abort in-flight requests
- **Error capture**: Catches and exposes errors
- **Loading state**: Know when it's working

### `ClientOnly` - Skip SSR

Some code should only run in the browser. LocalStorage, window dimensions, that sort of thing:

```tsx
import { ClientOnly } from "@alepha/react";

const LiveClock = () => {
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const interval = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <ClientOnly>
      <span>{time.toLocaleTimeString()}</span>
    </ClientOnly>
  );
};
```

No hydration mismatches. No cryptic warnings. Just works.

### `ErrorBoundary` - Graceful Failures

Catch errors before they crash your app:

```tsx
import { ErrorBoundary } from "@alepha/react";

const App = () => (
  <ErrorBoundary fallback={<div>Something went wrong</div>}>
    <Dashboard />
  </ErrorBoundary>
);
```

### Module Registration

If you're using Alepha's DI system without the router, register the core module:

```typescript
import { Alepha } from "alepha";
import { AlephaReact } from "@alepha/react";

const alepha = Alepha.create().with(AlephaReact);
```

---

## Part 2: Router Module

The router module (`@alepha/react/router`) is where the SSR magic happens. It gives you file-system-style routing with the power of TypeScript.

**Is it required?** No. But if you want SSR, you need it. If you're building a SPA, you still probably want it. It's good.

### What's in Router?

```tsx
import {
  // Primitives
  $page,           // Define routes as page primitives

  // Hooks
  useRouter,       // Navigation and path generation
  useRouterState,  // Current route state
  useActive,       // Active link detection
  useQueryParams,  // Query string access

  // Components
  Link,            // Client-side navigation link
  NotFound,        // 404 handling
  NestedView,      // Nested route rendering

  // Module
  AlephaReactRouter, // Router module (auto-loads with $page)
} from "@alepha/react/router";
```

### The `$page` Primitive

In frameworks like Next.js, you create files in a `pages/` directory. In Alepha, you define pages as class properties. Why? Type-safe linking between your backend and frontend.

```tsx
import { $page } from "@alepha/react/router";
import { t } from "alepha";

export class AppRouter {
  home = $page({
    path: "/",
    component: () => <div>Welcome!</div>
  });

  dashboard = $page({
    path: "/dashboard",
    schema: {
      query: t.object({
        filter: t.optional(t.text())
      })
    },
    // Server-Side Data Fetching
    resolve: async ({ query }) => {
      const stats = await db.stats.get(query.filter);
      return { stats };
    },
    // Props typed automatically from resolve
    component: ({ stats }) => {
      return <div>Stats: {stats.count}</div>
    }
  });

  userProfile = $page({
    path: "/users/:id",
    schema: {
      params: t.object({ id: t.text() })
    },
    resolve: async ({ params }) => {
      return { user: await db.users.findById(params.id) };
    },
    component: ({ user }) => <UserCard user={user} />
  });
}
```

### Schema = Type Safety

If your path has `:id`, declare it in `schema.params`. Query params go in `schema.query`. This isn't optional - it's how you get type safety.

```tsx
postDetail = $page({
  path: "/posts/:id/:slug",
  schema: {
    params: t.object({
      id: t.uuid(),
      slug: t.text(),
    }),
    query: t.object({
      tab: t.optional(t.enum(["comments", "related"])),
    }),
  },
  resolve: async ({ params, query }) => {
    // params.id is string (validated as UUID)
    // params.slug is string
    // query.tab is "comments" | "related" | undefined
  },
  component: ({ /* ... */ }) => { /* ... */ }
});
```

Without the schema, `params` and `query` are `unknown`. Nobody wants that.

### The `useRouter` Hook

Type-safe navigation:

```tsx
import { useRouter } from "@alepha/react/router";

const Navigation = () => {
  const router = useRouter<AppRouter>();

  return (
    <div>
      {/* Navigate by page name */}
      <button onClick={() => router.go("home")}>Home</button>
      <button onClick={() => router.go("dashboard")}>Dashboard</button>

      {/* With params */}
      <button onClick={() => router.go("userProfile", { params: { id: "123" } })}>
        View User
      </button>

      {/* History */}
      <button onClick={() => router.back()}>Back</button>
    </div>
  );
};
```

### Generating Paths

Use `router.path()` for URLs:

```tsx
const UserNav = () => {
  const router = useRouter<AppRouter>();

  return (
    <nav>
      <a href={router.path("home")}>Home</a>
      <a href={router.path("userProfile", { params: { id: "123" } })}>
        View User
      </a>
      <a href={router.path("dashboard", { query: { filter: "active" } })}>
        Active Users
      </a>
    </nav>
  );
};
```

### Anchor Props with `router.anchor()`

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
```

### Active State with `useActive`

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

// With startWith for nested routes
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

### Query Parameters

Access and modify query params:

```tsx
const Filters = () => {
  const router = useRouter<AppRouter>();

  const { sort, filter } = router.query;

  const setSort = (value: string) => {
    router.setQueryParams({ ...router.query, sort: value });
  };

  return (
    <select value={sort} onChange={(e) => setSort(e.target.value)}>
      <option value="name">Name</option>
      <option value="date">Date</option>
    </select>
  );
};
```

### SSR - It Just Works

Alepha handles Server-Side Rendering:

1. Server matches URL to `$page`
2. Runs `resolve` function for data
3. Renders React to HTML
4. Sends HTML to browser
5. Hydrates the React app

No Babel config. No Webpack wrestling. `alepha dev` and `alepha build` handle it.

### Auto-Loading

When you use `$page` in your module's primitives, `AlephaReactRouter` loads automatically:

```typescript
import { $module } from "alepha";
import { $page } from "@alepha/react/router";

// No manual .with(AlephaReactRouter) needed
export const MyAppModule = $module({
  name: "my-app",
  primitives: [$page], // Router auto-loads
});
```

---

## When to Use What

| You want... | Use... |
|-------------|--------|
| Just React utilities (hooks, components) | `@alepha/react` |
| SSR, routing, pages | `@alepha/react/router` |
| Works with Next.js/Expo | `@alepha/react` (core only) |
| Full Alepha experience | `@alepha/react/router` |

## Import Cheatsheet

```typescript
// Core - works everywhere
import { useAlepha, useClient, useStore, useAction, ClientOnly } from "@alepha/react";

// Router - full SSR experience
import { $page, useRouter, useActive, Link } from "@alepha/react/router";

// Form - type-safe forms
import { useForm } from "@alepha/react/form";

// Head - document head management (requires router)
import { $head, useHead } from "@alepha/react/head";

// i18n - internationalization
import { $dictionary, useI18n } from "@alepha/react/i18n";

// Auth - authentication (requires router)
import { useAuth } from "@alepha/react/auth";
```

---

Next up: [State Management](./2-state-management.md) | [Head Management](./3-head.md) | [Forms](./4-form.md) | [i18n](./5-i18n.md)
