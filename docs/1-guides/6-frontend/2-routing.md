# Routing

Alepha uses the `$page` primitive to define React routes, with support for data loading, code splitting, SSR, SSG, nested routing, and type-safe parameters.

## Setup

```typescript check
import { $page } from "alepha/react/router";
```

Routes are defined as class properties. The class is registered with the Alepha instance in your entry files.

## Defining Pages

A complete example from a real Alepha application:

```typescript
import { z } from "alepha";
import { $page } from "alepha/react/router";
import { $client } from "alepha/server/links";
import type { CountApi } from "./CountApi.ts";

export class AppRouter {
  countApi = $client<CountApi>();

  home = $page({
    head: { title: "Home" },
    schema: {
      query: z.object({
        name: z.text({ default: "Alepha" }),
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

Type-safe URL parameters and query strings using Zod schemas.

```typescript
schema: {
  params: z.object({ id: z.integer() }),
  query: z.object({ tab: z.text().optional() }),
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

#### Canonical URLs

Every page gets a `<link rel="canonical">`, plus `og:url` and `twitter:url`, without declaring anything. Set `PUBLIC_URL` and they are built from it and the page's matched route path:

```
PUBLIC_URL=https://example.com   →   <link rel="canonical" href="https://example.com/docs/routing">
```

It is built from the **route path**, not the request URL, so `?utm_source=newsletter` and a trailing slash never reach the tag — collapsing those duplicates is the entire job of a canonical, and one built from `location.href` would certify them instead.

Nothing is emitted when there is no `PUBLIC_URL` to build on, for wildcard and `/404` routes, or when a layer errored — in each case there is no single URL the page could honestly name, and a relative canonical resolves against whichever host served it, which is exactly the ambiguity being removed.

To point a page somewhere else — a duplicate that should defer to the original — set `url` yourself:

```typescript
head: { url: "https://example.com/docs/routing" }
```

Set it on a **page**, never in the global `$head()`: there it names the same URL for the whole site, and search engines read that as every page being a duplicate of that one. Alepha logs a warning if you do.

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

### ssr

Disable server-side rendering for the page component (`@default true`). With `ssr: false` the component renders client-side only (wrapped in `<ClientOnly />` internally), but the **loader still runs on the server** — data fetching is unaffected. The value is decided at the leaf and inherited as a default by descendants: `ssr: false` on a parent acts as the default for its children, and a child can override with `ssr: true`.

```typescript
ssr: false
```

### stream

Buffer the HTML instead of streaming it, so the page can choose its status code (`@default true`).

A page is streamed with an early `<head>` flush by default: the head leaves before the loader runs, which is what makes the first paint fast. The cost is that the HTTP status is committed by then, so a page whose existence depends on data cannot answer `404` — a missing product renders the error boundary with a `200`, which a crawler indexes as a real page.

With `stream: false` the page renders to a string first and only then replies, so `onServerResponse` sees the finished render and can set `reply.status`.

```typescript
product = $page({
  path: "/product/:slug",
  stream: false,
  loader: async ({ params }) => {
    const product = await this.api.find(params.slug);
    if (!product) throw new NotFoundError("No such product");
    return { product };
  },
  onServerResponse: ({ reply }) => {
    if (/* the loader found nothing */) reply.status = 404;
  },
});
```

Use it for the handful of routes that can legitimately not exist — a product, an article, a profile. Leave it alone everywhere else: buffering delays the first byte by the whole render.

### use

Attach middlewares to the page — this is how you add server-side caching:

```typescript
use: [$cache({ ttl: [1, "hour"] })]
```

> [!WARNING]
> **`$secure` on a page is not access control.** It is a handler middleware, so on a page it wraps the *loader*, and its browser implementation short-circuits by returning `undefined` rather than throwing. The loader is skipped and **the page renders anyway** — on a back office that means the whole shell, navigation and all, over empty tables whose requests each answer 401. The framework warns about this at boot.
>
> To turn a visitor away, redirect from the loader:
>
> ```typescript
> loader: async ({ user }) => {
>   if (!user?.roles?.includes("admin")) {
>     throw new Redirection("/login?redirect=/admin");
>   }
> }
> ```
>
> Keep `$secure` on the endpoints underneath. That is what actually enforces the permission, and it answers 401 whatever the interface does.

When `static: true` is set, the framework automatically applies `$cache({ provider: "memory", ttl: [1, "week"] })` to the page.

### can

UI-affordance predicate for the page's navigation entry — **not security**. Navigation surfaces (sidebar, breadcrumbs, command palette) consult it to hide or disable the entry; the router never does, and nothing returns a 403. For real access control, gate the page with `use: [$secure({ permissions })]`, which is server-enforced.

```typescript
can: ({ has }) => has("admin")          // hide the nav entry
can: ({ has }) => has("admin") || "disabled"  // show it greyed out
```

### redirect

Redirect to another path when this page is matched — shorthand for throwing a `Redirection` in the loader. The redirect happens before any loader or component rendering.

```typescript
home = $page({
  path: "/",
  redirect: "/dashboard",
});
```

### nav

Navigation metadata — declares the page's presence in navigation surfaces (sidebar, breadcrumbs, command palette). A page without `nav` is route-only: reachable by URL but not listed. `label`, `icon`, `description`, and `badge` accept any `ReactNode`. Visibility is UI-only — an entry hides when `nav.hidden` is set, when `nav.permission` isn't fully granted, or when `can()` returns `false`.

```typescript
users = $page({
  path: "/users",
  nav: { label: "Users", icon: <Users /> },
  lazy: () => import("./pages/Users"),
});
```

### props

Default props passed to the component; props returned by the `loader` override them.

```typescript
props: () => ({ pageSize: 25 })
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

### Ready-made routers from `@alepha/ui`

Three routers ship whole surfaces you can mount instead of rebuilding:

| Router | Surface | Extend with |
|---|---|---|
| `AuthRouter` | `/auth/login`, `/register`, `/reset-password`, `/verify-email` | — (write your own to change the URLs) |
| `AdminRouter` | `/admin` — users, sessions, keys, jobs, audits, … | `$pageAdmin` |
| `AccountRouter` | `/account` — profile, security, sessions, API keys, connected apps | `$pageAccount` |

`$pageAdmin` and `$pageAccount` are `$pageNav` already parented to their shell,
so one call adds a page to the shared sidebar with no separate registration —
the shell reads each page's own `nav` metadata. Both follow the same rules:
take `order: 100` or above (or your own `nav.group`) so you don't reshuffle the
built-in entries, and gate with `can: () => this.someApi.someAction.can()`
rather than `permission` alone, because a permission is self-declaring and
stays granted over an API that was never mounted.

`AdminRouter` stands alone at the root by design. `AccountRouter` goes either
way — mount it and `/account` is a root route, or adopt its layout into your
own shell with `children`, which is the `children` case above:

```typescript
class AppRouter {
  protected account = $inject(AccountRouter);

  layout = $page({
    children: () => [this.home, this.account.layout, this.notFound],
    lazy: () => import("./Layout.tsx"),
  });
}
```

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

```typescript check
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

```typescript check
import { useQueryParams } from "alepha/react/router";
import { z } from "alepha";

function SearchPage() {
  const [params, setParams] = useQueryParams(
    z.object({
      search: z.text().optional(),
      page: z.integer().optional(),
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

| Option   | Type                        | Default    | Description                                                                 |
|----------|-----------------------------|------------|-----------------------------------------------------------------------------|
| `key`    | `string`                    | `"q"`      | Param name for `base64` format. Ignored by `querystring`.                   |
| `format` | `"base64"` \| `"querystring"` | `"base64"` | `base64` packs the whole object into one opaque param (`?q=…`); `querystring` spreads each field as its own readable param (`?search=…&page=…`). |
| `push`   | `boolean`                   | `false`    | `true` adds a history entry (`pushState`) so back returns to the previous value; `false` replaces the current entry (`replaceState`). |

With `format: "querystring"`, each schema field maps to its own URL param,
and values are coerced back to their declared types on read (e.g. a
`z.integer()` field reads `?page=2` as the number `2`).

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

```typescript check
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
