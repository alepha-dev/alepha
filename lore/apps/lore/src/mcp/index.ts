import { LoreCoreMcp } from "@lore/core/mcp";
import { LoreDeployMcp } from "@lore/deploy/mcp";
import { LoreKnowledgeMcp } from "@lore/knowledge/mcp";
import { LoreWorkMcp } from "@lore/work/mcp";
import { $module } from "alepha";

import { KnowledgeProjectContext } from "./services/KnowledgeProjectContext.ts";
import { AppInstanceTools } from "./tools/AppInstanceTools.ts";
import { ArtifactTools } from "./tools/ArtifactTools.ts";
import { BlightTools } from "./tools/BlightTools.ts";
import { DeployTools } from "./tools/DeployTools.ts";
import { FolioTools } from "./tools/FolioTools.ts";
import { InsightsTools } from "./tools/InsightsTools.ts";
import { SigilTools } from "./tools/SigilTools.ts";

export const LoreMcp = $module({
  name: "lore.mcp",
  // The packages, core first, so whatever boots this module boots the whole app
  // in the order the entries register it (#E75).
  imports: [LoreCoreMcp, LoreWorkMcp, LoreKnowledgeMcp, LoreDeployMcp],
  services: [
    BlightTools,
    ArtifactTools,
    FolioTools,
    AppInstanceTools,
    DeployTools,
    SigilTools,
    InsightsTools,
    KnowledgeProjectContext,
  ],
});
