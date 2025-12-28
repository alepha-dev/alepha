# Deployment

You've built your app. Now you need to put it somewhere.

Alepha compiles to a standard Node.js application, but we optimize the output for different deployment targets. Same code, different runtimes. You write once, deploy anywhere.

## The Build Command

```bash
npx alepha build
```

This single command does a lot:
1. Compiles your TypeScript backend.
2. Bundles your React frontend with Vite.
3. Optimizes and minifies assets.
4. Outputs everything to `dist/`.

Add flags to target specific platforms:

```bash
npx alepha build --vercel      # Vercel serverless
npx alepha build --cloudflare  # Cloudflare Workers
npx alepha build --docker      # Docker container
npx alepha build --stats       # Show bundle analysis
```

## Choosing a Platform

| Target | Command | Best For |
|--------|---------|----------|
| Docker | `--docker` | Full control, any hosting |
| Vercel | `--vercel` | Easiest deployment, great DX |
| Cloudflare | `--cloudflare` | Edge performance, global reach |

Pick based on your needs:
- **"I want the easiest path"** → Vercel
- **"I need edge performance"** → Cloudflare Workers
- **"I want full control"** → Docker on any VPS

Your Alepha code stays the same. Only the deployment target changes.

## Next Steps

- [Docker Deployment](./2-docker.md) - Deploy to any VPS or container platform
- [Vercel Deployment](./3-vercel.md) - Serverless deployment with Vercel
- [Cloudflare Deployment](./4-cloudflare.md) - Edge deployment with Workers
- [File Storage](./5-file-storage.md) - Configure storage providers for production
- [Environment Variables](./6-environment.md) - Required configuration for production
