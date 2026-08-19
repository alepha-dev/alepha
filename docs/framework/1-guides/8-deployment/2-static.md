# Static Deployment

The `static` build target generates a client-only bundle with no server code. This is for single-page applications (SPAs) that do not need server-side logic at runtime.

## Build

```bash
alepha build --target=static
```

The build process:

1. Builds client and server (server is used for SSR pre-rendering)
2. Pre-renders the root `/` page to `index.html`
3. Generates `404.html` and `200.html` as SPA shells (empty `<div id="root"></div>`)
4. Writes a `CNAME` file for Surge deployment
5. Removes all server artifacts, keeping only the `public/` directory

## Output Structure

```txt
dist/
  public/
    index.html      # Pre-rendered root page
    200.html         # SPA fallback
    404.html         # Not-found fallback
    CNAME            # Surge domain
    assets/          # JS, CSS, images
```

## Deploy

The output in `dist/public/` is plain HTML/CSS/JS - deploy it to any static host. With [Surge](https://surge.sh) (which the generated `CNAME` file targets):

```bash
alepha build --target=static
npx surge dist/public
```

Cloudflare Pages, Netlify, or GitHub Pages work just as well - point them at `dist/public/`.

## Configure Domain

Set a custom Surge domain in `alepha.config.ts`:

```typescript check
import { defineConfig } from "alepha/cli/config";

export default defineConfig({
  build: {
    target: "static",
    static: {
      domain: "myapp.surge.sh",
    },
  },
});
```

If no domain is specified, Alepha generates a deterministic domain from your `package.json` name: `{name}-{hash}.surge.sh`.

## Shipping a Client Built by Something Else

The steps above assume Alepha rendered the site: its own Vite client build, or a `$page` at `/`. A site built by anything else - a hand-written `index.html` through plain Vite, a static export from another tool - has no page for the target to render, and filling `dist/public/` yourself does not help either, because the build cleans `dist/` before any task runs.

Point `static.source` at the directory your own build fills instead:

```typescript check
import { defineConfig } from "alepha/cli/config";

export default defineConfig({
  build: {
    target: "static",
    static: {
      source: "dist-client",
    },
  },
});
```

```bash
vite build --outDir dist-client --emptyOutDir
alepha build --target=static
```

The directory is copied into `dist/public/` before the fallbacks are derived, so your `index.html` ships as written and `200.html`/`404.html` are stripped-down shells of it. Two rules:

- **It must live outside `dist/`.** A source inside it is refused by name - the clean step deletes it before it can be read.
- **It must contain an `index.html`.** Otherwise a static host has nothing to answer `/` with, and the build says so rather than failing later on a path you never wrote.

A server entry is still required, because the build boots the workspace to analyze it. Nothing of it ships - the static target keeps only the client directory and the manifest - so a bare `run(Alepha.create())` is enough for a site with no server of its own.

## Other Hosting Providers

The `dist/public/` directory is a standard static site. Deploy it to any static hosting:

- **GitHub Pages**: copy `dist/public/` to the `gh-pages` branch
- **Netlify**: set build output to `dist/public`
- **Cloudflare Pages**: set build output to `dist/public`

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

The sitemap lists every static `$page` (and the static entries of
parameterized pages), excluding layout, wildcard, and `404` routes.
