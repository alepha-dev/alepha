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
  schema: t.optional(
    t.object({
      /**
       * Project name override. Defaults to root package.json "name".
       */
      name: t.optional(t.text()),

      /**
       * Monorepo app paths relative to root. Omit for standalone apps.
       */
      apps: t.optional(t.array(t.text())),

      /**
       * Default environment when --env is omitted.
       *
       * @default "production"
       */
      default: t.optional(t.text()),

      /**
       * Secret store configuration for syncing .env secrets
       * to external providers (e.g. GitHub Actions environments).
       */
      secrets: t.optional(
        t.object({
          /**
           * Secret store backend.
           */
          store: t.enum(["github"]),

          /**
           * Pattern for resolving environment names in the store.
           * Placeholders: {project}, {env}.
           *
           * @default "{project}-{env}"
           */
          environmentPattern: t.optional(t.text()),
        }),
      ),

      /**
       * Named environments with their adapter and configuration.
       */
      environments: t.record(
        t.text(),
        t.object({
          adapter: t.enum([
            "cloudflare",
            "vercel",
            "docker",
            "docker-compose",
            "aks",
          ]),
          domain: t.optional(t.text()),
          domains: t.optional(t.record(t.text(), t.text())),
          ip: t.optional(t.text()),
        }),
      ),
    }),
  ),
});

/**
 * Type for platform options.
 */
export type PlatformOptions = Static<typeof platformOptions.schema>;

/**
 * Configuration for a single named environment.
 */
export interface EnvironmentConfig {
  adapter: "cloudflare" | "vercel" | "docker" | "docker-compose" | "aks";
  domain?: string;
  domains?: Record<string, string>;
  ip?: string;
  vars?: Record<string, string>;
}
