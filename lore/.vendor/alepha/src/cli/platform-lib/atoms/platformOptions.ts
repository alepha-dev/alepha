import { $atom, type Infer, z } from "alepha";

import type { EnvironmentDescriptor } from "../adapters/PlatformAdapter.ts";

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
       * The APP name: one workspace is one app, and every resource an adapter
       * names derives from it. Defaults to the workspace package.json "name".
       * There is no project concept in `alepha platform`.
       */
      name: z.text().optional(),

      /**
       * Default environment when --env is omitted.
       *
       * @default "production"
       */
      default: z.text().optional(),

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
       * Named environments, each a descriptor returned by an adapter factory:
       * `cloudflare({ domain })`, `bay({ host })`, or a third party's own
       * (`lore()` from `@alepha/lore/cli`).
       *
       * The factory is how an environment names its adapter, so there is no
       * closed list of names to extend: an adapter is an import. `platform()`
       * registers each descriptor's adapter class when the config loads, which
       * is also what brings that adapter's module and services along.
       */
      environments: z.record(
        z.text({
          description:
            "Environment name (e.g. 'production', 'staging', 'preview'). Used in resource naming and selected via --env.",
        }),
        z.custom<EnvironmentDescriptor>(
          (value) =>
            typeof value === "object" &&
            value !== null &&
            typeof (value as { adapter?: unknown }).adapter === "function",
          {
            message:
              'An environment is a descriptor from an adapter factory, e.g. `cloudflare({ domain })` or `bay({ host })`. The `adapter: "..."` string form is gone.',
          },
        ),
      ),
    })
    .optional(),
  serverOnly: true,
});

/**
 * Type for platform options.
 */
export type PlatformOptions = Infer<typeof platformOptions.schema>;
