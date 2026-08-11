import { AdminRouter } from "@alepha/ui/components/admin/admin-router";
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
   *
   * `AdminRouter` supplies the whole `/admin` surface the same way; its chrome
   * is configured via `adminRouterOptionsAtom`, set from both `main.server.ts`
   * and `main.browser.ts` (see `./adminChrome.tsx`).
   */
  services: [AppRouter, AuthRouter, AdminRouter, PlaygroundI18n],
});
