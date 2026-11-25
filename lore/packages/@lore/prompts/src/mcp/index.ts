import { LoreCoreMcp } from "@lore/core/mcp";
import { $module } from "alepha";

/**
 * The MCP tools of `@lore/prompts` (#E175).
 *
 * Registered by `apps/lore/src/main.server.ts` beside `LorePromptsApi`.
 *
 * @module
 */
export const LorePromptsMcp = $module({
  name: "lore.prompts.mcp",
  // Core first: booting this module alone boots what it depends on.
  imports: [LoreCoreMcp],
  services: [],
});
