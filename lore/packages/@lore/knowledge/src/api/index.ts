import { $module } from "alepha";

/**
 * The server half of `@lore/knowledge`, Lore as Obsidian: folios, their directories, attachments, revisions and names.
 *
 * It depends on `@lore/core` only: a feature that spans two modules goes through a core registry or a core link, never through an import of another feature module (`check:conventions`).
 *
 * Registered by `apps/lore/src/main.server.ts`, after every entry-level
 * substitution.
 *
 * @module
 */
export const LoreKnowledgeApi = $module({
  name: "lore.knowledge.api",
});
