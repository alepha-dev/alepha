# Sitemap

`$sitemap` serves a `sitemap.xml` built from your `$page` primitives, and the build
prerenders it to a static file. You add one line to a router, and it follows the
pages from then on.

```typescript check
import { $sitemap } from "alepha/react/sitemap";

class AppRouter {
  sitemap = $sitemap();
}
```

The route is `GET /sitemap.xml`. The build writes it to `dist/public/sitemap.xml`,
which is how a [static site](/docs/guides-deployment-static) gets one. That file is
also what a built server answers with, because static files mount over the route,
so `hostname` and `<lastmod>` are the build's. `alepha dev` answers live. With
`static: false` the build writes no file, so a built server answers live too, and a
static site has no sitemap.

## Options

| Option     | Default                 | What it does                                         |
| ---------- | ----------------------- | ---------------------------------------------------- |
| `hostname` | `PUBLIC_URL`, else `""` | The base of every URL. Empty, the URLs are relative. |
| `urls`     | `[]`                    | Extra URLs to list after the pages.                  |
| `path`     | `/sitemap.xml`          | Where it is served.                                  |
| `static`   | `true`                  | Whether the build prerenders it to a file.           |

⚠️ A sitemap is meant to hold absolute URLs, so set `hostname` or `PUBLIC_URL`. A
prerendered file is written at build time, so `PUBLIC_URL` must be set then.

## Which pages it lists

It reads the router's compiled routes, so a nested page appears at the path a
visitor requests, with its layouts in front of it.

| Page                                           | Listed                                    |
| ---------------------------------------------- | ----------------------------------------- |
| A page with no parameter                       | Yes.                                      |
| A page with a parameter, its own or a layout's | Only through `static.entries`, see below. |
| A layout (a page with children)                | No.                                       |
| A path with a wildcard                         | No.                                       |
| `/404`                                         | No.                                       |

There is no option to leave out one page, and a `$secure` page with no parameter
is listed like any other.

## Pages with parameters

A page with parameters is listed once per entry of its `static.entries`:

```typescript check
import { z } from "alepha";
import { $page } from "alepha/react/router";
import { $sitemap } from "alepha/react/sitemap";

class BlogRouter {
  post = $page({
    path: "/blog/:slug",
    schema: { params: z.object({ slug: z.text() }) },
    static: {
      entries: [
        { params: { slug: "hello-world" } },
        { params: { slug: "second-post" } },
      ],
    },
    component: () => null,
  });

  sitemap = $sitemap({ hostname: "https://myapp.com" });
}
```

Values are percent-encoded. An entry that leaves a parameter unfilled, such as a
parent's `:orgId`, is skipped, since a URL holding `:orgId` is not a URL.

## URLs that are not pages

`urls` lists what no `$page` answers, a feed or an `llms.txt`. A path is joined to
the hostname, and an absolute URL is listed as it is:

```typescript check
import { $sitemap } from "alepha/react/sitemap";

class AppRouter {
  sitemap = $sitemap({
    hostname: "https://myapp.com",
    urls: ["/llms.txt", "/feed.xml", "https://docs.myapp.com/"],
  });
}
```

## What it writes

A standard `urlset`, one `<url>` per entry, each with a `<loc>` and a `<lastmod>`.
`<lastmod>` is the date the sitemap was generated, the same for every URL: it says
nothing about when a page changed.

`$sitemap` does nothing in the browser, so it can sit on an isomorphic router class.

## robots.txt

`$robots` serves a `robots.txt` from code, in the same module.

```typescript check
import { $robots } from "alepha/react/sitemap";

class AppRouter {
  robots = $robots({ disallow: ["/admin", "/auth"] });
}
```

Any host other than the canonical one answers `Disallow: /`, so a staging deploy or a `workers.dev` preview stays out of search engines without anyone remembering to. Canonical is `host`, else `PUBLIC_URL`. With neither, there is no host to compare and `isProduction()` decides, which reads `NODE_ENV`, so set one of the two.

`Sitemap:` is added only when a `$sitemap` exists and its URL is absolute, since the directive refuses a relative one.

| Option     | Default       | What it does                               |
| ---------- | ------------- | ------------------------------------------ |
| `disallow` | `[]`          | Paths crawlers are asked to stay out of.   |
| `host`     | `PUBLIC_URL`  | The canonical host, or a URL holding it.   |
| `path`     | `/robots.txt` | Where it is served.                        |
| `static`   | `false`       | Whether the build prerenders it to a file. |

It answers at runtime by default, unlike `$sitemap`: one artifact deploys everywhere, and a prerendered file would be the build's answer on every host, since static files mount over the route. A file in `public/` does the same, so delete any `public/robots.txt`.

## Web app manifest

`$manifest` serves the manifest of an installable app, and adds its `<link rel="manifest">` to every page.

```typescript check
import { $manifest } from "alepha/react/sitemap";

class AppRouter {
  manifest = $manifest({
    name: "My App",
    shortName: "App",
    themeColor: "#010409",
    icons: [{ src: "/logo-512x512.png", sizes: "512x512", type: "image/png" }],
  });
}
```

Options are the manifest's own fields, in camel case, plus `path` (`/manifest.webmanifest`) and `static`. It is prerendered by default, since nothing in it depends on the environment, and answers `application/manifest+json`.
