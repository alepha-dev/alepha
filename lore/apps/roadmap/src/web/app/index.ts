import { $module } from "alepha";
import { AlephaReactUi } from "alepha/react/ui";
import { CharacterInfo } from "../../api/services/CharacterInfo.ts";
import { AppRouter } from "./AppRouter.ts";
import { currentAssignedTasksAtom } from "./atoms/currentAssignedTasksAtom.ts";
import { currentChaptersAtom } from "./atoms/currentChaptersAtom.ts";
import { currentProjectAtom } from "./atoms/currentProjectAtom.ts";
import { currentProjectCharacterAtom } from "./atoms/currentProjectCharacterAtom.ts";
import { currentTaskAtom } from "./atoms/currentTaskAtom.ts";
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
  imports: [AlephaReactUi],
  services: [Toaster, I18n, AppRouter, MeRouter],
  atoms: [
    currentAssignedTasksAtom,
    currentChaptersAtom,
    currentProjectAtom,
    currentProjectCharacterAtom,
    currentTaskAtom,
    kanbanProjectAtom,
    kanbanReloadAtom,
    userProjectsAtom,
  ],
  register(alepha) {
    alepha.with(CharacterInfo);
  },
});
