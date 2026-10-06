import { AlephaSigil } from "@alepha/lore/sigil";
import { LoreCoreWeb } from "@lore/core/web";
import { LoreDeployWeb } from "@lore/deploy/web";
import { LoreKnowledgeWeb } from "@lore/knowledge/web";
import { LoreWorkWeb } from "@lore/work/web";
import { $module } from "alepha";

import { LoreDashboardCatalog } from "@/api/dashboardCatalogModule.ts";

import { AppRouter } from "./AppRouter.ts";
import { folioTreeCollapsedAtom } from "./atoms/folioTreeCollapsedAtom.ts";
import { projectDirectoriesAtom } from "./atoms/projectDirectoriesAtom.ts";
import { DeployAccountRouter } from "./components/account/DeployAccountRouter.ts";
import { DeployProjectLoader } from "./loaders/DeployProjectLoader.ts";
import { DeployShell } from "./shell/DeployShell.ts";
import { KnowledgeShell } from "./shell/KnowledgeShell.ts";

export const LoreWebApp = $module({
  name: "lore.web.app",
  // The packages, core first, so whatever boots this module boots the whole app
  // in the order the entries register it (#E75).
  imports: [
    LoreCoreWeb,
    LoreWorkWeb,
    LoreKnowledgeWeb,
    LoreDeployWeb,
    AlephaSigil,
    // The dashboard's tiles and its Add-card panel are generated from the
    // metric registry, so the browser needs the declarative half of it.
    LoreDashboardCatalog,
  ],
  services: [
    AppRouter,
    DeployAccountRouter,
    DeployProjectLoader,
    KnowledgeShell,
    DeployShell,
  ],
  atoms: [projectDirectoriesAtom, folioTreeCollapsedAtom],
});
