import { $module } from "alepha";
import { AlephaReactAuth } from "alepha/react/auth";
import { AlephaReactI18n } from "alepha/react/i18n";
import { AlephaReactUi } from "alepha/react/ui";
import { AppRouter } from "./AppRouter.ts";
import { PlaygroundI18n } from "./PlaygroundI18n.ts";

export const PlaygroundWeb = $module({
  name: "playground.web",
  imports: [AlephaReactAuth, AlephaReactI18n, AlephaReactUi],
  services: [AppRouter, PlaygroundI18n],
});
