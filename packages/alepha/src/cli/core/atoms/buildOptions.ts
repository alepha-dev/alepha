import { $atom, type Static, z } from "alepha";

/**
 * Deployment target for the build output.
 *
 * - `docker` - Generate Dockerfile for containerized deployment
 * - `vercel` - Generate Vercel deployment configuration (forces node runtime)
 * - `cloudflare` - Generate Cloudflare Workers configuration (forces workerd runtime)
 */
export type BuildTarget =
  | "bare"
  | "docker"
  | "vercel"
  | "cloudflare"
  | "static";

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
     * - `vercel` - Generate Vercel deployment configuration (forces node runtime)
     * - `cloudflare` - Generate Cloudflare Workers configuration (forces workerd runtime)
     */
    target: z
      .enum(["bare", "docker", "vercel", "cloudflare", "static"])
      .optional(),

    /**
     * JavaScript runtime for the build output.
     *
     * - `node` - Node.js runtime (default)
     * - `bun` - Bun runtime (uses bun export conditions)
     * - `workerd` - Cloudflare Workers runtime (auto-set with cloudflare target)
     *
     * Note: Some targets force a specific runtime:
     * - `cloudflare` always uses `workerd`
     * - `vercel` always uses `node`
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
     * Vercel-specific deployment configuration.
     *
     * Note: Set `target: "vercel"` to enable Vercel deployment.
     * This object is only for additional configuration.
     */
    vercel: z
      .object({
        projectName: z.string().optional(),
        orgId: z.string().optional(),
        projectId: z.string().optional(),
        config: z
          .object({
            crons: z
              .array(
                z.object({
                  path: z.string(),
                  schedule: z.string(),
                }),
              )
              .optional(),
          })
          .optional(),
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
         * Extra packages to install globally in the generated image.
         *
         * Each entry becomes a `RUN npm install --global --no-fund
         * --no-audit <pkg> …` line inserted after `FROM` and before the
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
             */
            oci: z.boolean().optional(),
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
     * Static site deployment configuration.
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
export type BuildOptions = Static<typeof buildOptions.schema>;
