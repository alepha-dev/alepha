# Build Command

Build your project for production. `alepha build` produces **one** `dist/`, carrying one server slice per runtime you asked for.

## Quick Start

```bash
alepha build                          # one node slice
alepha build --runtime node,workerd   # both, from one build
```

Your production-ready app is now in the `dist/` folder.

## One artifact, N runtimes

Releasing an app that runs on both Node and Cloudflare used to mean building twice. Both runs rebuilt the client bundle, re-prerendered and re-compressed the assets, and those are the slow steps: only the server link genuinely differs, and it differs by a handful of export conditions.

So the client bundle, the prerender, the compression, the headers, the PWA manifest and the build manifest all run **once**, and only the server link repeats. Measured on Lore: 15.2s for a workerd-only build against 15.4s for `node,workerd`, of which `build client` is 3.9s.

⚠️ **Declared order is meaningful.** The first runtime is the **primary**: it is `manifest.runtime`, it is what `dist/package.json`'s `main` points at, and it is what a deployer spawns. `["bun", "node"]` and `["node", "bun"]` produce the same two slices and different behaviour.

Then three commands turn that one `dist/` into the format you need:

| format  | command                                        | runtimes                                             |
| ------- | ---------------------------------------------- | ---------------------------------------------------- |
| binary  | [`alepha compile`](/docs/cli-commands-compile) | bun                                                  |
| archive | [`alepha pack`](/docs/cli-commands-pack)       | node, bun, workerd                                   |
| image   | [`alepha image`](/docs/cli-commands-image)     | node, bun, and bun via `--compile` for a small image |

⚠️ **There is no `--target`.** The build is described by what it produces: declaring a `workerd` slice is what writes the Cloudflare config, `runtime: ["static"]` is what makes a static site, and Docker is its own command.

## What It Does

The build runs a fixed pipeline of tasks:

1. **Cleans the dist folder**: Fresh start, no stale files
2. **Builds the client**: Compiles React, bundles assets, optimizes for browsers
3. **Builds the server**: one slice per declared runtime, and only this step repeats
4. **Copies assets**: Moves static files to the right places
5. **Generates the PWA manifest**: If `pwa` is configured
6. **Prerenders pages**: Sitemap and static pages, when applicable
7. **Generates deployment configs**: `wrangler.jsonc` when a workerd slice was built
8. **Pre-compresses assets**: Writes `.br` (Brotli) copies of client assets

## Output Structure

After building, your `dist/` folder looks like this:

```txt
dist/
├── index.node.js       # one entry wrapper per slice
├── index.workerd.js
├── server/
│   ├── node/           # each slice's chunks, namespaced
│   └── workerd/
├── public/             # static assets (CSS, JS, images)
│   ├── entry.abc123.js
│   ├── chunk.def456.js
│   └── favicon.svg
├── manifest.json       # what the build declared; `alepha pack` requires it
└── package.json        # `main` points at the primary slice
```

⚠️ **The slices are namespaced, and that is load-bearing.** Two runtimes built into one `server/` do not collide - their content hashes differ - so both sets would simply sit there, and the wrangler `server/*.js` glob would sweep the Node chunks into the Worker upload: a Worker twice the size it needs, or a Node chunk importing a node builtin and a refused deploy.

⚠️ **There is no `index.js` that works out its host.** The manifest is the discovery mechanism, because a second one able to disagree with it is worse than none.

Run your server with:

```bash
node dist                 # resolves the primary slice through `main`
node dist/index.node.js   # or name the slice
```

## Options

| Flag              | Description                                                                                                                                                 |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--runtime`, `-r` | Runtimes to link the server for, comma-separated and in order: `node`, `bun`, `workerd`. The first is the primary. `static` declares an app with no server. |
| `--stats`         | Generate build statistics report (use `--stats=json` for JSON output)                                                                                       |
| `--prebuilt`      | Skip the bundle steps; only regenerate the target-specific deploy config (e.g. `wrangler.jsonc`) when `dist/` is already built                              |

Declaring a `workerd` slice is what writes the Cloudflare deploy config; `runtime: ["static"]` is what makes a static site. There is no `--target`: the build is described by what it produces.

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
alepha build && alepha image
```

