import { LoreChatApi } from "@lore/chat/api";
import { LoreChatMcp } from "@lore/chat/mcp";
import { ChatRouter, LoreChatWeb } from "@lore/chat/web";
import { LoreCoreApi } from "@lore/core/api";
import { LoreCoreMcp } from "@lore/core/mcp";
import {
  CoreRouter,
  LoreAccountSections,
  LoreCoreWeb,
  QualityRouter,
} from "@lore/core/web";
import { LorePlanRequirementsApi } from "@lore/plan-requirements/api";
import { LorePlanRequirementsMcp } from "@lore/plan-requirements/mcp";
import {
  LorePlanRequirementsWeb,
  RequirementsRouter,
} from "@lore/plan-requirements/web";
import { LorePlanApi } from "@lore/plan/api";
import { LorePlanMcp } from "@lore/plan/mcp";
import { LorePlanWeb, WorkAccountSections, WorkRouter } from "@lore/plan/web";
import { LorePromptsApi } from "@lore/prompts/api";
import { LorePromptsMcp } from "@lore/prompts/mcp";
import { LorePromptsWeb, PromptsRouter } from "@lore/prompts/web";
import { LoreRememberApi } from "@lore/remember/api";
import { LoreRememberMcp } from "@lore/remember/mcp";
import { KnowledgeRouter, LoreRememberWeb } from "@lore/remember/web";
import { LoreShipApi } from "@lore/ship/api";
import { LoreShipMcp } from "@lore/ship/mcp";
import { DeployRouter, LoreShipWeb } from "@lore/ship/web";
import type { Alepha } from "alepha";

/**
 * Which half of Lore a scenario boots:
 *
 * - `api`: the packages' server modules, as `main.server.ts` registers them;
 * - `mcp`: their MCP tools;
 * - `web`: their web modules, which also inject every router;
 * - `routes`: the routers alone (every module's pages and account pages),
 *   for a spec that resolves the page table without the UI behind it.
 */
export type LoreLayer = "api" | "mcp" | "web" | "routes";

/**
 * The page tree of the whole app, as one `ReactRouter<LoreRouter>` reads it:
 * core's pages and each module's, mounted under them with `parent:`.
 */
export type LoreRouter = CoreRouter &
  WorkRouter &
  RequirementsRouter &
  KnowledgeRouter &
  QualityRouter &
  DeployRouter &
  PromptsRouter;

/**
 * Boots Lore the way its entries do, for a scenario spec: one that spans
 * several packages, which is why it lives in `apps/lore/test` rather than in
 * a package's own `test/` (#E75, #Q2616). Each layer registers core first,
 * then Plan, Remember and Ship, the entries' order.
 *
 * Call it after the spec's own substitutions: a substitution recorded after a
 * module resolved what it replaces is a `TooLateSubstitutionError`.
 */
export const bootLore = (
  alepha: Alepha,
  layers: LoreLayer[] = ["api"],
): Alepha => {
  if (layers.includes("api")) {
    alepha
      .with(LoreCoreApi)
      .with(LorePlanApi)
      .with(LoreRememberApi)
      .with(LoreShipApi)
      .with(LorePlanRequirementsApi)
      .with(LoreChatApi)
      .with(LorePromptsApi);
  }
  if (layers.includes("mcp")) {
    alepha
      .with(LoreCoreMcp)
      .with(LorePlanMcp)
      .with(LoreRememberMcp)
      .with(LoreShipMcp)
      .with(LorePlanRequirementsMcp)
      .with(LoreChatMcp)
      .with(LorePromptsMcp);
  }
  if (layers.includes("web")) {
    alepha
      .with(LoreCoreWeb)
      .with(LorePlanWeb)
      .with(LoreRememberWeb)
      .with(LoreShipWeb)
      .with(LorePlanRequirementsWeb)
      .with(LoreChatWeb)
      .with(LorePromptsWeb);
  }
  if (layers.includes("routes")) {
    alepha.inject(WorkRouter);
    alepha.inject(RequirementsRouter);
    alepha.inject(KnowledgeRouter);
    alepha.inject(QualityRouter);
    alepha.inject(DeployRouter);
    alepha.inject(ChatRouter);
    alepha.inject(PromptsRouter);
    alepha.inject(LoreAccountSections);
    alepha.inject(WorkAccountSections);
  }
  return alepha;
};
