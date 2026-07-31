import { AlephaPulse } from "@alepha/pulse-client";
import { $module } from "alepha";
import { AlephaCrypto } from "alepha/crypto";
import { I18nProvider } from "alepha/react/i18n";
import { AlephaReactUi } from "alepha/react/ui";
import { AppRouter } from "./AppRouter.ts";
import { campaignDirectoriesAtom } from "./atoms/campaignDirectoriesAtom.ts";
import { currentAssignedQuestsAtom } from "./atoms/currentAssignedQuestsAtom.ts";
import { currentCampaignAtom } from "./atoms/currentCampaignAtom.ts";
import { currentCampaignMemberAtom } from "./atoms/currentCampaignMemberAtom.ts";
import { currentChaptersAtom } from "./atoms/currentChaptersAtom.ts";
import { currentQuestAtom } from "./atoms/currentQuestAtom.ts";
import {
  kanbanCampaignAtom,
  kanbanReloadAtom,
} from "./atoms/kanbanCampaignAtom.ts";
import { userCampaignsAtom } from "./atoms/userCampaignsAtom.ts";
import { MeRouter } from "./components/profile/me/MeRouter.ts";
import { I18n } from "./services/I18n.ts";
import { ThemesProvider } from "./services/ThemesProvider.ts";

export const LoreWebApp = $module({
  name: "lore.web.app",
  imports: [AlephaReactUi, AlephaCrypto, AlephaPulse],
  services: [I18n, ThemesProvider, AppRouter, MeRouter],
  atoms: [
    campaignDirectoriesAtom,
    currentAssignedQuestsAtom,
    currentChaptersAtom,
    currentCampaignAtom,
    currentCampaignMemberAtom,
    currentQuestAtom,
    kanbanCampaignAtom,
    kanbanReloadAtom,
    userCampaignsAtom,
  ],
  register(alepha) {
    // Dogfood locale-prefix routing: French gets `/fr/...` URLs, English (the
    // default) stays unprefixed. Source of truth is the URL, with hreflang
    // alternates emitted for SEO.
    alepha.inject(I18nProvider).options.routing = "prefix";
  },
});
