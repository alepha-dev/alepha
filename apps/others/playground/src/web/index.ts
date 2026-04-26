import { $module } from "alepha";
import { AlephaReactI18n } from "alepha/react/i18n";
import { AlephaReactUi } from "alepha/react/ui";
import { AppRouter } from "./AppRouter.ts";

export const PlaygroundWeb = $module({
  name: "playground.web",
  imports: [AlephaReactI18n, AlephaReactUi],
  services: [AppRouter],
});
