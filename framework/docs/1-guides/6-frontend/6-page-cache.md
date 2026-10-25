# Page Cache

Alepha caches server-rendered pages automatically, signed-in visitors included, and never caches a person. A page that reads nothing about its visitor is rendered once and served to everyone until it goes stale; a page that does is rendered for each request, as before. There is nothing to declare for this to be safe: the framework watches what each render reads.

## Why HTML caching usually stops at signed-in users

A product page is 98% shared and 2% visitor: the name in the header, the account menu, the API actions the visitor may call. Cache the whole document and the first visitor's name is served to everyone; skip the cache for signed-in requests and most of the traffic of a real app is never cached.

Alepha splits the two halves instead:

- **Split hydration.** The `<script id="__ssr">` payload carries what the page shows: the router layers and every ordinary atom. The visitor's state travels apart, in a `<script id="__ssr_private">` built for each request. An atom declares which side it belongs to with `$atom({ personal: true })`; the current user, the API links, the UI preferences and every cookie-bound atom are personal. A cached page only ever holds the shared part, and each request appends its own private script.
- **Read tracking.** While a page renders, from the first server middleware to the last byte, Alepha records the reads that concern the visitor. A page that made none is cached.

## The three verdicts

| the render read            | verdict    | cached                      |
| -------------------------- | ---------- | --------------------------- |
| nothing about the visitor  | `shared`   | yes                         |
| only the language          | `variant`  | yes, one entry per language |
| anything about the visitor | `personal` | never                       |

With `alepha/react/i18n` installed every page reads the language (`<html lang>` is in the body), so a page with nothing personal is `variant`, never `shared`: every key carries the language anyway.

A page is **personal** when its render, or anything it runs, reads:

- a personal atom: `useStore(currentUserAtom)`, `useAuth()`, the API links through `useClient().can()`, the UI preferences;
- `state.user`, which loaders receive in their context;
- the raw request (`alepha.http.request`) or a cookie (`$cookie(...).get()`);
- a remote call that forwards the visitor's `Authorization` (a `$client` with a `hostname`);
- or when it writes a personal atom during the render, or sets a cookie.

A `$secure` page is therefore personal with no special case: its guard reads the user. An in-process `$client` call to a public action does not make a loader page personal: the call is judged by what the action reads.

Unknown means personal. A mistake costs a cache miss, never a leak.

### Seeing the verdict

Outside production every page answers an `x-alepha-cache` header: `hit`, `miss`, `bypass`, `off` or `refused`. A page rendered with `stream: false` knows its verdict before its headers leave and says it there too: `miss; verdict=personal; read=atom:alepha.security.user`. A streamed page logs it when the stream ends, with the first personal read and the code that made it:

```text
INFO Page verdict { name: "home", verdict: "personal", read: "atom:alepha.react.ui", source: "at useTheme (...)" }
```

### Examples

- **A public page** (a product, an article): `shared` or `variant`, cached.
- **A translated page**: `variant`, one entry per language.
- **A page whose layout shows the user menu**: personal, unless the menu is wrapped in `<Personal>` (below). `@alepha/ui`'s `ButtonUser` already is.
- **A cart badge loaded with `useQuery`**: `useQuery` fetches in an effect, never on the server, so the page stays shared.
- **An account page** (`$secure`, a loader reading `state.user`): personal, rendered for each request.
- **A service that keeps its own per-user `Map`**: invisible to the tracker. The anonymous double render below catches it in development.

## Lifetimes and options

A page needs no option to be cached. Its entries live:

- **until the next deploy** when no layer of the page has a `loader`: its markup can only change with the code, and the build is part of every key, so a deploy misses every old entry with no purge;
- **60 seconds** when the page or a parent layer has a `loader`.

`$page({ cache })` changes that for one page:

```typescript
product = $page({
  path: "/product/:slug",
  cache: { ttl: [1, "hour"] }, // another lifetime
  loader: ({ params }) => this.products.getBySlug({ params }),
  lazy: () => import("./Product.tsx"),
});

payment = $page({
  path: "/order/:id",
  cache: false, // never cached: the page follows a payment in flight
  loader: ({ params }) => this.orders.get({ params }),
  lazy: () => import("./Order.tsx"),
});
```

