import { LoreCoreMcp } from "@lore/core/mcp";
import { $module } from "alepha";

import { CodeTools } from "./tools/CodeTools.ts";

/**
 * The MCP tools of `@lore/build`, Lore's fourth pillar: the project's git
 * repositories (`code_repo_*`, each with its `lore code repo` command).
 *
 * Registered by `apps/lore/src/main.server.ts` beside `LoreBuildApi`.
 *
 * @module
 */
export const LoreBuildMcp = $module({
  name: "lore.build.mcp",
  imports: [LoreCoreMcp],
  services: [CodeTools],
});

export { CodeTools } from "./tools/CodeTools.ts";
