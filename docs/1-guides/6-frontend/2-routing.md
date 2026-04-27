# Routing

Alepha uses the `$page` primitive to define React routes. It is a superset of `$route` designed specifically for React pages with support for data loading, code splitting, SSR, SSG, nested routing, and type-safe parameters.

## Setup

```typescript
import { $page } from "alepha/react/router";
```

Routes are defined as class properties. The class is registered with the Alepha instance in your entry files.

## Defining Pages

A complete example from a real Alepha application:

```typescript
import { t } from "alepha";
import { $page } from "alepha/react/router";
import { $client } from "alepha/server/links";
import type { CountApi } from "./CountApi.ts";

export class AppRouter {
  countApi = $client<CountApi>();

  home = $page({
    head: { title: "Home" },
    schema: {
      query: t.object({
        name: t.text({ default: "Alepha" }),
      }),
    },
    loader: async ({ query }) => {
      return {
        greeting: `Hello, ${query.name} SSR!`,
        count: await this.countApi.inc().then((result) => result.count),
      };
    },
    lazy: () => import("./Home.tsx"),
  });

  about = $page({
    head: { title: "About" },
    path: "/about",
    lazy: () => import("./About.tsx"),
  });
}
```

## Page Options

### path

URL pattern with parameter support. If omitted, defaults to the root (`/`).

```typescript
path: "/users/:id"
path: "/blog/:slug"
```

### schema

Type-safe URL parameters and query strings using TypeBox schemas.

```typescript
schema: {
  params: t.object({ id: t.integer() }),
  query: t.object({ tab: t.optional(t.text()) }),
}
```

Parameters and query values are validated and typed in the `loader` and component props.

### loader

Server-side data fetching function. Receives typed params, query, and parent props. The returned data is passed to the component as props. In SSR, data is serialized on the server and hydrated on the client.

```typescript
loader: async ({ params, query }) => {
  const user = await this.userApi.getUser(params.id);
  return { user };
}
```

### component and lazy

Provide the React component to render. Use `lazy` for code splitting (recommended):

```typescript
// Code splitting (recommended)
lazy: () => import("./UserProfile.tsx")

// Direct component
component: ({ user }) => <div>{user.name}</div>
```

Lazy-loaded modules must use a default export.

### head

Set document head tags (title, meta, etc.). Can be static or dynamic:

```typescript
// Static
head: { title: "About Us" }

// Dynamic, based on loader data
head: (props) => ({
  title: props.user.name,
  description: `Profile of ${props.user.name}`,
})
```

### static

Pre-render the page at build time (SSG). On the server, acts as a cached page.

```typescript
// Simple static page
static: true

// With predefined entries
static: {
  entries: [
    { params: { slug: "hello-world" } },
    { params: { slug: "getting-started" } },
  ],
}
```

### client

Force client-side only rendering (no SSR). Uses the `<ClientOnly />` component internally.

```typescript
client: true
```

### cache

Server-side caching configuration. Automatically set when `static: true`.

```typescript
cache: {
  store: {
    provider: "memory",
    ttl: [1, "hour"],
  },
}
```

### can

Permission-based access control. Return `false` to block access (results in 403).

```typescript
can: () => userHasPermission("admin")
```

## Nested Routing

Define parent-child relationships between pages using `parent` on the child or `children` on the parent. Parent pages render child content using the `<NestedView />` component.

### Which option to use

The choice is not stylistic — it depends on **who owns the child page**:

- **You own the child** (you wrote the `$page` and can edit it) → set `parent` on the child. The child declares its own place in the tree.
- **You don't own the child** (it comes from another package or an injected router you can't modify) → add it to `children` on your parent. The parent adopts pages it doesn't control.

The second case is the reason `children` exists. When you `$inject` a router from another package, its `$page` definitions are frozen — you can't reach in and set `parent` on them. `children` is how you mount those external pages under one of your own layouts:

```typescript
class AppRouter {
  protected productRouter = $inject(ProductRouter);

  layout = $page({
    path: "/app",
    component: () => <Shell><NestedView /></Shell>,
    children: () => [
      this.productRouter.catalogPage,
      this.productRouter.checkoutPage,
    ],
  });
}
```

When you do own the child, prefer `parent` — it keeps parents free of forward references to their own descendants and reads top-down:

```typescript
import { $page } from "alepha/react/router";
import { NestedView } from "alepha/react/router";

class AppRouter {
  layout = $page({
    path: "/app",
    component: () => (
      <div>
        <nav>Sidebar</nav>
        <main>
          <NestedView />
        </main>
      </div>
    ),
  });

  dashboard = $page({
    path: "/dashboard",
    parent: this.layout,
    lazy: () => import("./Dashboard.tsx"),
  });

  settings = $page({
    path: "/settings",
    parent: this.layout,
    lazy: () => import("./Settings.tsx"),
  });
}
```

> ⚠️ **Declare each edge from one side only.** If page B already has `parent: pageA`, do not also list B in `pageA.children`. The link is already established; stating it on both sides creates a TypeScript circular dependency between the two class fields (each references the other before it is initialised).

`<NestedView />` renders the matched child page. It supports an optional `errorBoundary` prop.

## Error Handling

Use `errorHandler` to catch loader or rendering errors. Return a ReactNode for a custom error page, a `Redirection` to redirect, or `undefined` to let the error propagate to parent pages.

```typescript
import { Redirection } from "alepha/react/router";

errorHandler: (error) => {
  if (HttpError.is(error, 404)) {
    return <NotFound />;
  }
  if (HttpError.is(error, 401)) {
    return new Redirection("/login");
  }
}
```

