import { $atom, type Static, t } from "alepha";

/**
 * Platform deployment configuration atom.
 *
 * Filled from the `platform` section of `alepha.config.ts`.
 * Read by `PlatformCommand` to resolve environments and adapters.
 */
export const platformOptions = $atom({
  name: "alepha.cli.platform.options",
  description: "Platform deployment configuration",
  schema: t.object({
    /**
     * Project name override. Defaults to root package.json "name".
     */
    name: t.optional(t.text()),

    /**
     * Monorepo app paths relative to root. Omit for standalone apps.
     */
    apps: t.optional(t.array(t.text())),

    /**
     * Platform deployment configuration.
     */
    platform: t.optional(
      t.object({
        /**
         * Default environment when --env is omitted.
         *
         * @default "prod"
         */
        default: t.optional(t.text()),

        /**
         * Named environments with their adapter and configuration.
         */
        environments: t.record(
          t.text(),
          t.object({
            adapter: t.enum(["cloudflare", "docker-compose", "aks"]),
            domain: t.optional(t.text()),
            vars: t.optional(t.record(t.text(), t.text())),
          }),
        ),
      }),
    ),
  }),
  default: {},
});

/**
 * Type for platform options.
 */
export type PlatformOptions = Static<typeof platformOptions.schema>;

/**
 * Configuration for a single named environment.
 */
export interface EnvironmentConfig {
  adapter: "cloudflare" | "docker-compose" | "aks";
  domain?: string;
  vars?: Record<string, string>;
}
