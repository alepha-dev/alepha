import { LoreCoreApi } from "@lore/core/api";
import { $module } from "alepha";

/**
 * The server half of `@lore/prompts` (#E175): the prompt engine, its
 * triggers, its jobs and the agent hosts they run on.
 *
 * It depends on `@lore/core` only, and nothing imports it: Plan, Ship and
 * Requirements contribute prompts through core's contract (`PromptRegistry`,
 * `AgentJobs`), which this package fills.
 *
 * Registered by `apps/lore/src/main.server.ts`, after every entry-level
 * substitution.
 *
 * @module
 */
export const LorePromptsApi = $module({
  name: "lore.prompts.api",
  imports: [LoreCoreApi],
  services: [],
});
