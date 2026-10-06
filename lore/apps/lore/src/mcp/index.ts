import { LoreCoreMcp } from "@lore/core/mcp";
import { LoreDeployMcp } from "@lore/deploy/mcp";
import { LoreKnowledgeMcp } from "@lore/knowledge/mcp";
import { LoreWorkMcp } from "@lore/work/mcp";
import { $module } from "alepha";

export const LoreMcp = $module({
  name: "lore.mcp",
  // The packages, core first, so whatever boots this module boots the whole app
  // in the order the entries register it (#E75).
  imports: [LoreCoreMcp, LoreWorkMcp, LoreKnowledgeMcp, LoreDeployMcp],
});
