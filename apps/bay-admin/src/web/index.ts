import { $module } from "alepha";
import { AlephaReactAuth } from "alepha/react/auth";
import { AlephaReactI18n } from "alepha/react/i18n";
import { AlephaReactUi } from "alepha/react/ui";
import { AppRouter } from "./AppRouter.ts";

export const BayAdminWeb = $module({
  name: "bay-admin.web",
  // The `@alepha/ui` blocks reach for framework services that only exist if
  // their module is registered, and they do it at render/submit time rather
  // than at boot — so a missing one surfaces as a `ContainerLockedError` inside
  // a form the user just submitted, not as a startup failure:
  //
  // - `alepha.react.i18n` — `DialogProvider` calls `useI18n()` unconditionally,
  //   even though bay-admin ships a single language.
  // - `alepha.react.auth` — `AuthLogin` / `AuthRegister` call `useAuth().login`.
  imports: [AlephaReactUi, AlephaReactI18n, AlephaReactAuth],
  services: [AppRouter],
});
