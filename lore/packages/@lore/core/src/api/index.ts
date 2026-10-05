import { $module } from "alepha";

/**
 * The server half of `@lore/core`, the glue: projects, capabilities, ranks and permissions, notifications, audits, the resource registry and its link graph, search, the dashboard, reports, agent prompts and the web shell.
 *
 * It imports no other `@lore` package: work, knowledge and deploy depend on it, and it never depends on them (`check:conventions`).
 *
 * Registered by `apps/lore/src/main.server.ts`, after every entry-level
 * substitution.
 *
 * @module
 */
export const LoreCoreApi = $module({
  name: "lore.core.api",
});
