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
        t.text({
          description:
            "Environment name (e.g. 'production', 'staging', 'preview'). Used in resource naming and selected via --env.",
        }),
        t.object({
          adapter: t.enum(["cloudflare", "vercel"]),
          /**
           * Custom domain for the deployed worker (e.g. "api.example.com").
           *
           * On Cloudflare this is attached as a custom-domain route.
           * Omit to use the adapter's default `*.workers.dev` / preview URL.
           *
           * Wildcards are supported for multi-tenant SaaS apps:
           * `"*.club.alepha.dev"` routes every subdomain to the worker.
           * Wildcard patterns require `zone` to be set, and the wildcard DNS
           * record must already exist (proxied) in the Cloudflare zone.
           */
          domain: t.optional(t.text()),
          /**
           * Cloudflare zone name (e.g. "alepha.dev") that owns `domain`.
           *
           * Required when `domain` contains a wildcard (`*`). Ignored for
           * plain custom domains, which Cloudflare resolves automatically.
           */
          zone: t.optional(t.text()),
          /**
           * Cloudflare data jurisdiction for R2 buckets and D1 databases.
           * - "eu": data stays within the EU
           * - "fedramp": FedRAMP-authorized regions
           *
           * Omit for the default (global) jurisdiction.
           */
          jurisdiction: t.optional(t.enum(["eu", "fedramp"])),
          /**
           * Cloudflare account ID to deploy into.
           *
           * Falls back to `CLOUDFLARE_ACCOUNT_ID` env var, then to the
           * token's account when the token is scoped to exactly one.
           * Required when the token has access to multiple accounts.
           */
          accountId: t.optional(t.text()),
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
  adapter: "cloudflare" | "vercel";
  domain?: string;
  zone?: string;
  vars?: Record<string, string>;
  jurisdiction?: "eu" | "fedramp";
  accountId?: string;
}