## Lifecycle Callbacks

- `onEnter` -- called when the user enters the page (browser only)
- `onLeave` -- called when the user leaves the page (browser only)

```typescript
onEnter: () => {
  analytics.trackPageView("/dashboard");
  window.scrollTo(0, 0);
}
```

- `onServerResponse` -- called before the server sends the response (server only)

## Page Animations

CSS-based enter/exit animations (experimental).

```typescript
// Simple animation name
animation: "fadeIn"

// Detailed enter/exit
animation: {
  enter: { name: "fadeIn", duration: 300 },
  exit: { name: "fadeOut", duration: 200, timing: "ease-in-out" },
}

// Dynamic based on router state
animation: (state) => ({
  enter: "slideIn",
  exit: "slideOut",
})
```

Define the keyframes in your CSS:

```css
@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}
```

## Router Hooks

### useRouter

Access the router for navigation. Accepts a type parameter for type-safe page name references.

```typescript
import { useRouter } from "alepha/react/router";

function Nav() {
  const router = useRouter<AppRouter>();

  return (
    <div>
      <p>Current path: {router.pathname}</p>
      <button onClick={() => router.push("/about")}>About</button>
      <button onClick={() => router.push("home")}>Home (by name)</button>
      <button onClick={() => router.back()}>Back</button>
      <button onClick={() => router.forward()}>Forward</button>
      <button onClick={() => router.reload()}>Reload</button>
    </div>
  );
}
```

**Key methods and properties:**

| Method/Property   | Description                                              |
|-------------------|----------------------------------------------------------|
| `push(path, opts)` | Navigate to a path or page name. Options: `replace`, `params`, `query`, `force`. |
| `back()`          | Go back in history.                                       |
| `forward()`       | Go forward in history.                                    |
| `reload()`        | Reload the current page.                                  |
| `isActive(href)`  | Check if the given path is the current route.             |
| `pathname`        | Current pathname string.                                  |
| `query`           | Current query parameters as `Record<string, string>`.     |
| `path(name, cfg)` | Resolve a page name to its URL path.                      |
| `anchor(path)`    | Returns `{ href, onClick }` props for anchor elements.    |
| `setQueryParams(record)` | Update URL query parameters without navigation.    |

### useActive

Determine if a route is active and get anchor props for navigation links.

```typescript
import { useActive } from "alepha/react/router";

function NavLink({ href, label }: { href: string; label: string }) {
  const { isActive, isPending, anchorProps } = useActive(href);

  return (
    <a {...anchorProps} className={isActive ? "active" : ""}>
      {isPending ? "Loading..." : label}
    </a>
  );
}
```

Accepts a string or an options object:

```typescript
const { isActive } = useActive({ href: "/docs", startWith: true });
// isActive is true for /docs, /docs/intro, /docs/api, etc.
```

### useQueryParams

Manage typed query parameters with a schema.

```typescript
import { useQueryParams } from "alepha/react/router";
import { t } from "alepha";

function SearchPage() {
  const [params, setParams] = useQueryParams(
    t.object({
      search: t.optional(t.text()),
      page: t.optional(t.integer()),
    }),
  );

  return (
    <input
      value={params.search ?? ""}
      onChange={(e) => setParams({ ...params, search: e.target.value })}
    />
  );
}
```

Options:

| Option   | Type     | Default    | Description                           |
|----------|----------|------------|---------------------------------------|
| `key`    | `string` | `"q"`      | Query parameter key in the URL.       |
| `format` | `string` | `"base64"` | Encoding format.                      |
| `push`   | `boolean`| `false`    | Push to history instead of replace.   |

## Links and Anchor Interception

Plain `<a href="/...">` anchors are intercepted automatically and routed
through the SPA router — no `<Link>` wrapper required. This works inside
React JSX as well as in raw HTML injected into the page (e.g. Markdown
content rendered from a CMS).

```html
<a href="/about">About</a>
```

The interceptor bails out (and lets the browser handle the click natively)
when any of the following apply:

- the click uses a modifier key (`meta`, `ctrl`, `shift`, `alt`)
- the mouse button isn't the primary one (middle/right click)
- the anchor has `target` other than `_self` (e.g. `target="_blank"`)
- the anchor has a `download` attribute
- the anchor has a `data-no-router` attribute (explicit opt-out)
- the `href` uses a non-http(s) scheme (`mailto:`, `tel:`, `data:`, …)
- the `href` points to a different origin
- the `href` is hash-only (`#section`)
- another listener already called `event.preventDefault()`

To force a hard navigation on a same-origin link, opt out per-anchor:

```html
<a href="/legacy" data-no-router>Legacy page</a>
```

To disable the global interceptor, set `interceptAnchorClicks: false` on
the `alepha.react.browser.options` atom.

### `<Link>` component

`<Link>` is still available as a thin wrapper around `<a>` that wires the
router via `onClick` directly:

```typescript
import { Link } from "alepha/react/router";

<Link href="/about">About</Link>
```

With the global interceptor enabled, `<Link>` is mostly a stylistic
preference. Reach for it when you want explicit per-link control or
intend to extend it with prefetching/active-state logic later.

## Router Events

Route transitions emit events on the Alepha event system:

- `react:transition:begin` -- navigation started (includes previous and new state)
- `react:transition:success` -- navigation completed
- `react:transition:error` -- navigation failed
- `react:transition:end` -- always emitted after transition completes
