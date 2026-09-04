import { AlephaSigil } from "@alepha/lore/sigil";
import { AccountRouter } from "@alepha/ui/components/account/account-router";
import { accountRouterOptionsAtom } from "@alepha/ui/components/account/account-router-options";
import { $module } from "alepha";
import { AlephaCrypto } from "alepha/crypto";
import { I18nProvider } from "alepha/react/i18n";
import { AlephaReactUi } from "alepha/react/ui";
import { createElement } from "react";

import { LoreDashboardCatalog } from "@/api/dashboardCatalogModule.ts";

import { AppRouter } from "./AppRouter.ts";
import { currentAssignedQuestsAtom } from "./atoms/currentAssignedQuestsAtom.ts";
import { currentEpicsAtom } from "./atoms/currentEpicsAtom.ts";
import { currentProjectAtom } from "./atoms/currentProjectAtom.ts";
import { currentProjectMemberAtom } from "./atoms/currentProjectMemberAtom.ts";
import { currentQuestAtom } from "./atoms/currentQuestAtom.ts";
import { currentReleasesAtom } from "./atoms/currentReleasesAtom.ts";
import { dashboardAtom } from "./atoms/dashboardAtom.ts";
import { epicReviewPromptAtom } from "./atoms/epicReviewPromptAtom.ts";
import { folioTreeCollapsedAtom } from "./atoms/folioTreeCollapsedAtom.ts";
import { kanbanFiltersAtom } from "./atoms/kanbanFiltersAtom.ts";
import { kanbanReloadAtom } from "./atoms/kanbanReloadAtom.ts";
import { projectDirectoriesAtom } from "./atoms/projectDirectoriesAtom.ts";
import { questLogCollapsedAtom } from "./atoms/questLogCollapsedAtom.ts";
import { userProjectsAtom } from "./atoms/userProjectsAtom.ts";
import AccountDeleteWarning from "./components/account/AccountDeleteWarning.tsx";
import { LoreAccountRouter } from "./components/account/LoreAccountRouter.ts";
import { I18n } from "./services/I18n.ts";
import { ThemesProvider } from "./services/ThemesProvider.ts";

export const LoreWebApp = $module({
  name: "lore.web.app",
  imports: [
    AlephaReactUi,
    AlephaCrypto,
    AlephaSigil,
    // The dashboard's tiles and its Add-card panel are generated from the
    // metric registry, so the browser needs the declarative half of it.
    LoreDashboardCatalog,
  ],
  services: [I18n, ThemesProvider, AppRouter, AccountRouter, LoreAccountRouter],
  atoms: [
    projectDirectoriesAtom,
    currentAssignedQuestsAtom,
    currentReleasesAtom,
    currentEpicsAtom,
    epicReviewPromptAtom,
    folioTreeCollapsedAtom,
    currentProjectAtom,
    currentProjectMemberAtom,
    currentQuestAtom,
    kanbanFiltersAtom,
    kanbanReloadAtom,
    // Registered here, unlike most of the `current*` atoms, so the cookie
    // value is hydrated before the first render that reads it. An
    // unregistered `persist: "cookie"` atom still persists, lazily, on its
    // first read.
    questLogCollapsedAtom,
    userProjectsAtom,
    dashboardAtom,
  ],
  register(alepha) {
    // Lore's `quests.createdBy` cascades, so deleting an account also deletes
    // every quest it authored — including inside other people's projects. The
    // framework cannot know that; this fills the dialog's warning slot so the
    // count is stated before the click rather than discovered after it.
    alepha.store.set(accountRouterOptionsAtom, {
      // `Layout.tsx` is `h-svh … overflow-hidden`, so the document never
      // scrolls and every page under it owns its scroll. Without this the
      // account pages have no scrollbar at all: `/account/feedback` past a
      // dozen rows simply loses the rest of the table and its pagination bar
      // below the fold, with nothing to scroll.
      fill: true,
      pages: {
        security: { deleteWarning: createElement(AccountDeleteWarning) },
      },
    });

    // Dogfood locale-prefix routing: French gets `/fr/...` URLs, English (the
    // default) stays unprefixed. Source of truth is the URL, with hreflang
    // alternates emitted for SEO.
    alepha.inject(I18nProvider).options.routing = "prefix";
  },
});
