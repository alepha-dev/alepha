# $robots

## Import

```typescript
import { $robots } from "alepha/react/sitemap";
```

## Overview

Serve a `robots.txt` generated from code.

Any host other than the canonical one answers `Disallow: /`, so a staging
deploy or a `workers.dev` preview keeps itself out of search engines without
anyone remembering to. Canonical is `options.host`, else `PUBLIC_URL`; with
neither set there is no host to compare, and `isProduction()` decides.

Runtime by default, unlike `$sitemap`: the answer depends on where the app
runs, and a prerendered file would be the build's on every host, since one
artifact deploys everywhere and static files mount over the route.

## Options

| Option     | Type       | Required | Description                                                     |
| ---------- | ---------- | -------- | --------------------------------------------------------------- |
| `disallow` | `string[]` | No       | Paths crawlers are asked to stay out of, on the canonical host. |
| `host`     | `string`   | No       | The canonical host, or a URL holding it.                        |
| `path`     | `string`   | No       | Route path the file is served at.                               |
| `static`   | `boolean`  | No       | Prerender to a static file at build time                        |

## Examples

```ts
import { $robots } from "alepha/react/sitemap";

class AppRouter {
  robots = $robots({ disallow: ["/admin"] });
}
```
