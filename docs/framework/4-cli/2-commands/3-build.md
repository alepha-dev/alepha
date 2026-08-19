# Build Command

Build your project for production. The `build` command compiles, optimizes, and prepares your app for deployment — whether that's a Node.js server, Docker, Cloudflare Workers, or a static site.

## Quick Start

```bash
alepha build
```

Your production-ready app is now in the `dist/` folder.

## What It Does

The build runs a fixed pipeline of tasks:

1. **Cleans the dist folder** — Fresh start, no stale files
2. **Builds the client** — Compiles React, bundles assets, optimizes for browsers
3. **Builds the server** — Compiles your backend code for the target runtime
4. **Copies assets** — Moves static files to the right places
5. **Generates the PWA manifest** — If `pwa` is configured
6. **Prerenders pages** — Sitemap and static pages, when applicable
7. **Generates deployment configs** — Cloudflare, Docker, static (if requested)
8. **Pre-compresses assets** — Writes `.br` (Brotli) copies of client assets

## Output Structure

After building, your `dist/` folder looks like this:

```txt
dist/
├── index.js          # Server entry point
├── public/           # Static assets (CSS, JS, images)
│   ├── assets/
│   │   ├── index-abc123.js
│   │   └── index-def456.css
│   └── favicon.svg
├── manifest.json     # Build manifest (every target; `alepha pack` requires it)
└── package.json      # Production dependencies
```

Run your server with:

```bash
node dist/index.js
```

## Options

| Flag | Description |
|------|-------------|
| `--target`, `-t` | Deployment target: `bare`, `docker`, `cloudflare` (alias: `cf`), or `static` |
| `--runtime`, `-r` | JavaScript runtime: `node`, `bun`, or `workerd` |
| `--stats` | Generate build statistics report (use `--stats=json` for JSON output) |
| `--image`, `-i` | Build Docker image (`-i` for latest, `-i=<version>` for specific version). Requires `--target=docker` |
| `--compile`, `-c` | Compile the server to a single static binary. Requires `--target=docker --runtime=bun` |
| `--prebuilt` | Skip the bundle steps; only regenerate the target-specific deploy config (e.g. `wrangler.jsonc`) when `dist/` is already built |

Some targets force a runtime: `cloudflare` always uses `workerd`.

## Deployment Targets

### Standard Node.js Server

```bash
alepha build
```

Deploy anywhere that runs Node.js:

```bash
# Copy dist/ to your server
scp -r dist/ user@server:/app

# On the server
cd /app && node index.js
```

### Docker

```bash
alepha build --target=docker
```

Generates a `Dockerfile` alongside the build. Add `--image` to build the image in one go:

```bash
alepha build --target=docker --image           # tag:latest
alepha build --target=docker --image=1.3.4     # tag:1.3.4
```

With `--runtime=bun --compile`, the server is compiled to a single static binary via `bun build --compile` and packaged in a minimal distroless base image.

### Cloudflare Workers

```bash
alepha build --target=cloudflare    # or -t cf
```

Creates Cloudflare Workers configuration:

```txt
dist/
├── main.cloudflare.js  # Worker entry point
├── wrangler.jsonc      # Wrangler configuration
├── manifest.json       # Build manifest (detected resources, declared env keys)
└── public/             # Static assets (if any)
```

> **D1 Database Support**
>
> If your `DATABASE_URL` uses the `d1://` protocol (as injected by the [platform plugin](/docs/cli-plugins-platform)), the D1 binding is automatically configured in `wrangler.jsonc`.

Then deploy:

```bash
cd dist && wrangler deploy
```

Or let `alepha p up` drive the whole pipeline — provisioning, build, migrations, deploy, and secrets.

### Static Site

```bash
alepha build --target=static
```

Prerenders your pages to plain HTML/CSS/JS for any static host. Not compatible with `--prebuilt` (prerendering needs a live app).

## SEO Features

### Sitemap Generation

Add the [`$sitemap`](/docs/packages-alepha-react-sitemap) primitive to a router. It
serves `sitemap.xml` from your `$page` primitives — live at request time, and
prerendered to `dist/public/sitemap.xml` at build time (so static deployments get
the file too):

