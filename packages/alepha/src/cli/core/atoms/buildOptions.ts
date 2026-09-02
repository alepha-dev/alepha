import { $atom, type Infer, z } from "alepha";

/**
 * Deployment target for the build output.
 *
 * - `docker` - Generate Dockerfile for containerized deployment
 * - `cloudflare` - Generate Cloudflare Workers configuration (forces workerd runtime)
 */
export type BuildTarget = "bare" | "docker" | "cloudflare" | "static";

/**
 * JavaScript runtime for the build output.
 *
 * - `node` - Node.js runtime (default)
 * - `bun` - Bun runtime (uses bun export conditions)
 * - `workerd` - Cloudflare Workers runtime (auto-set with cloudflare target)
 */
export type BuildRuntime = "node" | "bun" | "workerd";

/**
 * Build options atom for CLI build command.
 *
 * Defines the available build configuration options with their defaults.
 * Options can be overridden via alepha.config.ts or CLI flags.
 */
export const buildOptions = $atom({
  name: "alepha.cli.build.options",
  description: "Build configuration options",
  schema: z.object({
    /**
     * Generate build stats report.
     *
     * - `true` - Generate a static HTML report
     * - `"json"` - Generate a JSON report
     */
    stats: z.union([z.boolean(), z.enum(["json"])]).optional(),

    /**
     * Deployment target for the build output.
     *
     * - `docker` - Generate Dockerfile for containerized deployment
     * - `cloudflare` - Generate Cloudflare Workers configuration (forces workerd runtime)
     */
    target: z.enum(["bare", "docker", "cloudflare", "static"]).optional(),

    /**
     * JavaScript runtime for the build output.
     *
     * - `node` - Node.js runtime (default)
     * - `bun` - Bun runtime (uses bun export conditions)
     * - `workerd` - Cloudflare Workers runtime (auto-set with cloudflare target)
     *
     * Note: Some targets force a specific runtime:
     * - `cloudflare` always uses `workerd`
     */
    runtime: z.enum(["node", "bun", "workerd"]).optional(),

    /**
     * Output directory configuration.
     */
    output: z
      .object({
        /**
         * Root dist directory.
         *
         * @default "dist"
         */
        dist: z.string().default("dist").optional(),

        /**
         * Public/client subdirectory.
         *
         * @default "public"
         */
        public: z.string().default("public").optional(),
      })
      .optional(),

    /**
     * Cloudflare-specific deployment configuration.
     *
     * Note: Set `target: "cloudflare"` to enable Cloudflare deployment.
     * This object is only for additional configuration.
     */
    cloudflare: z
      .object({
        config: z.json().optional(),
      })
      .optional(),

    /**
     * Docker-specific deployment configuration.
     *
     * Note: Set `target: "docker"` to enable Docker deployment.
     * This object is only for additional configuration.
     */
    docker: z
      .object({
        /**
         * Base image for the Dockerfile (FROM instruction).
         *
         * @default "node:24-alpine" for node runtime
         * @default "oven/bun:alpine" for bun runtime
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

        /**
         * Compile the server entry to a single static binary using
         * `bun build --compile`, then package it inside a minimal base image
         * (distroless by default). Requires `runtime: "bun"`.
         *
         * When enabled:
         * - the binary is produced at `<dist>/app` and the original `dist/server/`,
         *   `dist/index.js` and `dist/package.json` are removed
         * - the generated Dockerfile uses a distroless base image and does not
         *   run `bun install` (everything is embedded in the binary)
         * - any non-empty `dependencies` in the externals manifest causes the
         *   task to fail loudly (compile requires fully-bundled output)
         *
         * Pass `true` to enable with defaults, or an object to override.
         */
        compile: z
          .union([
            z.boolean(),
            z.object({
              /**
               * Bun target triple, e.g. `bun-linux-x64-musl`,
               * `bun-linux-arm64-musl`, or `bun-linux-x64-modern-musl`
               * (AVX2 required).
               *
               * @default derived from host arch — always linux-musl.
               */
              target: z.string().optional(),

              /**
               * Base image for the generated Dockerfile.
               *
               * @default "gcr.io/distroless/static-debian12"
               */
              base: z.string().optional(),

              /**
               * Minify the compiled output.
               *
               * @default true
               */
              minify: z.boolean().optional(),
            }),
          ])
          .optional(),
      })
      .optional(),

    /**
     * Infer site deployment configuration.
     *
     * Note: Set `target: "static"` to enable static site generation.
     */
    static: z
      .object({
        /**
         * Surge domain for deployment.
         *
         * If set, a CNAME file is written to dist/public/.
         * If not set, a domain is auto-generated from package.json name.
         *
         * @example "my-app.surge.sh"
         * @example "my-custom-domain.com"
         */
        domain: z.string().optional(),

        /**
         * Directory holding a client the workspace built itself, copied into
         * `dist/<public>` before the static site is assembled.
         *
         * Without it this target can only ship what Alepha rendered — its own
         * Vite client build, or a `$page` at `/`. That leaves out every site
         * built by something else: a hand-written `index.html` through plain
         * Vite, an Astro export, a docs generator. Bay can host a site with no
         * process behind it; this is what lets one be produced.
         *
         * **Must live outside `dist/`.** The build cleans `dist/` before any
         * task runs, so a client written there is deleted before it can be
         * adopted — pointing at `dist/public` is refused by name rather than
         * failing later as a missing file.
         *
         * A server entry is still required (the build boots the workspace to
         * analyze it), even though nothing of it ships: `cleanDist` keeps only
         * the client directory and the manifest.
         *
         * @example "dist-client"
         */
        source: z.string().optional(),
      })
      .optional(),

    /**
     * PWA (Progressive Web App) configuration.
     *
     * Generates a web app manifest and enables installability.
     * Requires a client-side bundle (React).
     */
    pwa: z
      .object({
        /**
         * Full application name displayed on the splash screen
         * and in the OS app switcher.
         */
        name: z.string(),

        /**
         * Short name displayed on the home screen icon.
         * Falls back to `name` if omitted.
         */
        shortName: z.string().optional(),

        /**
         * Theme color used for the browser toolbar and OS chrome.
         *
         * @default "#ffffff"
         */
        themeColor: z.string().optional(),

        /**
         * Background color for the splash screen.
         *
         * @default "#ffffff"
         */
        backgroundColor: z.string().optional(),

        /**
         * Display mode for the installed PWA.
         *
         * - `standalone` - Looks like a native app (default)
         * - `fullscreen` - Uses entire screen (games, immersive)
         * - `minimal-ui` - Like standalone with minimal browser UI
         * - `browser` - Standard browser tab
         *
         * @default "standalone"
         */
        display: z
          .enum(["standalone", "fullscreen", "minimal-ui", "browser"])
          .optional(),
      })
      .optional(),
  }),
  default: {},
  serverOnly: true,
});

/**
 * Type for build options.
 */
export type BuildOptions = Infer<typeof buildOptions.schema>;
