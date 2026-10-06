import { AlephaSigil } from "@alepha/lore/sigil";
import { $module } from "alepha";

import { LoreDashboardCatalog } from "@/api/dashboardCatalogModule.ts";

import { AppRouter } from "./AppRouter.ts";
import { currentAssignedQuestsAtom } from "./atoms/currentAssignedQuestsAtom.ts";
import { currentEpicsAtom } from "./atoms/currentEpicsAtom.ts";
import { currentQuestAtom } from "./atoms/currentQuestAtom.ts";
import { currentReleasesAtom } from "./atoms/currentReleasesAtom.ts";
import { folioTreeCollapsedAtom } from "./atoms/folioTreeCollapsedAtom.ts";
import { kanbanFiltersAtom } from "./atoms/kanbanFiltersAtom.ts";
import { kanbanReloadAtom } from "./atoms/kanbanReloadAtom.ts";
import { projectDirectoriesAtom } from "./atoms/projectDirectoriesAtom.ts";
import { questLogCollapsedAtom } from "./atoms/questLogCollapsedAtom.ts";
import { DeployAccountRouter } from "./components/account/DeployAccountRouter.ts";
import { WorkAccountRouter } from "./components/account/feedback/WorkAccountRouter.ts";
import { DeployProjectLoader } from "./loaders/DeployProjectLoader.ts";
import { WorkProjectLoader } from "./loaders/WorkProjectLoader.ts";
import { DeployShell } from "./shell/DeployShell.ts";
import { KnowledgeShell } from "./shell/KnowledgeShell.ts";
import { WorkShell } from "./shell/WorkShell.ts";

export const LoreWebApp = $module({
  name: "lore.web.app",
  imports: [
    AlephaSigil,
    // The dashboard's tiles and its Add-card panel are generated from the
    // metric registry, so the browser needs the declarative half of it.
    LoreDashboardCatalog,
  ],
  services: [
    AppRouter,
    // The account pages Work and Deploy own (#E75, #Q2624).
    WorkAccountRouter,
    DeployAccountRouter,
    // Each module's part of opening a project, registered on core's
    // `ProjectLoaderRegistry` (#E75, #Q2624). Listed because nothing injects
    // them, and here because the loader runs on both sides of hydration.
    WorkProjectLoader,
    DeployProjectLoader,
    // Their part of the project shell (sidebar, settings, create menu,
    // breadcrumbs, palette), on core's `ProjectShellRegistry`.
    WorkShell,
    KnowledgeShell,
    DeployShell,
  ],
  atoms: [
    projectDirectoriesAtom,
    currentAssignedQuestsAtom,
    currentReleasesAtom,
    currentEpicsAtom,
    folioTreeCollapsedAtom,
    currentQuestAtom,
    kanbanFiltersAtom,
    kanbanReloadAtom,
    // Registered here, unlike most of the `current*` atoms, so the cookie
    // value is hydrated before the first render that reads it. An
    // unregistered `persist: "cookie"` atom still persists, lazily, on its
    // first read.
    questLogCollapsedAtom,
  ],
});
