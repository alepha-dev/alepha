# Docker Deployment

The `docker` build target packages your app for containerized deployment — a generated `Dockerfile` next to the bundled server, and optionally the image itself, built in the same command.

## Build

```bash
alepha build --target=docker
```

Produces:

```txt
dist/
  index.js       # Bundled server (single file)
  public/        # Client assets (if React frontend exists)
  migrations/    # Copied from your project (if present)
  Dockerfile     # Generated — do not edit
```

The generated Dockerfile is minimal because the app is already bundled:

```dockerfile
FROM node:24-alpine
WORKDIR /app
COPY . .
ENV SERVER_HOST=0.0.0.0
CMD ["node", "index.js"]
```

With `--runtime=bun`, the base image becomes `oven/bun:alpine` and the command `bun`. An `npm install` / `bun install` layer is added only when `dist/package.json` declares runtime dependencies — Alepha apps normally bundle everything via Vite, so there's usually nothing to install.

## Build the Image Too

Add `--image` to run `docker build` as the last step:

```bash
alepha build --target=docker --image           # <tag>:latest
alepha build --target=docker --image=1.3.4     # <tag>:1.3.4
alepha build --target=docker --image=myorg/app:v2   # full override
```

The default tag comes from config:

```typescript filename=alepha.config.ts
import { defineConfig } from "alepha/cli/config";

export default defineConfig({
  build: {
    target: "docker",
    docker: {
      image: {
        tag: "ghcr.io/myorg/myapp",
        args: "--platform linux/amd64",
        oci: true,   // add org.opencontainers.image.* labels (git revision, timestamp, version)
      },
    },
  },
});
```

## Configuration

| Option | Default | Description |
|--------|---------|-------------|
| `docker.from` | `node:24-alpine` / `oven/bun:alpine` | Base image for the `FROM` instruction |
| `docker.command` | `node` / `bun` | Command that runs the server |
| `docker.install` | `[]` | Extra packages installed into the image (e.g. `["wrangler"]` for an app that shells out to a CLI) |
| `docker.image` | — | Image tag, extra `docker build` args, OCI labels (used with `--image`) |
| `docker.compile` | — | Single-binary compile mode, see below |

## Compile Mode (Single Static Binary)

With `--runtime=bun --compile` (or `docker.compile` in config), the server is compiled to one static binary via `bun build --compile` and packaged in a distroless base image:

```bash
alepha build --target=docker --runtime=bun --compile --image
```

```dockerfile
FROM gcr.io/distroless/static-debian12
WORKDIR /app
COPY app .
ENV SERVER_HOST=0.0.0.0
ENTRYPOINT ["/app/app"]
```

- The binary lands at `dist/app`; `dist/index.js` and `dist/package.json` are removed.
- No package manager runs inside the image (distroless has no `npm`), so `docker.install` is ignored and any non-empty runtime `dependencies` fail the build loudly — compile requires fully-bundled output.
- `compile` accepts an object to override the Bun target triple (`bun-linux-arm64-musl`, ...), the base image, and minification.

The result is a minimal image with no shell, no package manager, and no interpreter — a small attack surface and a fast cold start.

## Running

```bash
docker run -p 3000:3000 --env-file .env.production ghcr.io/myorg/myapp:latest
```

`SERVER_HOST=0.0.0.0` is baked into the image so the server binds correctly inside the container; set `SERVER_PORT` if you need a port other than 3000 — or let a host that injects `PORT` (Cloud Run, Fly) decide, which the server reads as a fallback when `SERVER_PORT` is unset. Migrations ship in the image under `/app/migrations` — run them on startup via your orchestration, or from a release step with `alepha db migrations apply` pointed at the same `DATABASE_URL`.

## Tips

**Use OCI labels in CI.** `image.oci: true` stamps the git revision and build time on the image — invaluable when you're staring at a registry full of `latest` tags.

**Prefer compile mode for public-facing services.** Distroless plus a static binary removes whole vulnerability classes from the image.

**Keep secrets out of the image.** Nothing in `dist/` should contain secrets — inject them at runtime via `--env-file` or your orchestrator's secret store.
