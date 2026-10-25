import { OtaAdminRouter } from "@alepha/capacitor/ota-admin";
import { AccountRouter } from "@alepha/ui/account";
import { AdminRouter } from "@alepha/ui/admin";
import { AuthRouter } from "@alepha/ui/auth";
import { $module } from "alepha";
import { AlephaReactAuth } from "alepha/react/auth";
import { AlephaReactI18n } from "alepha/react/i18n";
import { AlephaReactUi } from "alepha/react/ui";

import { AppRouter } from "./AppRouter.ts";

/**
 * The three routers mount their own pages — /auth/*, /account/* and /admin/*
 * — so there is nothing to declare beyond listing them.
 *
 * Each page hides itself when the action behind it is missing from
 * /api/_links, so deleting a module from ApiModule removes its screens too
 * rather than leaving a link to a 404. Drop a router from this list when you
 * want the whole surface gone.
 */
export const WebModule = $module({
  name: "mobile.web",
  imports: [AlephaReactAuth, AlephaReactI18n, AlephaReactUi],
  services: [AppRouter, AuthRouter, AccountRouter, AdminRouter, OtaAdminRouter],
});
