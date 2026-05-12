import { $module } from "alepha";
import { StreamableHttpMcpTransport } from "alepha/mcp";
import { CampaignResources } from "./resources/CampaignResources.ts";
import { CampaignTools } from "./tools/CampaignTools.ts";
import { ChapterTools } from "./tools/ChapterTools.ts";
import { FolioTools } from "./tools/FolioTools.ts";
import { QuestTools } from "./tools/QuestTools.ts";

export const LoreMcp = $module({
  name: "lore.mcp",
  services: [
    StreamableHttpMcpTransport,
    QuestTools,
    CampaignTools,
    ChapterTools,
    FolioTools,
    CampaignResources,
  ],
});
