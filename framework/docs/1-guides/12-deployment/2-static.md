# Static Deployment

The `static` runtime declaration generates a client-only bundle with no server code. This is for single-page applications (SPAs) that do not need server-side logic at runtime.

## Build

```bash
alepha build --runtime=static
```

`static` anywhere in `build.runtime` makes the whole build static, whatever else the list names. The build process:

1. Builds the client. No server bundle is built: the build analyzes the app in-process instead, to learn its pages.
2. Prerenders every `static: true` page, every `$route({ static: true })` and every `$sitemap` not set to `static: false`, as an SSR build does.
3. Writes `index.html`. A `/` page prerendered in step 2 keeps its HTML; otherwise the `$page` at `/` (one declaring `path: "/"` or leaving `path` out, and with no children) is rendered and stripped to an empty `<div id="root"></div>`, and an app with none fails here.
4. Writes `404.html` and `200.html`, SPA shells of `index.html`, and a `CNAME` file for Surge. Each is written only if your `public/` did not already provide it.
   When the app declares a [`browser: true` env key](/docs/guides-core-configurations#reading-a-variable-in-the-browser), it also writes `config.js` with their values at build time, and every emitted HTML file loads it before the entry.
5. Removes everything but `public/` and the manifest.
6. Writes [`_headers`](/docs/guides-deployment-headers) and a brotli `.br` copy of each compressible file.

`--prebuilt` is refused: a static build needs the live app to render its pages.

## Output Structure

```txt
dist/
  public/
    index.html      # Prerendered `/` page, or the SPA shell
    200.html         # SPA fallback
    404.html         # Not-found fallback
    CNAME            # Surge domain
    _headers         # Cache and security headers, for hosts that read it
    config.js        # The browser: true env keys, when the app declares any
    entry.*.js, chunk.*.js, asset.*   # JS, CSS, images, at the root
    *.br             # Brotli copies, for hosts that serve them
  manifest.json      # What the build declared
```

## Deploy

The output in `dist/public/` is plain HTML, CSS and JS: deploy it to any static host. With [Surge](https://surge.sh) (which the generated `CNAME` file targets):

```bash
alepha build --runtime=static
npx surge dist/public
```

Cloudflare Pages, Netlify, or GitHub Pages work just as well: point them at `dist/public/`. Cloudflare Pages and Netlify read the `_headers` file as is.

## One Build, Many Environments

A static site has no server to read its environment, so the build writes the
[`browser: true` env keys](/docs/guides-core-configurations#reading-a-variable-in-the-browser)
into one file, `dist/public/config.js`, with the build machine's values:

```js
globalThis.__ALEPHA_ENV__ = { API_URL: "https://api.example.com" };
```

Every HTML file the build emits loads it with `<script src="/config.js">`
before the entry, an external script so a strict CSP accepts it. To ship the
same files to staging and production, the host replaces that one file per
environment. `manifest.json` lists the keys it must hold under `browser`, so
the file can be written without booting the app. In a container, the
entrypoint writes it from the container's environment before the server
starts:

```bash
printf 'globalThis.__ALEPHA_ENV__ = %s;\n' "$(jq -cn '{API_URL: env.API_URL}')" > /srv/public/config.js
```

`alepha image` packages the site with a server that answers `/config.js` from
the container's environment instead, so no entrypoint is needed there (see
[A static site](/docs/guides-deployment-docker#a-static-site)).

The build gives `config.js` no `.br` sibling and `_headers` caches it with
`max-age=0, must-revalidate`, never `immutable`: a host that preferred a stale
precompressed copy, or a browser that kept it for a year, would undo the
rewrite. A page prerendered at build time carries no value of its own either,
so the build machine's values never win over the runtime ones. A component that
renders a browser key into the page does show the build-time value until the
browser hydrates with the runtime one: read such a key in the browser only, or
keep the page out of the prerender.

## Configure Domain

Set a custom Surge domain in `alepha.config.ts`:

```typescript check
import { defineConfig } from "alepha/cli/config";

export default defineConfig({
  build: {
    runtime: ["static"],
    static: {
      domain: "myapp.surge.sh",
    },
  },
});
```

If no domain is specified, Alepha generates a deterministic domain from your `package.json` name: `{name}-{hash}.surge.sh`.

## Shipping a Client Built by Something Else

The steps above assume Alepha rendered the site: its own Vite client build, or a `$page` at `/`. A site built by anything else - a hand-written `index.html` through plain Vite, a static export from another tool - has no page for the build to render, and filling `dist/public/` yourself does not help either, because the build cleans `dist/` before any task runs.

Point `build.static.source` at the directory your own build fills instead:

```typescript check
import { defineConfig } from "alepha/cli/config";

export default defineConfig({
  build: {
    runtime: ["static"],
    static: {
      source: "dist-client",
    },
  },
});
```

```bash
vite build --outDir dist-client --emptyOutDir
alepha build --runtime=static
```

The directory is copied into `dist/public/` before the fallbacks are derived, so your `index.html` ships as written and `200.html`/`404.html` are stripped-down shells of it. Two rules:

- **It must live outside `dist/`.** A source inside it is refused by name - the clean step deletes it before it can be read.
- **It must contain an `index.html`.** Otherwise a static host has nothing to answer `/` with, and the build says so rather than failing later on a path you never wrote.

A server entry is still required, because the build boots the workspace to analyze it. Nothing of it ships - the static build keeps only the client directory and the manifest - so a bare `run(Alepha.create())` is enough for a site with no server of its own.

## Other Hosting Providers

The `dist/public/` directory is a standard static site. Deploy it to any static hosting:

- **GitHub Pages**: copy `dist/public/` to the `gh-pages` branch
- **Netlify**: set build output to `dist/public`
- **Cloudflare Pages**: set build output to `dist/public`
- **A container platform**: `alepha image` builds an image serving the site (see [A static site](/docs/guides-deployment-docker#a-static-site))

The `200.html` file serves as the SPA fallback for hosting providers that support it (Surge, Netlify). Configure your hosting provider's rewrite rules to serve `200.html` for all unmatched routes.

## Sitemap

Add the `$sitemap` primitive to a router. It is prerendered to
`dist/public/sitemap.xml` alongside the static build:

```typescript check
import { $sitemap } from "alepha/react/sitemap";

class AppRouter {
  // hostname defaults to PUBLIC_URL, then "" (relative URLs)
  sitemap = $sitemap({ hostname: "https://myapp.com" });
}
```

The sitemap lists every leaf `$page` with no parameter, `static` or not, and the
`static.entries` of a page with parameters, excluding wildcard paths and `/404`. See
[Sitemap](/docs/guides-frontend-sitemap#which-pages-it-lists).
