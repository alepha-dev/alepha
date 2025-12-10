import { AlephaUI, alephaThemeAtom } from "@alepha/ui";
import { AlephaUIAuth } from "@alepha/ui/auth";
import { $module } from "alepha";
import { CharacterInfo } from "../api/services/CharacterInfo.ts";
import { AppRouter } from "./AppRouter.ts";
import { I18n } from "./services/I18n.ts";
import { Toaster } from "./services/Toaster.ts";

export * from "./AppRouter.ts";
export * from "./atoms/currentAssignedTasksAtom.ts";
export * from "./atoms/currentProjectAtom.ts";
export * from "./atoms/currentProjectCharacterAtom.ts";
export * from "./atoms/currentTaskAtom.ts";
export * from "./atoms/userProjectsAtom.ts";
export * from "./services/I18n.ts";
export * from "./services/Toaster.ts";

export const RoadmapWeb = $module({
  name: "roadmap.web",
  services: [Toaster, I18n, AppRouter],
  register(alepha) {
    alepha
      .with(AlephaUI)
      .with(AlephaUIAuth)
      .with(Toaster)
      .with(I18n)
      .with(AppRouter)
      .with(CharacterInfo)
      .set(alephaThemeAtom, { index: 1 });
  },
});
