# Static Files and Proxying

Two primitives for the requests an `$action` should not be handling: files that
exist on disk, and requests that belong to somebody else's server.

## `$serve`

`$serve` mounts a directory on a path prefix.

```typescript check
import { $serve } from "alepha/server/static";

class Assets {
  public = $serve({
    path: "/static",
    root: "./public",
  });
}
```

```typescript
import { AlephaServerStatic } from "alepha/server/static";

alepha.with(AlephaServerStatic);
```

`path` defaults to `/` and `root` to the working directory, so `$serve({})` in a
container that starts in the right place already does something useful.

| Option               | Default         | Effect                                          |
| -------------------- | --------------- | ----------------------------------------------- |
| `path`               | `"/"`           | URL prefix the directory is mounted at          |
| `root`               | `process.cwd()` | Directory on disk                               |
| `indexFallback`      | `true`          | Serve `index.html` when the path is a directory |
| `historyApiFallback` | `false`         | Serve `index.html` for anything not found       |
| `ignoreDotEnvFiles`  | `true`          | Skip dot files                                  |
| `cacheControl`       | off             | `Cache-Control` headers, see below              |
| `headersFile`        | `false`         | Apply the root `_headers` file, see below       |
| `disabled`           | `false`         | Skip the primitive entirely                     |
| `name`               | the field name  | Name used in logs                               |
| `silent`             | `false`         | Suppress this primitive's logging               |

### Single-page apps want `historyApiFallback`

A client-side router owns routes the server has no file for. Without
`historyApiFallback`, a visitor who reloads on `/settings/profile` gets a 404,
because there is no `settings/profile.html` on disk. With it, every miss is
answered by `index.html` and the router takes over.

Do not turn it on for a directory that also serves an API, since it converts
every genuine 404 into a page.

### `ignoreDotEnvFiles` defaults to on, and should stay on

The default skips dot files, which is the difference between serving your build
output and serving your `.env`. It is worth being deliberate about the one case
where you would turn it off (a `.well-known` directory), and worth serving that
from its own narrow `$serve` rather than opening the whole root.

### Cache headers

`cacheControl` is off unless you ask for it. Pass `{}` for the defaults:

```typescript check
import { $serve } from "alepha/server/static";

class Assets {
  public = $serve({
    path: "/static",
    root: "./dist/client",
    cacheControl: {
      maxAge: [1, "year"],
      immutable: true,
    },
  });
}
```

| Option      | Default                                                       | Effect                                         |
| ----------- | ------------------------------------------------------------- | ---------------------------------------------- |
| `fileTypes` | js, css, woff, woff2, ttf, eot, otf, jpg, jpeg, png, svg, gif | Extensions that get the header                 |
| `maxAge`    | `[30, "days"]`                                                | Freshness lifetime                             |
| `immutable` | `true`                                                        | Adds `immutable`, so browsers never revalidate |

`immutable` is only safe for content-hashed filenames. A build that emits
`app.js` rather than `app.4f2a1c.js` and marks it immutable for a year has just
made that file unfixable in every browser that saw it.

### `_headers` files

`headersFile: true` applies the Cloudflare-style `_headers` file at the root of
the served directory to every response, so one build sends the same headers on
every host. `alepha build` writes that file into `dist/public`, and the app's
own public server turns this on; any other `$serve` leaves it off.

The file is read once at boot, and a line that does not parse fails the boot.
Its matching rules are applied after every other response hook; a response no
rule caches gets `public, max-age=0, must-revalidate`, and `cacheControl` is
ignored. Whether or not the option is on, `/_headers`, `/_redirects` and
`/.assetsignore` are never served.

## `$proxy`

`$proxy` forwards a path family to another origin: an API gateway in front of
services, a legacy backend you are strangling, a dev-time bridge to something
running elsewhere.

```typescript check
import { $proxy } from "alepha/server/proxy";

class Gateway {
  api = $proxy({
    path: "/legacy/*",
    target: "https://legacy.example.com",
  });
}
```

```typescript
import { AlephaServerProxy } from "alepha/server/proxy";

alepha.with(AlephaServerProxy);
```

**`path` must end in `/*`.** A `path` without the wildcard throws
`Proxy path should end with '/*'` when the server configures, rather than
quietly matching one URL. The proxy answers every method on that path family.

The upstream URL is `target` plus the **full** request path, prefix included,
plus the query string: `/legacy/users?page=2` goes to
`https://legacy.example.com/legacy/users?page=2`. Strip the prefix with
`rewrite` when the upstream does not know it is mounted under one.

`target` takes a string or a function, and the function is re-read per request,
so it can resolve from configuration rather than being frozen at boot.

### Rewriting, and the two hooks

```typescript check
import { $proxy } from "alepha/server/proxy";

class Gateway {
  secure = $proxy({
    path: "/secure/*",
    target: "https://internal.example.com",
    rewrite: (url) => {
      url.pathname = url.pathname.replace("/secure", "");
    },
    beforeRequest: async (request, proxyRequest) => {
      proxyRequest.headers = {
        ...proxyRequest.headers,
        "X-Forwarded-Host": String(request.headers.host ?? ""),
      };
    },
    afterResponse: async (request, proxyResponse) => {
      if (!proxyResponse.ok) {
        // report it
      }
    },
  });
}
```

- `rewrite(url)` mutates the outgoing URL in place. The usual job is stripping
  the prefix that routed the request here, since the upstream service does not
  know it is mounted under `/secure`.
- `beforeRequest(request, proxyRequest)` mutates the outgoing `RequestInit`.
  This is where a service token or a forwarding header goes. On workerd it may
  also set `fetcher` to a service binding, which routes the subrequest through
  that Worker.
- `afterResponse(request, proxyResponse)` observes the response, after its
  status, headers (minus hop-by-hop ones, with every `set-cookie` kept) and
  body have been copied onto the reply.

`disabled` takes a boolean, read once when the server configures, which makes a
proxy a feature flag: point `/v2/*` at a new service and turn it off without
removing the declaration.

### It is a proxy, so it is a hole

Everything matching `path` leaves your process for another origin, carrying
whatever headers `beforeRequest` left in place. Two habits are worth keeping:
make `target` something you control rather than something derived from request
input, and mount the proxy under a prefix narrow enough that you can say out
loud what it covers.

## See also

- [Static Deployment](/docs/guides-deployment-static) for shipping a client
  build without a server at all
- [Middlewares](/docs/guides-server-middlewares) for `$middleware`, which
  applies behaviour to a path family the way `$proxy` forwards one
