import { $module } from "alepha";
import { AlephaCrypto } from "alepha/crypto";
import { AlephaReactUi } from "alepha/react/ui";
import { CharacterInfo } from "../../api/services/CharacterInfo.ts";
import { AppRouter } from "./AppRouter.ts";
import { campaignDirectoriesAtom } from "./atoms/campaignDirectoriesAtom.ts";
import { currentAssignedQuestsAtom } from "./atoms/currentAssignedQuestsAtom.ts";
import { currentCampaignAtom } from "./atoms/currentCampaignAtom.ts";
import { currentCampaignCharacterAtom } from "./atoms/currentCampaignCharacterAtom.ts";
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
  imports: [AlephaReactUi, AlephaCrypto],
  services: [I18n, ThemesProvider, AppRouter, MeRouter],
  atoms: [
    campaignDirectoriesAtom,
    currentAssignedQuestsAtom,
    currentChaptersAtom,
    currentCampaignAtom,
    currentCampaignCharacterAtom,
    currentQuestAtom,
    kanbanCampaignAtom,
    kanbanReloadAtom,
    userCampaignsAtom,
  ],
  register(alepha) {
    alepha.with(CharacterInfo);
  },
});
