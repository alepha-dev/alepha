import { LoreCoreApi } from "@lore/core/api";
import { $module } from "alepha";

/**
 * The server half of `@lore/chat` (#E161): project rooms, where members talk
 * to each other and to the Lore agent.
 *
 * It depends on `@lore/core` only: a feature that spans two modules goes
 * through a core registry or a core link, never through an import of another
 * feature module (`check:conventions`). The agent is not here: the app's
 * assistant registers on this package's registries.
 *
 * Registered by `apps/lore/src/main.server.ts`, after every entry-level
 * substitution.
 *
 * @module
 */
export const LoreChatApi = $module({
  name: "lore.chat.api",
  imports: [LoreCoreApi],
  services: [],
});