```typescript check
import { $sitemap } from "alepha/react/sitemap";

class AppRouter {
  // hostname defaults to PUBLIC_URL, then "" (relative URLs)
  sitemap = $sitemap({ hostname: "https://myapp.com" });
}
```

Produces `dist/public/sitemap.xml` with all your routes:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://myapp.com/</loc>
    <lastmod>2026-06-06</lastmod>
  </url>
  <url>
    <loc>https://myapp.com/about</loc>
    <lastmod>2026-06-06</lastmod>
  </url>
  <!-- ... -->
</urlset>
```

## Build Statistics

```bash
alepha build --stats
```

Generates interactive reports about your bundles:

```bash
# View client bundle analysis
open dist/public/stats.html

# View server bundle analysis
open dist/stats.html
```

The reports show:

- File sizes (before and after compression)
- Chunk breakdown
- Dependency analysis

> **Bundle Analysis**
>
> Use this to find large dependencies dragging down your bundle size.

## Environment Variables

The build process respects your environment:

```bash filename=.env.production
API_URL=https://api.myapp.com
```

> **Build-time Variables**
>
> Environment variables are embedded at build time. For variables that should differ between environments, use runtime configuration instead.

## Build Configuration

Defaults for the build command live in the `build` section of `alepha.config.ts`. Command-line flags override them:

```typescript filename=alepha.config.ts
import { defineConfig } from "alepha/cli/config";

export default defineConfig({
  build: {
    target: "docker",
    runtime: "bun",
    stats: true,
    docker: {
      image: { tag: "ghcr.io/myorg/myapp", oci: true },
      compile: true,
    },
    pwa: {
      name: "My App",
      themeColor: "#0f172a",
    },
  },
});
```

Available options mirror the flags (`stats`, `target`, `runtime`) plus per-target configuration:

| Section | Description |
|---------|-------------|
| `output` | Override `dist` and `public` directory names |
| `cloudflare` | Extra `wrangler.jsonc` config merged into the generated file |
| `docker` | Base image, run command, global installs, image tag/args/OCI labels, `compile` mode |
| `static` | Surge domain for the `CNAME` file; `source` to adopt a client directory the workspace built itself (must live outside `dist/`) |
| `pwa` | Web app manifest: name, short name, colors, display mode |

## Client-Side Optimization

The build automatically:

- **Minifies JavaScript** — Removes whitespace, shortens variable names
- **Minifies CSS** — Combines and compresses styles
- **Tree shakes** — Removes unused code
- **Code splits** — Creates separate chunks for routes
- **Hashes filenames** — Enables aggressive caching
- **Pre-compresses assets** — Writes Brotli (`.br`) copies of JS/CSS/SVG/HTML

## Server-Side Optimization

The server build:

- **Bundles dependencies** — Single file, no `node_modules` needed in production
- **Externalizes Node built-ins** — Uses native `fs`, `path`, etc.
- **Preserves source maps** — Debug production issues when needed

> **Single File Deploy**
>
> Your production server is a single `index.js` file. No need to deploy `node_modules` — everything is bundled.

## Backend-Only Projects

If your project has no browser entry, the build only creates the server:

```bash
alepha build
# → dist/index.js (your server/CLI/worker)
```

Perfect for:
- API servers
- CLI tools
- Background workers
- Scheduled jobs

## Build Workflow

A typical deployment workflow:

```bash
# 1. Verify everything works
alepha verify

# 2. Build for production
alepha build --target=cloudflare

# 3. Deploy
alepha platform up --env production
```

## Tips

**Run verify first.** The `alepha verify` command catches issues before you build. Don't ship broken code.

**Check bundle sizes.** Run `alepha build --stats` periodically. Large bundles slow down your users.

**Test the production build locally.** After building, run `node dist/index.js` locally before deploying. Catch issues early.

**Environment variables matter.** Make sure your production `.env` is correct. Wrong API URLs are a common deployment bug.
