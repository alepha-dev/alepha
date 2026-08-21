# $sitemap

## Import

```typescript
import { $sitemap } from "alepha/react/sitemap";
```

## Overview

Expose a `sitemap.xml` generated from the application's `$page` primitives.

Registers a `GET /sitemap.xml` route that reads every registered page at
request time and emits a standard XML sitemap. Marked `static` by default, so
the build prerenders it to `dist/public/sitemap.xml` for static deployments -
while SSR runtimes also serve it live.

The hostname comes from `options.hostname`, falling back to `PUBLIC_URL`, then
to `""` (relative URLs).

## Options

| Option     | Type      | Required | Description                                                |
| ---------- | --------- | -------- | ---------------------------------------------------------- |
| `hostname` | `string`  | No       | Absolute base URL used to build `&lt;loc&gt;` entries (e.g |
| `path`     | `string`  | No       | Route path the sitemap is served at.                       |
| `static`   | `boolean` | No       | Prerender the sitemap to a static file at build time.      |

## Examples

```ts
import { $sitemap } from "alepha/react/sitemap";

class AppRouter {
  sitemap = $sitemap();
}
```
