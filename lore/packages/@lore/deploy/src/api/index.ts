import { $module } from "alepha";

/**
 * The server half of `@lore/deploy`, Lore as Vercel: apps, telemetry (sigils, analytics, vitals, blights, quality), deployments and estates.
 *
 * It depends on `@lore/core` only: a feature that spans two modules goes through a core registry or a core link, never through an import of another feature module (`check:conventions`).
 *
 * Registered by `apps/lore/src/main.server.ts`, after every entry-level
 * substitution.
 *
 * @module
 */
export const LoreDeployApi = $module({
  name: "lore.deploy.api",
});
