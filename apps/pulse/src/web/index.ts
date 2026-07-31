import { $module } from "alepha";
import { AlephaReactAuth } from "alepha/react/auth";
import { AlephaReactI18n } from "alepha/react/i18n";
import { AlephaReactUi } from "alepha/react/ui";
import { AppRouter } from "./AppRouter.ts";

/**
 * Pulse's web layer.
 *
 * `AlephaReactI18n` and `AlephaReactAuth` are imported even though this app
 * ships one language: the `@alepha/ui` blocks call `useI18n()` and `useAuth()`
 * at render or submit time, so a missing module surfaces as a
 * `ContainerLockedError` inside a form somebody just submitted rather than as
 * a startup failure.
 */
export const PulseWeb = $module({
  name: "pulse.web",
  imports: [AlephaReactUi, AlephaReactI18n, AlephaReactAuth],
  services: [AppRouter],
});
