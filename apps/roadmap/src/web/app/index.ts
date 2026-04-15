import { AlephaUI } from "@alepha/ui";
import { AlephaUIAuth } from "@alepha/ui/auth";
import { $module } from "alepha";
import { CharacterInfo } from "../../api/services/CharacterInfo.ts";
import { AppRouter } from "./AppRouter.ts";
import { currentAssignedTasksAtom } from "./atoms/currentAssignedTasksAtom.ts";
import { currentChaptersAtom } from "./atoms/currentChaptersAtom.ts";
import { currentProjectAtom } from "./atoms/currentProjectAtom.ts";
import { currentProjectCharacterAtom } from "./atoms/currentProjectCharacterAtom.ts";
import { currentTaskAtom } from "./atoms/currentTaskAtom.ts";
import {
  currentWhiteboardAtom,
  currentWhiteboardsAtom,
} from "./atoms/currentWhiteboardsAtom.ts";
import {
  kanbanProjectAtom,
  kanbanReloadAtom,
} from "./atoms/kanbanProjectAtom.ts";
import { userProjectsAtom } from "./atoms/userProjectsAtom.ts";
import { MeRouter } from "./components/profile/me/MeRouter.ts";
import { I18n } from "./services/I18n.ts";
import { Toaster } from "./services/Toaster.ts";

export const RoadmapWebApp = $module({
  name: "roadmap.web.app",
  services: [Toaster, I18n, AppRouter, MeRouter],
  atoms: [
    currentAssignedTasksAtom,
    currentChaptersAtom,
    currentProjectAtom,
    currentProjectCharacterAtom,
    currentTaskAtom,
    currentWhiteboardAtom,
    currentWhiteboardsAtom,
    kanbanProjectAtom,
    kanbanReloadAtom,
    userProjectsAtom,
  ],
  imports: [AlephaUI, AlephaUIAuth],
  register(alepha) {
    alepha.with(CharacterInfo);
  },
});
