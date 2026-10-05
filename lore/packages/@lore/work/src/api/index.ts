import { $module } from "alepha";

/**
 * The server half of `@lore/work`, Lore as Jira: quests, epics, releases, areas, the kanban, the roadmap and feedback.
 *
 * It depends on `@lore/core` only: a feature that spans two modules goes through a core registry or a core link, never through an import of another feature module (`check:conventions`).
 *
 * Registered by `apps/lore/src/main.server.ts`, after every entry-level
 * substitution.
 *
 * @module
 */
export const LoreWorkApi = $module({
  name: "lore.work.api",
});
