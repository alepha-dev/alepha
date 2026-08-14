import { AlephaSigil } from "@alepha/sigil";
import { AccountRouter } from "@alepha/ui/components/account/account-router";
import { accountRouterOptionsAtom } from "@alepha/ui/components/account/account-router-options";
import { $module } from "alepha";
import { AlephaCrypto } from "alepha/crypto";
import { I18nProvider } from "alepha/react/i18n";
import { AlephaReactUi } from "alepha/react/ui";
import { createElement } from "react";
import { AppRouter } from "./AppRouter.ts";
import { currentAssignedQuestsAtom } from "./atoms/currentAssignedQuestsAtom.ts";
import { currentMilestonesAtom } from "./atoms/currentMilestonesAtom.ts";
import { currentProjectAtom } from "./atoms/currentProjectAtom.ts";
import { currentProjectMemberAtom } from "./atoms/currentProjectMemberAtom.ts";
import { currentQuestAtom } from "./atoms/currentQuestAtom.ts";
import {
  kanbanProjectAtom,
  kanbanReloadAtom,
} from "./atoms/kanbanProjectAtom.ts";
import { projectDirectoriesAtom } from "./atoms/projectDirectoriesAtom.ts";
import { questsViewAtom } from "./atoms/questsViewAtom.ts";
import { userProjectsAtom } from "./atoms/userProjectsAtom.ts";
import AccountDeleteWarning from "./components/account/AccountDeleteWarning.tsx";
import { LoreAccountRouter } from "./components/account/LoreAccountRouter.ts";
import { I18n } from "./services/I18n.ts";
import { ThemesProvider } from "./services/ThemesProvider.ts";

export const LoreWebApp = $module({
  name: "lore.web.app",
  imports: [AlephaReactUi, AlephaCrypto, AlephaSigil],
  services: [I18n, ThemesProvider, AppRouter, AccountRouter, LoreAccountRouter],
  atoms: [
    projectDirectoriesAtom,
    currentAssignedQuestsAtom,
    currentMilestonesAtom,
    currentProjectAtom,
    currentProjectMemberAtom,
    currentQuestAtom,
    kanbanProjectAtom,
    kanbanReloadAtom,
    // Registered here, unlike most of the `current*` atoms, because
    // `persist: "cookie"` only binds for atoms the state manager knows
    // about — an unregistered persisted atom is silently in-memory only.
    questsViewAtom,
    userProjectsAtom,
  ],
  register(alepha) {
    // Lore's `quests.createdBy` cascades, so deleting an account also deletes
    // every quest it authored — including inside other people's projects. The
    // framework cannot know that; this fills the dialog's warning slot so the
    // count is stated before the click rather than discovered after it.
    alepha.store.set(accountRouterOptionsAtom, {
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
