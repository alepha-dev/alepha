import { LoreCoreApi } from "@lore/core/api";
import { LoreCoreMcp } from "@lore/core/mcp";
import { CoreRouter, LoreAccountRouter, LoreCoreWeb } from "@lore/core/web";
import { LoreDeployApi } from "@lore/deploy/api";
import { LoreDeployMcp } from "@lore/deploy/mcp";
import {
  DeployAccountRouter,
  DeployRouter,
  LoreDeployWeb,
} from "@lore/deploy/web";
import { LoreKnowledgeApi } from "@lore/knowledge/api";
import { LoreKnowledgeMcp } from "@lore/knowledge/mcp";
import { KnowledgeRouter, LoreKnowledgeWeb } from "@lore/knowledge/web";
import { LoreWorkApi } from "@lore/work/api";
import { LoreWorkMcp } from "@lore/work/mcp";
import { LoreWorkWeb, WorkAccountRouter, WorkRouter } from "@lore/work/web";
import type { Alepha } from "alepha";

/**
 * Which half of Lore a scenario boots:
 *
 * - `api`: the four packages' server modules, as `main.server.ts` registers them;
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
  KnowledgeRouter &
  DeployRouter;

/**
 * Boots Lore the way its entries do, for a scenario spec: one that spans
 * several packages, which is why it lives in `apps/lore/test` rather than in
 * a package's own `test/` (#E75, #Q2616). Each layer registers core first,
 * then Work, Knowledge and Deploy, the entries' order.
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
      .with(LoreWorkApi)
      .with(LoreKnowledgeApi)
      .with(LoreDeployApi);
  }
  if (layers.includes("mcp")) {
    alepha
      .with(LoreCoreMcp)
      .with(LoreWorkMcp)
      .with(LoreKnowledgeMcp)
      .with(LoreDeployMcp);
  }
  if (layers.includes("web")) {
    alepha
      .with(LoreCoreWeb)
      .with(LoreWorkWeb)
      .with(LoreKnowledgeWeb)
      .with(LoreDeployWeb);
  }
  if (layers.includes("routes")) {
    alepha.inject(WorkRouter);
    alepha.inject(KnowledgeRouter);
    alepha.inject(DeployRouter);
    alepha.inject(LoreAccountRouter);
    alepha.inject(WorkAccountRouter);
    alepha.inject(DeployAccountRouter);
  }
  return alepha;
};
