# React Integration

Alepha isn't just a backend engine pretending it doesn't know about frontends. It's a full-stack application engine that treats your React code as a first-class citizen. No more "backend team vs frontend team" drama. Just code.

The `alepha/react` package gives you hooks for dependency injection, type-safe API calls, global state, and async operations. Use it with Alepha's router, or plug it into your existing Next.js/Expo/whatever setup.

## Installation

The React package ships separately from the main `alepha` package. Why? Because not everyone needs React. Some people are still writing jQuery. We don't judge.

**Recommended:** Use the CLI to scaffold a React-ready project:

```bash
npx alepha init --react
```

This sets up everything:
- Installs `alepha/react` and peer dependencies
- Configures `main.browser.ts` for client hydration

**Manual installation:**

```bash
npm install alepha/react react @types/react
```

---

## What's in the Box?

```tsx
import {
  // Hooks
  useAlepha,        // Access the Alepha instance
  useInject,        // Dependency injection in React
  useClient,        // Type-safe HTTP client
  useStore,         // Global state management
  useAction,        // Async operations with loading/error/cancel
  useEvents,        // Subscribe to engine events

  // Components
  ClientOnly,       // Skip SSR for browser-only code
  AlephaProvider,   // Context provider for non-router setups
} from "alepha/react";
```

These work **anywhere**. With Alepha's router, with Next.js, with Expo, with your weird custom setup. No router required.

---

## `useAlepha` - Access the Engine

Need the Alepha instance? Here you go:

```tsx
const MyComponent = () => {
  const alepha = useAlepha();

  // Access store, events, check environment...
  const user = alepha.store.get("current_user");
  const isDev = alepha.isDevelopment();

  return <div>Hello, {user?.name}</div>;
};
```

The Alepha instance is your gateway to everything: store, events, services, environment. Most of the time you'll use specialized hooks like `useStore`, but sometimes you need the raw power.

---

## `useInject` - Dependency Injection in React

Your services shouldn't live outside React. Inject them:

```tsx
const Dashboard = () => {
  const analytics = useInject(AnalyticsService);
  const logger = useInject(Logger);

  useEffect(() => {
    analytics.trackPageView("dashboard");
    logger.info("Dashboard loaded");
  }, []);

  return <div>Dashboard</div>;
};
```

Same DI container, same services, works in your components. No context providers. No prop drilling. Just ask for what you need.

### When to Use It

- Accessing Alepha services (Logger, Cache, etc.)
- Sharing business logic between server and client
- Testing with mock services

```tsx
// Works the same in tests
const alepha = Alepha.create()
  .with({ provide: AnalyticsService, use: MockAnalytics });

// Component now gets MockAnalytics
```

---

## `useClient` - Type-Safe API Calls

Call your backend with full type safety:

```tsx
import { useClient } from "alepha/react";
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

No more guessing endpoint URLs. No more checking if it's `userId` or `user_id`. TypeScript knows the exact shape of every request and response.

### How It Works

1. You define an `$action` on the server
2. TypeScript infers the types
3. `useClient<Controller>()` gives you a typed client
4. You call methods with full autocomplete

```tsx
// Server
class UserController {
  getUser = $action({
    schema: {
      params: t.object({ id: t.uuid() }),
      response: t.object({
        id: t.uuid(),
        name: t.text(),
        email: t.email()
      })
    },
    handler: async ({ params }) => {
      return await db.users.findById(params.id);
    }
  });
}

// Client
const client = useClient<UserController>();
const user = await client.getUser({ params: { id: "..." } });
// user is typed as { id: string, name: string, email: string }
```

---

## `useStore` - Global State

Read and write global state without Redux boilerplate:

```tsx
import { useStore } from "alepha/react";
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

Define atoms with schemas. Use them anywhere. Components re-render automatically when values change.

```tsx
// Define once
const themeAtom = $atom({
  name: "theme",
  schema: t.enum(["light", "dark"]),
  default: "light"
});

// Use anywhere
const [theme] = useStore(themeAtom);
```

For the full story, see the [State Management guide](./3-state-management.md).

---

## `useAction` - Async Operations Done Right

Handle async operations with loading states, error handling, and cancellation:

```tsx
import { useAction } from "alepha/react";

const SaveButton = () => {
  const [save, { loading, error, data }] = useAction({
    handler: async () => {
      return await api.saveDocument(document);
    }
  });

  return (
    <div>
      <button onClick={save} disabled={loading}>
        {loading ? "Saving..." : "Save"}
      </button>
      {error && <span className="error">{error.message}</span>}
      {data && <span className="success">Saved!</span>}
    </div>
  );
};
```

### Features

- **Single execution**: Prevents double-clicks automatically
- **Loading state**: Know when it's working
- **Error capture**: Catches and exposes errors
- **Cancellation**: Abort in-flight requests
- **Data access**: Access the return value

### With Cancellation

```tsx
const [search, { loading, cancel }] = useAction({
  handler: async (query: string) => {
    return await api.search(query);
  }
});

// Start a search
search("hello");

// User types something new, cancel the old search
cancel();
search("hello world");
```

### Debouncing

```tsx
const [search, { loading }] = useAction({
  debounce: 300,  // Wait 300ms after last call
  handler: async (query: string) => {
    return await api.search(query);
  }
});

// Call as often as you want
<input onChange={(e) => search(e.target.value)} />
```

---

## `useEvents` - Subscribe to Engine Events

React to engine events:

