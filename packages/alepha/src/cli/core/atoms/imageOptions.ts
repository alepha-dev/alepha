import { $atom, type Infer, z } from "alepha";

/**
 * Options for `alepha image`, the command that turns a built `dist/` into a
 * container image.
 *
 * ## ⚠️ Top-level `image:`, not `build.docker`
 *
 * Config follows the command that reads it. Docker left `alepha build
 * --target=docker` for `alepha image`, so its configuration left `build` with
 * it. `build.cloudflare` correctly stays under `build`, because
 * `wrangler.jsonc` really is written by the build.
 *
 * ## ⚠️ `alepha image` needs the docker CLI
 *
 * It shells out to `docker build`, so it cannot run in an in-process build
 * path — notably the one Lore's Worker deploy uses, which has no shell at all.
 * It is a local and CI command.
 */
export const imageOptions = $atom({
  name: "alepha.cli.image.options",
  description: "Container image configuration",
  schema: z.object({
    /**
     * Base image for the Dockerfile (FROM instruction).
     *
     * @default "node:24-alpine" for node runtime
     * @default "oven/bun:alpine" for bun runtime
     * @default "gcr.io/distroless/static-debian12" in `compile` mode
     */
    from: z.string().optional(),

    /**
     * Command to run in the Docker container.
     *
     * @default "node" for node runtime
     * @default "bun" for bun runtime
     */
    command: z.string().optional(),

    /**
     * Extra packages to install in the generated image.
     *
     * Each entry becomes a `RUN npm install --no-fund --no-audit
     * <pkg> …` line (local, not `--global`, so the app resolves them
     * like any dependency) inserted after `FROM` and before the
     * app `COPY`. Use it for CLI tools the running app shells out to
     * — typical example is `wrangler` for a service that deploys to
     * Cloudflare on someone else's behalf.
     *
     * Ignored in `compile` mode (the distroless base has no `npm`).
     *
     * @example install: ["wrangler"]
     */
    install: z.array(z.string()).optional(),

    /**
     * Environment variables baked into the generated image.
     *
     * Each entry becomes an `ENV key="value"` line emitted **after**
     * the built-in `SERVER_HOST=0.0.0.0`, so an app that sets
     * `SERVER_HOST` itself wins. Values are escaped, so a space or a
     * quote cannot produce a Dockerfile that builds fine and sets the
     * wrong thing.
     *
     * These are defaults, not secrets: anything passed with
     * `docker run -e` overrides them, and everything here is readable
     * with `docker inspect`.
     *
     * @example env: { DATA_DIR: "/data", DATABASE_URL: "sqlite:///data/app.db" }
     */
    env: z.record(z.string(), z.string()).optional(),

    /**
     * Mount points declared as `VOLUME` in the generated image.
     *
     * In the standard variant each directory is created and chowned to
     * the container user before its `VOLUME` line, so a **named** volume
     * inherits a writable directory. A **bind mount** does not follow
     * this: the host directory's ownership wins, and the host has to
     * grant access itself.
     *
     * @example volumes: ["/data"]
     */
    volumes: z.array(z.string()).optional(),

    /**
     * User the container process runs as (`USER` instruction).
     *
     * The standard variant defaults to uid `1000`, which exists in both
     * official bases (`node` and `bun`). A numeric id is emitted rather
     * than a name because a custom `from` may not carry that user, and
     * `USER node` fails the build outright on a base that lacks it.
     *
     * Pass `"root"` to opt back into running as root.
     *
     * Compile mode has no default: the distroless base has no shell, so
     * a declared volume cannot be prepared at build time. Set this
     * explicitly there if the image needs a non-root user.
     *
     * @default "1000" (standard variant only)
     */
    user: z.string().optional(),

    /**
     * Docker build options (used when --image flag is passed).
     */
    image: z
      .object({
        /**
         * Default image tag (name without version).
         *
         * Used when --image is provided without a full override:
         * - `--image` → `tag:latest`
         * - `--image=1.3.4` → `tag:1.3.4`
         * - `--image=other/img:v1` → `other/img:v1` (full override)
         *
         * @example "myproject/myapp"
         * @example "ghcr.io/myorg/myapp"
         */
        tag: z.string(),

        /**
         * Additional arguments to pass to `docker build`.
         *
         * @example '--platform linux/amd64 --no-cache'
         */
        args: z.string().optional(),

        /**
         * Auto-add OCI standard labels (revision, created, version).
         *
         * Adds:
         * - org.opencontainers.image.revision (git commit SHA)
         * - org.opencontainers.image.created (build timestamp)
         * - org.opencontainers.image.version (from image tag)
         *
         * The four fields below are added too, each only when set.
         */
        oci: z.boolean().optional(),

        /**
         * `org.opencontainers.image.source`: the URL of the repository
         * the image was built from.
         *
         * This is what links a package to its repository on a registry
         * like GHCR: without it the package page stands alone, with no
         * README and no repo link.
         *
         * **Config only, never derived from the git remote.** An SSH
         * remote is not a URL, a CI checkout may have no remote at all,
         * and a fork would publish either the upstream's URL or its own
         * with nothing inside the build able to tell which is meant. A
         * wrong `source` on a published image is worse than a missing
         * one, and the right value changes approximately never.
         *
         * @example "https://github.com/myorg/myapp"
         */
        source: z.string().optional(),

        /**
         * `org.opencontainers.image.title`: human-readable image name.
         *
         * @example "Lore"
         */
        title: z.string().optional(),

        /**
         * `org.opencontainers.image.description`: one line about what
         * the image is.
         */
        description: z.string().optional(),

        /**
         * `org.opencontainers.image.licenses`: an SPDX expression.
         *
         * @example "MIT"
         * @example "Apache-2.0 OR MIT"
         */
        licenses: z.string().optional(),
      })
      .optional(),
  }),
  default: {},
  serverOnly: true,
});

/**
 * Type for image options.
 */
export type ImageOptions = Infer<typeof imageOptions.schema>;
