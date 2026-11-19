import { LoreCoreMcp } from "@lore/core/mcp";
import { $module } from "alepha";

/**
 * The MCP tools of `@lore/chat` (#E161).
 *
 * Registered by `apps/lore/src/main.server.ts` beside `LoreChatApi`.
 *
 * @module
 */
export const LoreChatMcp = $module({
  name: "lore.chat.mcp",
  // Core first: booting this module alone boots what it depends on.
  imports: [LoreCoreMcp],
  services: [],
});
