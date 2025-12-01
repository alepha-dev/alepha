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

## Environment Variables

Alepha loads environment variables from `.env` files during development.
In production, `Alepha.create()` reads from the system environment variables (`process.env`).

Always ensure your production environment has:
*   `NODE_ENV=production`
*   `APP_SECRET` (A long random string for signing cookies)
*   `DATABASE_URL`
