# $sitemap

## Import

```typescript
import { $sitemap } from "alepha/react/sitemap";
```

## Overview

Expose a `sitemap.xml` generated from the application's `$page` primitives.

Registers a `GET /sitemap.xml` route that reads every registered page and
emits a standard XML sitemap. Marked `static` by default, so the build
prerenders it to `dist/public/sitemap.xml`. That file is what a built server
answers with too, because static files mount over the route, so its
`hostname` and `<lastmod>` are the build's. `alepha dev` answers live, and so
does a built server with `static: false`.

The hostname comes from `options.hostname`, falling back to `PUBLIC_URL`, then
to `""` (relative URLs). URLs that no page answers, a feed or an
`llms.txt`, are listed through `options.urls`.

## Options

| Option     | Type       | Required | Description                                                                                      |
| ---------- | ---------- | -------- | ------------------------------------------------------------------------------------------------ |
| `hostname` | `string`   | No       | Absolute base URL used to build `&lt;loc&gt;` entries (e.g                                       |
| `urls`     | `string[]` | No       | Extra URLs to list after the pages: files and routes that are not a `$page`, such as `/llms.txt` |
| `path`     | `string`   | No       | Route path the sitemap is served at.                                                             |
| `static`   | `boolean`  | No       | Prerender the sitemap to a static file at build time                                             |

## Examples

```ts
import { $sitemap } from "alepha/react/sitemap";

class AppRouter {
  sitemap = $sitemap();
}
```
