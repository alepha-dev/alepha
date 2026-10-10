# Docker Deployment

Build a runtime artifact, then turn it into a container image:

```bash
alepha build --runtime node
alepha image --tag
```

`alepha image` reads `dist/manifest.json` and packages the first declared runtime slice. A workerd or static primary slice is refused because it cannot start a container process. The docker CLI is required; this command belongs to a local machine or CI runner.

## Dockerfile ownership

With no Dockerfile in the app directory, Alepha generates one beside `alepha.config.ts`. Commit and edit that file. An existing Dockerfile is reused unchanged, with a warning if the manifest facts recorded in its header have moved. The build context is `dist/`, not the app directory.

```bash
alepha image --dockerfile         # generate without building an image
alepha image --tag=1.3.4          # configured name, version 1.3.4
alepha image --tag=myorg/app:v2   # complete tag override
```

The artifact has an `index.<runtime>.js` wrapper, `server/<runtime>/` chunks, `public/` assets, its manifest and package metadata. Migrations are copied into the image context when present. There is no generated Dockerfile inside `dist/`.

## Configuration

Image settings are top-level `image`, separate from `build`:

```typescript check filename=alepha.config.ts
import { defineConfig } from "alepha/cli/config";

export default defineConfig({
  build: { runtime: ["node"] },
  image: {
    env: {
      DATA_DIR: "/data",
      DATABASE_URL: "sqlite:///data/app.db",
    },
    volumes: ["/data"],
    image: {
      tag: "ghcr.io/myorg/myapp",
      oci: true,
      source: "https://github.com/myorg/myapp",
    },
  },
});
```

| Setting              | Meaning                                                  |
| -------------------- | -------------------------------------------------------- |
| `image.from`         | Base image override                                      |
| `image.command`      | Server command override                                  |
| `image.install`      | Extra packages for the generated standard image          |
| `image.env`          | Baked defaults, overridden by runtime environment values |
| `image.volumes`      | Volume mount points                                      |
| `image.user`         | Container user override (standard default: uid 1000)     |
| `image.image.tag`    | Default image name                                       |
| `image.image.args`   | Additional docker build arguments                        |
| `image.image.oci`    | Revision, timestamp and version labels                   |
| `image.image.source` | Repository URL label, set explicitly                     |

The generated standard image uses a Node or Bun base and installs runtime dependencies only when the artifact declares them. Each declared volume is prepared before its `VOLUME` line. Named volumes inherit those permissions; bind mounts retain the host directory's permissions. Baked values are public image defaults, so deliver secrets at runtime.

## Compiled image

```bash
alepha build --runtime bun
alepha image --compile --tag
```

This compiles the Bun slice first, then packages the binary on `gcr.io/distroless/cc-debian12` by default. `--compile my-app` names the binary. The base determines the Linux Bun target triple: a Bun binary needs libc and supporting libraries, so `scratch` and `distroless/static` are refused. A compiled image has no default user; set `image.user` when needed. Runtime dependencies must be bundled, and `image.install` is ignored in this mode.

For a binary without an image, use [alepha compile](/docs/cli-commands-compile). For the complete image contract, see [alepha image](/docs/cli-commands-image).

## Running

```bash
docker run -p 3000:3000 --env-file .env.production ghcr.io/myorg/myapp:latest
```

The generated image sets `SERVER_HOST=0.0.0.0`; supply `SERVER_PORT` to change the listening port. Both standard and compiled apps serve their client assets and apply the artifact's `_headers` file. See [Static File Headers](/docs/guides-deployment-headers).

Container images are an artifact format. [alepha deploy](/docs/cli-plugins-infra) drives configured infrastructure adapters; it does not turn a Docker image into an implicit provider deployment.
