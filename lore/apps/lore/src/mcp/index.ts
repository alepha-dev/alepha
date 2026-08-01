import { $module } from "alepha";
import { StreamableHttpMcpTransport } from "alepha/mcp";
import { CampaignResources } from "./resources/CampaignResources.ts";
import { ArchiveTools } from "./tools/ArchiveTools.ts";
import { BlightTools } from "./tools/BlightTools.ts";
import { CampaignTools } from "./tools/CampaignTools.ts";
import { ChapterTools } from "./tools/ChapterTools.ts";
import { FolioTools } from "./tools/FolioTools.ts";
import { PetitionTools } from "./tools/PetitionTools.ts";
import { QuestTools } from "./tools/QuestTools.ts";
import { SigilTools } from "./tools/SigilTools.ts";

export const LoreMcp = $module({
  name: "lore.mcp",
  services: [
    StreamableHttpMcpTransport,
    QuestTools,
    BlightTools,
    CampaignTools,
    ChapterTools,
    FolioTools,
    ArchiveTools,
    PetitionTools,
    SigilTools,
    CampaignResources,
  ],
});