`alepha image` generates a `Dockerfile` **in the app directory** when there is none, beside `alepha.config.ts`, and reuses yours when there is: the file is meant to be committed and edited. It is not written into `dist/`, which the build wipes on every run.

```bash
alepha image --tag           # tag:latest
alepha image --tag=1.3.4     # tag:1.3.4
```

The generated image runs as uid `1000`, not root (`image.user` overrides it). `image.env` and `image.volumes` bake `ENV` defaults and `VOLUME` declarations into it, so a self-contained image needs no `docker run` flags - see the [Docker deployment guide](/docs/guides-deployment-docker).

`alepha image --compile` compiles the bun slice first and ships an image holding the binary and nothing else, on `gcr.io/distroless/cc-debian12` (`image.from` overrides it). That variant stays root: the base has no shell to prepare a volume with.

⚠️ A Bun `--compile` binary is **not static**, whatever triple it is built for: it needs an interpreter, `libstdc++` and `libgcc`. `alepha image` derives the triple from the base for that reason, and refuses a base with no libc (`scratch`, `distroless/static`) rather than producing a container that exits immediately.

⚠️ `alepha image` shells out to `docker build`, so it is a local and CI command. It cannot run in an in-process build path.

### Cloudflare Workers

```bash
alepha build --runtime=workerd    # or -t cf
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

Or let `alepha p up` drive the whole pipeline - provisioning, build, migrations, deploy, and secrets.

### Static Site

```bash
alepha build --runtime=static
```

Prerenders your pages to plain HTML/CSS/JS for any static host. Not compatible with `--prebuilt` (prerendering needs a live app).

## SEO Features

### Sitemap Generation

Add the [`$sitemap`](/docs/packages-alepha-react-sitemap) primitive to a router. It
serves `sitemap.xml` from your `$page` primitives - live at request time, and
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
    runtime: "bun",
    stats: true,
    compile: "myapp",
    docker: {
      image: { tag: "ghcr.io/myorg/myapp", oci: true },
    },
    pwa: {
      name: "My App",
      themeColor: "#0f172a",
    },
  },
});
```

Available options mirror the flags (`stats`, `target`, `runtime`, `compile`) plus per-target configuration. `compile` takes `true`, a binary name, or `{ name, target, minify }` for the Bun target triple and minification:

| Section      | Description                                                                                                                    |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `output`     | Override `dist` and `public` directory names                                                                                   |
| `cloudflare` | Extra `wrangler.jsonc` config merged into the generated file                                                                   |
| `docker`     | Base image, run command, global installs, baked `env`/`volumes`/`user`, image tag/args/OCI labels                              |
| `static`     | Surge domain for the `CNAME` file; `source` to adopt a client directory the workspace built itself (must live outside `dist/`) |
| `pwa`        | Web app manifest: name, short name, colors, display mode                                                                       |

## Client-Side Optimization

The build automatically:

- **Minifies JavaScript**: Removes whitespace, shortens variable names
- **Minifies CSS**: Combines and compresses styles
- **Tree shakes**: Removes unused code
- **Code splits**: Creates separate chunks for routes
- **Hashes filenames**: Enables aggressive caching
- **Pre-compresses assets**: Writes Brotli (`.br`) copies of JS/CSS/SVG/HTML

## Server-Side Optimization

The server build:

- **Bundles dependencies**: Single file, no `node_modules` needed in production
- **Externalizes Node built-ins**: Uses native `fs`, `path`, etc.
- **Preserves source maps**: Debug production issues when needed

> **Single File Deploy**
>
> Your production server is a single `index.js` file. No need to deploy `node_modules` - everything is bundled.

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
alepha build --runtime=workerd

# 3. Deploy
alepha platform up --env production
```

## Tips

**Run verify first.** The `alepha verify` command catches issues before you build. Don't ship broken code.

**Check bundle sizes.** Run `alepha build --stats` periodically. Large bundles slow down your users.

**Test the production build locally.** After building, run `node dist/index.js` locally before deploying. Catch issues early.

**Environment variables matter.** Make sure your production `.env` is correct. Wrong API URLs are a common deployment bug.