A personal page is never cached, whatever `cache` says. A `$cache` middleware in a page's `use` is refused: it stored the whole document, the visitor's private state included. For a personal page, cache the data instead: put `$cache` on what the loader reads, keyed by user (see [Caching](/docs/guides-persistence-caching)).

> A loader-less page whose markup reads an app-level atom that changes at runtime (a value a job sets) is stale until the next deploy. Give such a page a `ttl`.

### What makes the key

`page:<build>:<page>:<params>:<query>:<language>`. Only the query parameters the page declares in `schema.query` count. A request carrying a query parameter the page does not declare bypasses the cache: a page without a query schema receives the raw query and may print it, so a `/reset?token=...` must never be served to the next visitor. Links carrying `utm_*` therefore miss the cache until the page declares them.

### Never written

Only a clean render is stored: status 200, no error page, no meta-refresh redirect, no layer error, no `Set-Cookie`. A 404 is never written, so random URLs cannot fill the cache.

## `<Personal>`: the personal part of a shared page

One user menu in the layout would make every page personal. Wrap it:

```tsx
import { Personal } from "alepha/react";

<Personal fallback={<SignInButton />}>
  <UserMenu />
</Personal>;
```

In a render that may be shared, `<Personal>` renders its `fallback`, and its children do not run, so what they read does not count. In the browser the hydration pass renders what the server rendered, then the children take over on the next commit, from the visitor's state already in the private script: no request, no hydration mismatch. On a page that is personal anyway, the server renders the children directly.

Keep the fallback the size of the real thing, so the swap moves nothing. `@alepha/ui`'s `ButtonUser` uses an empty slot the size of the icon button. The UI preference hooks (`useColorMode`, `useTheme`, `useSidebarState`) need no wrapper: they never read the preferences on the server, and the boot script paints them on `<html>` before the first frame.

## Invalidation

A page that shows data a write changes declares the writes, on the page side:

```typescript
product = $page({
  path: "/product/:slug",
  cache: {
    invalidatedBy: [
      {
        action: "productUpdate",
        params: ({ result }) => ({ slug: result.slug }),
      },
      { action: "productDelete" }, // no params: every entry of the page
    ],
  },
  loader: ({ params }) => this.products.getBySlug({ params }),
  lazy: () => import("./Product.tsx"),
});
```

The action is named, so a page module the browser loads never imports a server controller. The purge runs after a successful call, over HTTP or in process, before the response leaves, so the writer reads their own write. `params` must return the page's full param set.

From a handler, `page.invalidate()` purges every entry of the page, and `page.invalidate({ slug })` those of one param set, in every query and every language.

> **Upgrading.** Automatic caching is on in tests too (`alepha/testing`), as in production. A spec that turns red after the upgrade because a page shows an old value after a write is a page missing its `invalidatedBy`. `REACT_PAGE_CACHE=false` turns the whole cache off for an incident.

## The anonymous double render

The tracker sees the channels Alepha owns. It cannot see a module variable a middleware set, a service's own per-user map, or a value a service read from the raw request. So outside production, before a page is first written, it is rendered again for nobody, in a fresh context: no user, no cookie, no `Authorization`, same URL and language. If the two differ, the write is refused, the error log names the page and the first differing fragment, and the header says `refused`.

Two consequences in development and tests: **loaders run twice** on a first miss (a loader that counts views counts twice), and **markup must be deterministic**: a page that prints the current time or a random value is refused, which is the signal that it cannot be shared as is. Give it `cache: false`. A test suite that measures loader calls can switch the check off:

```typescript
alepha.store.mut(reactPageCacheOptions, (it) => ({
  ...it,
  anonymousCheck: false,
}));
```

## Per runtime

- **Node and Bun**: entries go to the app's `CacheProvider`. With the default in-memory provider the page cache keeps a bounded LRU (1000 entries, `reactPageCacheOptions.max`); with Redis, entries and invalidations span instances, and Redis's own eviction bounds them.
- **Cloudflare Workers**: a bounded LRU per isolate, `caches.default` per data centre, and anonymous pages answered before the app boots. Entries live 60 seconds at most there, because `caches.default` and its deletes belong to one data centre. See [Cloudflare](/docs/guides-deployment-cloudflare#page-cache-at-the-edge).

The browser's `Cache-Control` is unchanged: pages still leave with `no-store`. The cache is on the server, never in a shared proxy that cannot tell visitors apart.
