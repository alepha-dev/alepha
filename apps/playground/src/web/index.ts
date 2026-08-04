import { AuthRouter } from "@alepha/ui/components/auth/auth-router";
import { $module } from "alepha";
import { AlephaReactAuth } from "alepha/react/auth";
import { AlephaReactI18n } from "alepha/react/i18n";
import { AlephaReactUi } from "alepha/react/ui";
import { AppRouter } from "./AppRouter.tsx";
import { PlaygroundI18n } from "./PlaygroundI18n.ts";

export const PlaygroundWeb = $module({
  name: "playground.web",
  imports: [AlephaReactAuth, AlephaReactI18n, AlephaReactUi],
  /*
   * `AuthRouter` supplies `/auth/login`, `/auth/register`, `/auth/reset-password`
   * and `/auth/verify-email` — the same four paths the playground declared by
   * hand, so nothing moves.
   */
  services: [AppRouter, AuthRouter, PlaygroundI18n],
});
