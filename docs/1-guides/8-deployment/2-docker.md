# Docker Deployment

The `docker` build target generates a Dockerfile alongside the production bundle.

## Build

```bash
alepha build --target=docker
```

This produces the standard `dist/` output plus a `Dockerfile`.

## Generated Dockerfile

The default Dockerfile for the Node.js runtime:

```dockerfile
FROM node:24-alpine
WORKDIR /app
COPY . .
RUN npm install
ENV SERVER_HOST=0.0.0.0
CMD ["node", "index.js"]
```

For the Bun runtime (`--runtime=bun`):

```dockerfile
FROM oven/bun:alpine
WORKDIR /app
COPY . .
RUN bun install
ENV SERVER_HOST=0.0.0.0
CMD ["bun", "index.js"]
```

## Build Docker Image

Build the image in a single command:

```bash
alepha build --target=docker --image
```

This requires `build.docker.image.tag` in the config. The `--image` flag accepts optional values:

```bash
alepha build --target=docker --image              # tag:latest (uses config tag)
alepha build --target=docker --image=:1.3.4       # tag:1.3.4 (version only)
alepha build --target=docker --image=myapp:v1     # full override
alepha build --target=docker --image=myapp        # myapp:latest
```

## Configuration

Full Docker configuration in `alepha.config.ts`:

```typescript
import { defineConfig } from "alepha/cli/config";

export default defineConfig({
  build: {
    target: "docker",
    docker: {
      from: "node:24-alpine",
      command: "node",
      image: {
        tag: "ghcr.io/myorg/myapp",
        args: "--platform linux/amd64",
        oci: true,
      },
    },
  },
});
```

### Options

| Option | Default | Description |
|--------|---------|-------------|
| `from` | `node:24-alpine` (node) / `oven/bun:alpine` (bun) | Base Docker image |
| `command` | `node` / `bun` | Runtime command in the container |
| `image.tag` | -- | Image name for `--image` flag |
| `image.args` | -- | Extra `docker build` arguments |
| `image.oci` | `false` | Add OCI standard labels (revision, created, version) |

## OCI Labels

When `oci: true`, the build adds these labels automatically:

- `org.opencontainers.image.revision` -- git commit SHA
- `org.opencontainers.image.created` -- build timestamp
- `org.opencontainers.image.version` -- image version from tag

## Database Migrations

If your project uses `$entity` and has a `drizzle/` directory, migrations are copied into `dist/drizzle/` and included in the Docker image.

## Push to Registry

Alepha does not handle image pushing. Use `docker push` after building:

```bash
alepha build --target=docker --image=ghcr.io/myorg/myapp:v1
docker push ghcr.io/myorg/myapp:v1
```