```tsx
import { useEvents } from "alepha/react";

const GlobalErrorHandler = () => {
  useEvents({
    "react:action:error": ({ error, type }) => {
      toast.error(error.message);
      Sentry.captureException(error);
    },
    "react:transition:begin": () => {
      NProgress.start();
    },
    "react:transition:end": () => {
      NProgress.done();
    }
  }, []);

  return null;
};
```

### Common Events

```typescript
// User actions (navigation, form submissions, etc.)
"react:action:begin"    // { type: string, id?: string }
"react:action:success"  // { type: string, id?: string }
"react:action:error"    // { type: string, id?: string, error: Error }
"react:action:end"      // { type: string, id?: string }

// Route transitions
"react:transition:begin"
"react:transition:success"
"react:transition:error"
"react:transition:end"

// Form submissions
"form:submit:begin"     // { formId: string }
"form:submit:success"
"form:submit:error"
"form:submit:end"

// HTTP client
"client:beforeFetch"    // Before HTTP request
"client:onError"        // HTTP error
```

### Global Error Toast

```tsx
// In your root component
useEvents({
  "react:action:error": ({ error }) => {
    // Don't show network errors, they're handled elsewhere
    if (error.name !== "NetworkError") {
      toast.danger(error.message);
    }
  }
}, []);
```

---

## `ClientOnly` - Skip SSR

Some code should only run in the browser. LocalStorage, window dimensions, that sort of thing:

```tsx
import { ClientOnly } from "alepha/react";

const LiveClock = () => {
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const interval = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <ClientOnly fallback={<span>--:--:--</span>}>
      <span>{time.toLocaleTimeString()}</span>
    </ClientOnly>
  );
};
```

The `fallback` renders during SSR and initial hydration. Once the client takes over, the real content appears.

### Common Uses

```tsx
// LocalStorage
<ClientOnly>
  <ThemeFromLocalStorage />
</ClientOnly>

// Window dimensions
<ClientOnly>
  <WindowSizeDisplay />
</ClientOnly>

// Third-party scripts
<ClientOnly>
  <IntercomWidget />
</ClientOnly>

// Canvas/WebGL
<ClientOnly fallback={<img src="/preview.png" />}>
  <ThreeJSScene />
</ClientOnly>
```

---

## `AlephaProvider` - For Non-Router Setups

Using Alepha hooks in Next.js, Expo, or your own React setup? You need to wrap your app with `AlephaProvider`:

```tsx
import { AlephaProvider } from "alepha/react";

const App = () => {
  return (
    <AlephaProvider
      onLoading={() => <div>Loading...</div>}
      onError={(error) => <div>Error: {error.message}</div>}
    >
      <MyApp />
    </AlephaProvider>
  );
};
```

The provider handles:
1. Creating an Alepha instance
2. Starting it (async)
3. Showing your loading UI while it starts
4. Catching startup errors
5. Providing the instance to all child components

Once started, all the hooks (`useAlepha`, `useInject`, `useClient`, etc.) just work.

### When You Don't Need It

If you're using `alepha/react/router`, the router handles all of this for you. The provider is only for when you want Alepha's hooks without Alepha's routing.

```tsx
// With router - no provider needed
import { $page } from "alepha/react/router";

class AppRouter {
  home = $page({
    path: "/",
    component: () => {
      const client = useClient<MyApi>();  // Just works
      // ...
    }
  });
}

// Without router - wrap with provider
import { AlephaProvider } from "alepha/react";

// In your Next.js _app.tsx or similar
export default function App({ Component, pageProps }) {
  return (
    <AlephaProvider
      onLoading={() => <Loading />}
      onError={(e) => <Error error={e} />}
    >
      <Component {...pageProps} />
    </AlephaProvider>
  );
}
```

---

## Module Structure

Alepha React is split into focused modules:

| Module | Import | Purpose |
|--------|--------|---------|
| Core | `alepha/react` | Hooks, components (this guide) |
| Router | `alepha/react/router` | SSR, pages, navigation |
| Form | `alepha/react/form` | Type-safe forms |
| Head | `alepha/react/head` | Document head, SEO |
| Auth | `alepha/react/auth` | Authentication hooks |
| i18n | `alepha/react/i18n` | Internationalization |

Import what you need. Tree-shaking handles the rest.

```typescript
// Just core stuff
import { useClient, useStore, useAction } from "alepha/react";

// With routing
import { $page, useRouter, Link } from "alepha/react/router";

// With forms
import { useForm } from "alepha/react/form";

// With SEO
import { $head, useHead } from "alepha/react/head";

// With auth
import { useAuth } from "alepha/react/auth";

// With i18n
import { $dictionary, useI18n } from "alepha/react/i18n";
```

---

## Quick Reference

```typescript
// Access Alepha instance
const alepha = useAlepha();
alepha.store.get(myAtom);
alepha.isDevelopment();

// Dependency injection
const service = useInject(MyService);

// Type-safe API client
const client = useClient<MyController>();
await client.myAction({ params: {...}, body: {...} });

// Global state
const [value, setValue] = useStore(myAtom);

// Async operations
const [action, { loading, error, data, cancel }] = useAction({
  handler: async () => {...},
  debounce: 300,
});

// Engine events
useEvents({
  "react:action:error": ({ error }) => toast(error.message),
}, []);

// Browser-only rendering
<ClientOnly fallback={<Loading />}>
  <BrowserOnlyComponent />
</ClientOnly>

// Provider for non-router setups (Next.js, Expo, etc.)
<AlephaProvider onLoading={() => <Loading />} onError={(e) => <Error error={e} />}>
  <App />
</AlephaProvider>
```

---

Next up: [Routing](./2-routing.md) | [State Management](./3-state-management.md) | [Head & SEO](./4-head-and-seo.md)
