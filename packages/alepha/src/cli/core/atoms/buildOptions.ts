import { $atom, type Static, t } from "alepha";

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
  schema: t.object({
    /**
     * Generate build stats report.
     *
     * - `true` - Generate a static HTML report
     * - `"json"` - Generate a JSON report
     */
    stats: t.optional(t.union([t.boolean(), t.enum(["json"])])),

    /**
     * Deployment target for the build output.
     *
     * - `docker` - Generate Dockerfile for containerized deployment
     * - `vercel` - Generate Vercel deployment configuration (forces node runtime)
     * - `cloudflare` - Generate Cloudflare Workers configuration (forces workerd runtime)
     */
    target: t.optional(
      t.enum(["bare", "docker", "vercel", "cloudflare", "static"]),
    ),

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
    runtime: t.optional(t.enum(["node", "bun", "workerd"])),

    /**
     * Output directory configuration.
     */
    output: t.optional(
      t.object({
        /**
         * Root dist directory.
         *
         * @default "dist"
         */
        dist: t.optional(t.string({ default: "dist" })),

        /**
         * Public/client subdirectory.
         *
         * @default "public"
         */
        public: t.optional(t.string({ default: "public" })),
      }),
    ),

    /**
     * Vercel-specific deployment configuration.
     *
     * Note: Set `target: "vercel"` to enable Vercel deployment.
     * This object is only for additional configuration.
     */
    vercel: t.optional(
      t.object({
        projectName: t.optional(t.string()),
        orgId: t.optional(t.string()),
        projectId: t.optional(t.string()),
        config: t.optional(
          t.object({
            crons: t.optional(
              t.array(
                t.object({
                  path: t.string(),
                  schedule: t.string(),
                }),
              ),
            ),
          }),
        ),
      }),
    ),

    /**
     * Cloudflare-specific deployment configuration.
     *
     * Note: Set `target: "cloudflare"` to enable Cloudflare deployment.
     * This object is only for additional configuration.
     */
    cloudflare: t.optional(
      t.object({
        config: t.optional(t.json()),
      }),
    ),

    /**
     * Docker-specific deployment configuration.
     *
     * Note: Set `target: "docker"` to enable Docker deployment.
     * This object is only for additional configuration.
     */
    docker: t.optional(
      t.object({
        /**
         * Base image for the Dockerfile (FROM instruction).
         *
         * @default "node:24-alpine" for node runtime
         * @default "oven/bun:alpine" for bun runtime
         */
        from: t.optional(t.string()),

        /**
         * Command to run in the Docker container.
         *
         * @default "node" for node runtime
         * @default "bun" for bun runtime
         */
        command: t.optional(t.string()),

        /**
         * Docker build options (used when --image flag is passed).
         */
        image: t.optional(
          t.object({
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
            tag: t.string(),

            /**
             * Additional arguments to pass to `docker build`.
             *
             * @example '--platform linux/amd64 --no-cache'
             */
            args: t.optional(t.string()),

            /**
             * Auto-add OCI standard labels (revision, created, version).
             *
             * Adds:
             * - org.opencontainers.image.revision (git commit SHA)
             * - org.opencontainers.image.created (build timestamp)
             * - org.opencontainers.image.version (from image tag)
             */
            oci: t.optional(t.boolean()),
          }),
        ),
      }),
    ),

    /**
     * Static site deployment configuration.
     *
     * Note: Set `target: "static"` to enable static site generation.
     */
    static: t.optional(
      t.object({
        /**
         * Surge domain for deployment.
         *
         * If set, a CNAME file is written to dist/public/.
         * If not set, a domain is auto-generated from package.json name.
         *
         * @example "my-app.surge.sh"
         * @example "my-custom-domain.com"
         */
        domain: t.optional(t.string()),
      }),
    ),

    /**
     * Sitemap generation configuration.
     */
    sitemap: t.optional(
      t.object({
        /**
         * Base URL for sitemap entries.
         */
        hostname: t.string(),
      }),
    ),
  }),
  default: {},
});

/**
 * Type for build options.
 */
export type BuildOptions = Static<typeof buildOptions.schema>;
