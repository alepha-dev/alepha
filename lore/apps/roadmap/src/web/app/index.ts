import {
  AlephaUI,
  alephaThemeListAtom,
  defaultTheme,
  midnightTheme,
} from "@alepha/ui";
import { AlephaUIAuth } from "@alepha/ui/auth";
import { $module } from "alepha";
import { CharacterInfo } from "../../api/services/CharacterInfo.ts";
import { AppRouter } from "./AppRouter.ts";
import { currentAssignedTasksAtom } from "./atoms/currentAssignedTasksAtom.ts";
import { currentProjectAtom } from "./atoms/currentProjectAtom.ts";
import { currentProjectCharacterAtom } from "./atoms/currentProjectCharacterAtom.ts";
import { currentTaskAtom } from "./atoms/currentTaskAtom.ts";
import {
  currentWhiteboardAtom,
  currentWhiteboardsAtom,
} from "./atoms/currentWhiteboardsAtom.ts";
import { userProjectsAtom } from "./atoms/userProjectsAtom.ts";
import { MeRouter } from "./components/profile/MeRouter.ts";
import { I18n } from "./services/I18n.ts";
import { Toaster } from "./services/Toaster.ts";

export const RoadmapWebApp = $module({
  name: "roadmap.web.app",
  services: [Toaster, I18n, AppRouter, MeRouter],
  atoms: [
    currentAssignedTasksAtom,
    currentProjectAtom,
    currentProjectCharacterAtom,
    currentTaskAtom,
    currentWhiteboardAtom,
    currentWhiteboardsAtom,
    userProjectsAtom,
  ],
  register(alepha) {
    alepha
      .with(AlephaUI)
      .with(AlephaUIAuth)
      .with(Toaster)
      .with(I18n)
      .with(AppRouter)
      .with(CharacterInfo)
      .set(alephaThemeListAtom, [
        defaultTheme,
        {
          ...midnightTheme,
          primaryColor: "gray",
        },
      ]);
  },
});
