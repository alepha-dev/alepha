# Deployment

You've built your app. Now you need to put it somewhere.
Alepha applications compile down to a standard Node.js app, but we optimize the output structure for different targets.

## The Build Command

```bash
npx alepha build
```

This command does a lot:
1.  Compiles your backend code.
2.  Compiles your frontend code (Vite).
3.  Optimizes assets.
4.  Generates a `dist/` folder.

## Target: Docker / VPS

If you want to run on a VPS (DigitalOcean, Hetzner, AWS EC2) or a container platform (Fly.io, ECS), Alepha generates a `Dockerfile` for you automatically in the `dist/` folder.

```bash
# 1. Build
npx alepha build --docker

# 2. Build image
docker build -t my-app ./dist

# 3. Run
docker run -p 3000:3000 -e DATABASE_URL=... my-app
```

The generated Docker image is extremely lightweight because we prune `node_modules` to only include production dependencies.

## Target: Vercel (Serverless)

Alepha works natively with Vercel. When you build with the `--vercel` flag, we generate the specific `.vercel` output directory structure required by their platform.

```bash
# Build for Vercel
npx alepha build --vercel
```

Your `$action`s become Serverless Functions.
Your `$page`s become SSR functions.
Your `$static` files become CDN assets.

## Target: Cloudflare (Workers)

Cloudflare Workers run at the edge, close to your users. When you build with the `--cloudflare` flag, Alepha generates a Workers-compatible bundle.

```bash
# Build for Cloudflare
npx alepha build --cloudflare
```

This outputs a `dist/` folder with a `wrangler.toml` and the compiled worker. Deploy with:

```bash
cd dist && npx wrangler deploy
```

Alepha automatically adapts to the Workers runtime:
*   Uses the Fetch API instead of Node.js HTTP.
*   Binds to Cloudflare KV, D1, or R2 if you configure them.
*   Your `$action`s run on the edge with sub-millisecond cold starts.

## Environment Variables

Alepha loads environment variables from `.env` files during development.
In production, `Alepha.create()` reads from the system environment variables (`process.env`).

Always ensure your production environment has:
*   `NODE_ENV=production`
*   `APP_SECRET` (A long random string for signing cookies)
*   `DATABASE_URL`
