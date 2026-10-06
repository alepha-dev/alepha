import { $module } from "alepha";

import { EpicRefService } from "./services/EpicRefService.ts";
import { KnowledgeProjectContext } from "./services/KnowledgeProjectContext.ts";
import { WorkProjectContext } from "./services/WorkProjectContext.ts";
import { AppInstanceTools } from "./tools/AppInstanceTools.ts";
import { ArtifactTools } from "./tools/ArtifactTools.ts";
import { BlightTools } from "./tools/BlightTools.ts";
import { DeployTools } from "./tools/DeployTools.ts";
import { EpicTools } from "./tools/EpicTools.ts";
import { FeedbackTools } from "./tools/FeedbackTools.ts";
import { FolioTools } from "./tools/FolioTools.ts";
import { InsightsTools } from "./tools/InsightsTools.ts";
import { QuestTools } from "./tools/QuestTools.ts";
import { ReleaseTools } from "./tools/ReleaseTools.ts";
import { SigilTools } from "./tools/SigilTools.ts";

export const LoreMcp = $module({
  name: "lore.mcp",
  services: [
    QuestTools,
    BlightTools,
    ArtifactTools,
    ReleaseTools,
    EpicTools,
    FolioTools,
    FeedbackTools,
    AppInstanceTools,
    DeployTools,
    SigilTools,
    InsightsTools,
    EpicRefService,
    // The orientation sections each module registers on the core
    // `ProjectContextRegistry` (#E75, #Q2623); listed because nothing
    // injects them.
    WorkProjectContext,
    KnowledgeProjectContext,
  ],
});
