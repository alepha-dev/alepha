import { LoreCoreMcp } from "@lore/core/mcp";
import { $module } from "alepha";

import { CodeReadTools } from "./tools/CodeReadTools.ts";
import { CodeTools } from "./tools/CodeTools.ts";

/**
 * The MCP tools of `@lore/build`, Lore's fourth pillar: the project's git
 * repositories (`code_repo_*`, each with its `lore code repo` command), and
 * reading their code (`code_tree`, `code_file`, `code_log`, `code_commit`,
 * `code_diff`, `code_blame`, #Q4139).
 *
 * Registered by `apps/lore/src/main.server.ts` beside `LoreBuildApi`.
 *
 * @module
 */
export const LoreBuildMcp = $module({
  name: "lore.build.mcp",
  imports: [LoreCoreMcp],
  services: [CodeTools, CodeReadTools],
});

export { CodeReadTools } from "./tools/CodeReadTools.ts";
export { CodeTools } from "./tools/CodeTools.ts";
