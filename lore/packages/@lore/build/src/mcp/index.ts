import { LoreCoreMcp } from "@lore/core/mcp";
import { $module } from "alepha";

/**
 * The MCP tools of `@lore/build`, Lore's fourth pillar: none yet.
 *
 * Registered by `apps/lore/src/main.server.ts` beside `LoreBuildApi`.
 *
 * @module
 */
export const LoreBuildMcp = $module({
  name: "lore.build.mcp",
  imports: [LoreCoreMcp],
  services: [],
});
