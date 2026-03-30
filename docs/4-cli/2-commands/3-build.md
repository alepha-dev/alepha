# Build Command

Build your project for production. The `build` command compiles, optimizes, and prepares your app for deployment — whether that's a Node.js server, Vercel, or Cloudflare Workers.

## Quick Start

```bash
alepha build
```

Your production-ready app is now in the `dist/` folder.

## What It Does

The build process handles everything:

1. **Cleans the dist folder** — Fresh start, no stale files
2. **Builds the client** — Compiles React, bundles assets, optimizes for browsers
3. **Builds the server** — Compiles your backend code for Node.js
4. **Copies assets** — Moves static files to the right places
5. **Generates deployment configs** — Vercel, Cloudflare (if requested)

## Output Structure

After building, your `dist/` folder looks like this:

```
dist/
├── index.js          # Server entry point
├── public/           # Static assets (CSS, JS, images)
│   ├── assets/
│   │   ├── index-abc123.js
│   │   └── index-def456.css
│   └── favicon.ico
└── package.json      # Production dependencies
```

Run your server with:

```bash
node dist/index.js
```

## Options

| Flag | Description |
|------|-------------|
| `--target`, `-t` | Deployment target: `bare`, `docker`, `vercel`, `cloudflare`, or `static` |
| `--runtime`, `-r` | JavaScript runtime: `node`, `bun`, or `workerd` |
| `--stats` | Generate build statistics report (use `--stats=json` for JSON output) |
| `--image`, `-i` | Build Docker image (`-i` for latest, `-i=<version>` for specific version). Requires `--target=docker` |
| `--sitemap=<url>` | Generate sitemap.xml with the given base URL |

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

### Vercel

```bash
alepha build --target=vercel
```

Creates a minimal Vercel serverless configuration:

```
dist/
├── api/
│   └── index.js      # Serverless function entry
├── vercel.json       # Route rewrites
├── .vercel/
│   └── project.json  # Project link (if env vars set)
└── public/
```

> **Environment Variables Required**
>
> Set `VERCEL_PROJECT_ID` and `VERCEL_ORG_ID` in your `.env.production` to automatically link to your Vercel project.

Then deploy:

```bash
cd dist && vercel --prod
```

### Cloudflare Workers

```bash
alepha build --target=cloudflare
```

Creates Cloudflare Workers configuration:

```
dist/
├── main.cloudflare.js  # Worker entry point
├── wrangler.jsonc      # Wrangler configuration
└── public/             # Static assets (if any)
```

> **D1 Database Support**
>
> If your `DATABASE_URL` starts with `cloudflare-d1:`, the D1 binding is automatically configured in `wrangler.jsonc`.

Then deploy:

```bash
cd dist && wrangler deploy
```

## SEO Features

### Sitemap Generation

```bash
alepha build --sitemap=https://myapp.com
```

Generates `dist/public/sitemap.xml` with all your routes:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://myapp.com/</loc>
  </url>
  <url>
    <loc>https://myapp.com/about</loc>
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

## Vite Plugin Configuration

Advanced build options can be configured in `vite.config.ts`:

```typescript
import alepha from "@alepha/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    alepha({
      // Build options
      stats: true,
      vercel: true,
      client: {
        sitemap: {
          hostname: "https://myapp.com",
        },
        precompress: true,  // Generate .gz and .br files
      },
    }),
  ],
});
```

> **Config vs Flags**
>
> These defaults are used when you run `alepha build` without flags. Command-line flags override config file settings.

## Client-Side Optimization

The build automatically:

- **Minifies JavaScript** — Removes whitespace, shortens variable names
- **Minifies CSS** — Combines and compresses styles
- **Tree shakes** — Removes unused code
- **Code splits** — Creates separate chunks for routes
- **Hashes filenames** — Enables aggressive caching
- **Compresses assets** — Optional pre-compression with gzip/brotli

## Server-Side Optimization

The server build:

- **Bundles dependencies** — Single file, no `node_modules` needed in production
- **Externalizes Node built-ins** — Uses native `fs`, `path`, etc.
- **Preserves source maps** — Debug production issues when needed

> **Single File Deploy**
>
> Your production server is a single `index.js` file. No need to deploy `node_modules` — everything is bundled.

## Backend-Only Projects

If you don't have `alepha/react` installed, the build only creates the server:

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
alepha build --vercel

# 3. Deploy
cd dist && vercel --prod
```

## Tips

**Run verify first.** The `alepha verify` command catches issues before you build. Don't ship broken code.

**Check bundle sizes.** Run `alepha build --stats` periodically. Large bundles slow down your users.

**Test the production build locally.** After building, run `node dist/index.js` locally before deploying. Catch issues early.

**Environment variables matter.** Make sure your production `.env` is correct. Wrong API URLs are a common deployment bug.
