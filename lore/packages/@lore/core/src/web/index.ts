import { $module } from "alepha";

/**
 * The browser-safe half of `@lore/core`, the glue: projects, capabilities, ranks and permissions, notifications, audits, the resource registry and its link graph, search, the dashboard, reports, agent prompts and the web shell: its pages, atoms and
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
export const LoreCoreWeb = $module({
  name: "lore.core.web",
});
