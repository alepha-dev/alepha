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
