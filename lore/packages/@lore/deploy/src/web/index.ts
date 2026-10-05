import { $module } from "alepha";

/**
 * The browser-safe half of `@lore/deploy`, Lore as Vercel: apps, telemetry (sigils, analytics, vitals, blights, quality), deployments and estates: its pages, atoms and
 * dictionaries.
 *
 * Registered by BOTH entries, `main.server.ts` and `main.browser.ts`: the
 * server renders and the browser hydrates from the same page registry, so a
 * page known to one side only renders on the server and 404s after hydration.
 *
 * It imports another package's `./api` or `./mcp` as `import type` only:
 * a runtime import would bundle that package's server into the browser.
 *
 * @module
 */
export const LoreDeployWeb = $module({
  name: "lore.deploy.web",
});
