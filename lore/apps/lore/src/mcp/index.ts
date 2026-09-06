import { $module } from "alepha";
import { StreamableHttpMcpTransport } from "alepha/mcp";

import { ProjectResources } from "./resources/ProjectResources.ts";
import { AttachmentContentService } from "./services/AttachmentContentService.ts";
import { AttachmentPushCommand } from "./services/AttachmentPushCommand.ts";
import { EpicRefService } from "./services/EpicRefService.ts";
import { AppInstanceTools } from "./tools/AppInstanceTools.ts";
import { ArtifactTools } from "./tools/ArtifactTools.ts";
import { BlightTools } from "./tools/BlightTools.ts";
import { EpicTools } from "./tools/EpicTools.ts";
import { FeedbackTools } from "./tools/FeedbackTools.ts";
import { FolioTools } from "./tools/FolioTools.ts";
import { InsightsTools } from "./tools/InsightsTools.ts";
import { ProjectTools } from "./tools/ProjectTools.ts";
import { QuestTools } from "./tools/QuestTools.ts";
import { ReleaseTools } from "./tools/ReleaseTools.ts";
import { SigilTools } from "./tools/SigilTools.ts";

export const LoreMcp = $module({
  name: "lore.mcp",
  services: [
    StreamableHttpMcpTransport,
    QuestTools,
    BlightTools,
    ArtifactTools,
    ProjectTools,
    ReleaseTools,
    EpicTools,
    FolioTools,
    FeedbackTools,
    AppInstanceTools,
    SigilTools,
    InsightsTools,
    ProjectResources,
    AttachmentContentService,
    AttachmentPushCommand,
    EpicRefService,
  ],
});
