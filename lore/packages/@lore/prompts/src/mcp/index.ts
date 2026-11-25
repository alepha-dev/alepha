import { LoreCoreMcp } from "@lore/core/mcp";
import { $module } from "alepha";

import { AgentHostTools } from "./tools/AgentHostTools.ts";
import { PromptTools } from "./tools/PromptTools.ts";

/**
 * The MCP tools of `@lore/prompts` (#E175): `prompt_*` and `agent_hosts`,
 * each paired with a `lore` command. The `job_*` tools stay core's.
 *
 * Registered by `apps/lore/src/main.server.ts` beside `LorePromptsApi`.
 *
 * @module
 */
export const LorePromptsMcp = $module({
  name: "lore.prompts.mcp",
  // Core first: booting this module alone boots what it depends on.
  imports: [LoreCoreMcp],
  services: [PromptTools, AgentHostTools],
});

export { AgentHostTools } from "./tools/AgentHostTools.ts";
export { PromptTools } from "./tools/PromptTools.ts";
