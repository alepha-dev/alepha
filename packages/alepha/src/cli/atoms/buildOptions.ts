import { type Static, t } from "alepha";
import { $atom } from "../../core/primitives/$atom.ts";

/**
 * Build options atom for CLI build command.
 *
 * Defines the available build configuration options with their defaults.
 * Options can be overridden via vite.config.ts or CLI flags.
 */
export const buildOptions = $atom({
  name: "alepha.build.options",
  description: "Build configuration options",
  schema: t.object({
    /**
     * Generate build stats report.
     */
    stats: t.optional(t.boolean({ default: false })),

    /**
     * Vercel deployment configuration.
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
     * Cloudflare Workers deployment configuration.
     */
    cloudflare: t.optional(
      t.object({
        config: t.optional(t.json()),
      }),
    ),

    /**
     * Docker deployment configuration.
     */
    docker: t.optional(
      t.object({
        /**
         * Docker image name to use in the Dockerfile.
         * @default "node:24-alpine"
         */
        image: t.optional(t.string({ default: "node:24-alpine" })),

        /**
         * Command to run in the Docker container.
         * @default "node"
         */
        command: t.optional(t.string({ default: "node" })),
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
