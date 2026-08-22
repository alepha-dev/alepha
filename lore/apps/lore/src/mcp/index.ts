import { $module } from "alepha";
import { StreamableHttpMcpTransport } from "alepha/mcp";

import { ProjectResources } from "./resources/ProjectResources.ts";
import { AttachmentContentService } from "./services/AttachmentContentService.ts";
import { EpicRefService } from "./services/EpicRefService.ts";
import { BlightTools } from "./tools/BlightTools.ts";
import { EpicTools } from "./tools/EpicTools.ts";
import { FeedbackTools } from "./tools/FeedbackTools.ts";
import { FolioTools } from "./tools/FolioTools.ts";
import { InsightsTools } from "./tools/InsightsTools.ts";
import { MilestoneTools } from "./tools/MilestoneTools.ts";
import { ProjectTools } from "./tools/ProjectTools.ts";
import { QuestTools } from "./tools/QuestTools.ts";
import { SigilTools } from "./tools/SigilTools.ts";

export const LoreMcp = $module({
  name: "lore.mcp",
  services: [
    StreamableHttpMcpTransport,
    QuestTools,
    BlightTools,
    ProjectTools,
    MilestoneTools,
    EpicTools,
    FolioTools,
    FeedbackTools,
    SigilTools,
    InsightsTools,
    ProjectResources,
    AttachmentContentService,
    EpicRefService,
  ],
});
