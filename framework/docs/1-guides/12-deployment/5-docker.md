# Docker Deployment

Build a runtime artifact, then turn it into a container image:

```bash
alepha build --runtime node
alepha image --tag
```

`manifest.json` requires `manifestVersion: 2`. Rebuild an older artifact before deploying it. Lore, Bay and other artifact consumers must accept this major; additive fields do not change it.

`alepha image` reads `manifest.json` from `build.output.dist` (default `dist/`) and packages the first declared runtime slice. Building needs an image name: `image.tag` in the config (see below), unless `--tag` is a complete `name:tag`. A workerd or static primary slice is refused because it cannot start a container process. The docker CLI is required; this command belongs to a local machine or CI runner.

## Dockerfile ownership

With no Dockerfile in the app directory, Alepha generates one beside `alepha.config.ts`. Commit and edit that file. An existing Dockerfile is reused unchanged, with a warning if the manifest facts recorded in its header have moved. The build context is `dist/`, not the app directory.

```bash
alepha image --dockerfile         # generate without building an image
alepha image --tag=1.3.4          # configured name, version 1.3.4
alepha image --tag=myorg/app:v2   # complete tag override
```

| `--tag` value        | Image                    |
| -------------------- | ------------------------ |
| `--tag`, no value    | `<image.tag>:latest`     |
| `--tag=1.3.4`        | `<image.tag>:1.3.4`      |
| `--tag=:1.3.4`       | `<image.tag>:1.3.4`      |
| `--tag=myorg/app:v2` | `myorg/app:v2`, verbatim |

Every form but the last needs `image.tag` in the config.

The artifact has an `index.<runtime>.js` wrapper, `server/<runtime>/` chunks, `public/` assets, its manifest and package metadata, and with `build.sbom` a CycloneDX SBOM of what the bundles contain (`sbom.cdx.json`, see [Software Bill of Materials](/docs/cli-commands-build#software-bill-of-materials)). Migrations are copied into the image context when present. There is no generated Dockerfile inside `dist/`.

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
    tag: "ghcr.io/myorg/myapp",
    oci: true,
    labels: {
      source: "https://github.com/myorg/myapp",
      licenses: "MIT",
    },
  },
});
```

| Setting            | Meaning                                                  |
| ------------------ | -------------------------------------------------------- |
| `image.from`       | Base image (default `node:24-alpine`, `oven/bun:alpine`) |
| `image.command`    | Server command (default `node` or `bun`)                 |
| `image.install`    | Extra packages for the generated standard image          |
| `image.env`        | Baked defaults, overridden by runtime environment values |
| `image.volumes`    | Volume mount points                                      |
| `image.user`       | Container user (default 1000, 65532:65532 compiled)      |
| `image.tag`        | Default image name                                       |
| `image.args`       | Docker build arguments as a string array                 |
| `image.sbom`       | Attach an SBOM attestation (needs `build.sbom`)          |
| `image.provenance` | Attach a `mode=max` provenance attestation               |
| `image.oci`        | Write the OCI labels below                               |
| `image.labels`     | `source`, `title`, `description`, `licenses`             |

With `oci: true`, each `image.labels` field becomes an `org.opencontainers.image.*` `LABEL` line in the generated Dockerfile (`source` is what links a GHCR package to its repository), and `alepha image` adds `revision` (the git commit), `created` and `version` (from the tag) at build time. Without `oci`, `image.labels` is ignored. The generated Dockerfile always labels the image `dev.alepha.runtime`, naming the slice it runs.

The generated standard image uses a Node or Bun base and installs runtime dependencies only when the artifact declares them. Each declared volume is prepared before its `VOLUME` line. Named volumes inherit those permissions; bind mounts retain the host directory's permissions. Baked values are public image defaults, so deliver secrets at runtime.

## SBOM and provenance

For software delivered as an image, buyers and the EU Cyber Resilience Act ask for a machine-readable SBOM. Turn on the build's own list, then attach attestations as the image is pushed:

```typescript check filename=alepha.config.ts
import { defineConfig } from "alepha/cli/config";

export default defineConfig({
  build: { sbom: true },
  image: { tag: "ghcr.io/myorg/myapp", sbom: true, provenance: true },
});
```

```bash
alepha build
alepha image --push --tag=1.4.0
```

The image carries `/app/sbom.cdx.json` (CycloneDX, what the bundles contain), and its index carries an SPDX SBOM attestation, which lists those packages too, and a SLSA provenance. Read them back with `docker buildx imagetools inspect ghcr.io/myorg/myapp:1.4.0 --format '{{json .SBOM}}'` (or `.Provenance`). Without `--push`, attestations need the containerd image store; `alepha image` says so before it builds.

⚠️ Provenance is recorded in `mode=max`, which includes the build arguments: never pass a secret as `--build-arg` in `image.args`. Signing the image (cosign) is a step of your CI, after the push. See [Evidence: SBOM and provenance](/docs/cli-commands-image#evidence-sbom-and-provenance).

## Compiled image

```bash
alepha build --runtime bun
alepha image --compile --tag
```

This compiles the Bun slice first, then packages the binary on `gcr.io/distroless/cc-debian12` by default. `--compile my-app` names the binary. The base determines the Linux Bun target triple: a Bun binary needs libc and supporting libraries, so `scratch` and `distroless/static` are refused. A compiled image runs as `65532:65532` by default, owns `/app` and every `image.volumes` path, and needs no shell to do it; `image.user: "root"` opts back. It boots with a read-only root file system when `DATA_DIR` points at a declared volume (see [Non-root by default](/docs/cli-commands-image#non-root-by-default)). A compiled Dockerfile generated before this ran as root: regenerate it, and check the app writes nowhere else. Runtime dependencies must be bundled, and `image.install` is ignored in this mode.

For a binary without an image, use [alepha compile](/docs/cli-commands-compile). For the complete image contract, see [alepha image](/docs/cli-commands-image).

## Running

```bash
docker run -p 3000:3000 --env-file .env.production ghcr.io/myorg/myapp:latest
```

The generated image sets `SERVER_HOST=0.0.0.0`; supply `SERVER_PORT` to change the listening port.

The standard image declares a `HEALTHCHECK` on `/health`, probed with the runtime's own `fetch` on `SERVER_PORT`, so `docker ps` shows `healthy` once the app is ready, compose can wait for it with `depends_on: condition: service_healthy`, and Bay reads it as readiness. The compiled image has none: nothing in it can run a probe. A Dockerfile generated before this was added has no `HEALTHCHECK` either: delete it and run `alepha image --dockerfile` to regenerate it. See [Health](/docs/cli-commands-image#health). Both standard and compiled apps serve their client assets and apply the artifact's `_headers` file. See [Static File Headers](/docs/guides-deployment-headers).

Container images are an artifact format. [alepha deploy](/docs/cli-plugins-infra) drives configured infrastructure adapters; it does not turn a Docker image into an implicit provider deployment.
