import { $module } from "alepha";
import { StreamableHttpMcpTransport } from "alepha/mcp";

import { McpCallRates } from "../api/services/McpCallRates.ts";
import { ProjectResources } from "./resources/ProjectResources.ts";
import { AttachmentContentService } from "./services/AttachmentContentService.ts";
import { AttachmentPushCommand } from "./services/AttachmentPushCommand.ts";
import { EpicRefService } from "./services/EpicRefService.ts";
import { AppInstanceTools } from "./tools/AppInstanceTools.ts";
import { ArtifactTools } from "./tools/ArtifactTools.ts";
import { BlightTools } from "./tools/BlightTools.ts";
import { DeployTools } from "./tools/DeployTools.ts";
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
    // Counts every tool call into the `mcp_calls` dataset (#E65). Listed
    // here because nothing injects it: it is a `$hook` subscriber and the
    // event reaches it only if the class was constructed.
    McpCallRates,
    QuestTools,
    BlightTools,
    ArtifactTools,
    ProjectTools,
    ReleaseTools,
    EpicTools,
    FolioTools,
    FeedbackTools,
    AppInstanceTools,
    DeployTools,
    SigilTools,
    InsightsTools,
    ProjectResources,
    AttachmentContentService,
    AttachmentPushCommand,
    EpicRefService,
  ],
});
