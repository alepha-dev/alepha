import { LorePlanMcp } from "@lore/plan/mcp";
import { $module } from "alepha";

import { PersonaTools } from "./tools/PersonaTools.ts";
import { UseCaseTools } from "./tools/UseCaseTools.ts";

/**
 * The MCP tools of `@lore/plan-requirements`, Plan's Requirements (#E153),
 * each listed in Plan's `mcpTools` and gated on its `requirements` option.
 *
 * Registered by `apps/lore/src/main.server.ts` beside
 * `LorePlanRequirementsApi`.
 *
 * @module
 */
export const LorePlanRequirementsMcp = $module({
  name: "lore.plan-requirements.mcp",
  // Plan first: booting this module alone boots what it depends on.
  imports: [LorePlanMcp],
  services: [PersonaTools, UseCaseTools],
});

export { PersonaTools } from "./tools/PersonaTools.ts";
export { UseCaseTools } from "./tools/UseCaseTools.ts";
