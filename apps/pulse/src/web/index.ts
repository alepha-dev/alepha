import { $module } from "alepha";
import { AlephaReactUi } from "alepha/react/ui";
import { AppRouter } from "./AppRouter.ts";

/**
 * Pulse's web layer.
 *
 * ⚠️ A placeholder. The real UI — app list, error groups, analytics, the
 * metric series — has to be built; the page it grew from is in git history at
 * `apps/bay-admin/src/web/components/AppDetailPage.tsx`, before this app was
 * split out. See `TODO.md`.
 */
export const PulseWeb = $module({
  name: "pulse.web",
  imports: [AlephaReactUi],
  services: [AppRouter],
});
