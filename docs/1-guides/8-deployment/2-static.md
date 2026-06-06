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

```
dist/
  public/
    index.html      # Pre-rendered root page
    200.html         # SPA fallback
    404.html         # Not-found fallback
    CNAME            # Surge domain
    assets/          # JS, CSS, images
```

## Deploy to Surge

`alepha deploy` detects the static build output (`dist/public/404.html`) and deploys to Surge:

```bash
alepha build --target=static
alepha deploy
```

If Surge is not installed, the deploy command installs it automatically as a dev dependency.

## Configure Domain

Set a custom Surge domain in `alepha.config.ts`:

```typescript
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

## Other Hosting Providers

The `dist/public/` directory is a standard static site. Deploy it to any static hosting:

- **GitHub Pages** -- copy `dist/public/` to the `gh-pages` branch
- **Netlify** -- set build output to `dist/public`
- **Cloudflare Pages** -- set build output to `dist/public`
- **Vercel (static)** -- set output to `dist/public`

The `200.html` file serves as the SPA fallback for hosting providers that support it (Surge, Netlify). Configure your hosting provider's rewrite rules to serve `200.html` for all unmatched routes.

## Sitemap

Add the `$sitemap` primitive to a router. It is prerendered to
`dist/public/sitemap.xml` alongside the static build:

```typescript
import { $sitemap } from "alepha/react/sitemap";

class AppRouter {
  // hostname defaults to PUBLIC_URL, then "" (relative URLs)
  sitemap = $sitemap({ hostname: "https://myapp.com" });
}
```

The sitemap lists every static `$page` (and the static entries of
parameterized pages), excluding layout, wildcard, and `404` routes.
