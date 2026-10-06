import { LoreCoreApi } from "@lore/core/api";
import { LoreDeployApi } from "@lore/deploy/api";
import { LoreKnowledgeApi } from "@lore/knowledge/api";
import { LoreWorkApi } from "@lore/work/api";
import { $module } from "alepha";

import { LoreDashboardCatalog } from "./dashboardCatalogModule.ts";

export const LoreApi = $module({
  name: "lore.api",
  // The packages, core first, so whatever boots this module boots the whole app
  // in the order the entries register it (#E75).
  imports: [
    LoreCoreApi,
    LoreWorkApi,
    LoreKnowledgeApi,
    LoreDeployApi,
    LoreDashboardCatalog,
  ],
});
