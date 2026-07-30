import { $atom, type Static, z } from "alepha";

/**
 * Platform deployment configuration atom.
 *
 * Filled from the `platform` section of `alepha.config.ts`.
 * Read by `PlatformCommand` to resolve environments and adapters.
 */
export const platformOptions = $atom({
  name: "alepha.cli.platform.options",
  description: "Platform deployment configuration",
  schema: z
    .object({
      /**
       * Project name override. Defaults to root package.json "name".
       */
      name: z.text().optional(),

      /**
       * Default environment when --env is omitted.
       *
       * @default "production"
       */
      default: z.text().optional(),

      /**
       * Multi-tenancy mode — controls whether `--tenant <slug>` is
       * accepted/required and how it shapes resource names + the domain.
       *
       * - `none` (default): single instance. `--tenant` is rejected.
       * - `required`: every deploy needs `--tenant`; resources are named
       *   `<tenant>-<project>-<env>` and the host becomes
       *   `<tenant>.<domain>`. Omitting it errors.
       * - `optional`: a base instance (no `--tenant`) plus per-tenant
       *   instances coexist.
       *
       * @default "none"
       */
      tenancy: z.enum(["none", "optional", "required"]).optional(),

      /**
       * Secret store configuration for syncing .env secrets
       * to external providers (e.g. GitHub Actions environments).
       */
      secrets: z
        .object({
          /**
           * Explicit override of the worker secret-key allowlist.
           *
           * By default the deploy `secrets` step uses the build manifest's
           * `env` list (every key the app declares via `$env`, captured at
           * build time) as the allowlist, resolving each value from
           * `.env.<env>[.local]` first, then `process.env`. This lets CI
           * deliver secrets via the job environment (no `.env` file on the
           * runner) while only ever pushing declared keys — ambient runner
           * vars (PATH, GITHUB_*, …) can never leak.
           *
           * Set `keys` to override that auto-detected list (e.g. to narrow it,
           * or to add a key read via `process.env` rather than `$env`). When
           * neither this nor a manifest is present, the `.env.<env>` file is
           * itself the allowlist (legacy fallback).
           */
          keys: z.array(z.text()).optional(),

          /**
           * Secret store backend.
           */
          store: z.enum(["github"]).optional(),

          /**
           * Pattern for resolving environment names in the store.
           * Placeholders: {project}, {env}.
           *
           * @default "{project}-{env}"
           */
          environmentPattern: z.text().optional(),
        })
        .optional(),

      /**
       * Named environments with their adapter and configuration.
       */
      environments: z.record(
        z.text({
          description:
            "Environment name (e.g. 'production', 'staging', 'preview'). Used in resource naming and selected via --env.",
        }),
        z.object({
          adapter: z.enum(["cloudflare", "vercel", "bay"]),
          /**
           * Base URL of the Bay control panel this environment deploys to,
           * e.g. `"https://admin.bay.alepha.dev"`. Only read by the `bay`
           * adapter.
           *
           * A Bay is a machine someone owns, so unlike Cloudflare there is no
           * global endpoint to assume. Committing it is fine — it is a public
           * hostname, and the credential is what protects it.
           *
           * `$BAY_ENDPOINT` overrides, so a fork or a second Bay needs no edit.
           */
          endpoint: z.text().optional(),
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
          domain: z.text().optional(),
          /**
           * Cloudflare zone name (e.g. "alepha.dev") that owns `domain`.
           *
           * Required when `domain` contains a wildcard (`*`). For a plain
           * host, setting `zone` switches the binding from a Custom Domain to
           * a zone *Route* (`domain/*`) — needed when another Worker holds a
           * wildcard route covering the host (routes win by specificity,
           * while a Custom Domain would lose to the wildcard route).
           */
          zone: z.text().optional(),
          /**
           * Worker-to-worker service bindings, e.g.
           * `[{ binding: "CLUB", service: "club-staging" }]`.
           *
           * Exposed on the runtime `env` (Alepha store key `cloudflare.env`).
           * Use a binding to fetch() a sibling Worker on the same zone —
           * plain subrequests to a host served by a same-zone Worker route
           * bypass the route and 522.
           */
          services: z
            .array(
              z.object({
                binding: z.text(),
                service: z.text(),
              }),
            )
            .optional(),
          /**
           * Cloudflare data jurisdiction for R2 buckets and D1 databases.
           * - "eu": data stays within the EU
           * - "fedramp": FedRAMP-authorized regions
           *
           * Omit for the default (global) jurisdiction.
           */
          jurisdiction: z.enum(["eu", "fedramp"]).optional(),
          /**
           * Cloudflare account ID to deploy into.
           *
           * Falls back to `CLOUDFLARE_ACCOUNT_ID` env var, then to the
           * token's account when the token is scoped to exactly one.
           * Required when the token has access to multiple accounts.
           */
          accountId: z.text().optional(),
        }),
      ),
    })
    .optional(),
  serverOnly: true,
});

/**
 * Type for platform options.
 */
export type PlatformOptions = Static<typeof platformOptions.schema>;

/**
 * Configuration for a single named environment.
 */
export interface EnvironmentConfig {
  adapter: "cloudflare" | "vercel" | "bay";
  /** Base URL of the Bay control panel (`bay` adapter only). */
  endpoint?: string;
  domain?: string;
  zone?: string;
  vars?: Record<string, string>;
  jurisdiction?: "eu" | "fedramp";
  accountId?: string;
  services?: Array<{ binding: string; service: string }>;
}
