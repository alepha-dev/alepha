import { LorePlanWeb } from "@lore/plan/web";
import { $module } from "alepha";

import { RequirementsDashboardMetrics } from "../api/services/RequirementsDashboardMetrics.ts";
import { currentPersonaAtom } from "./app/atoms/currentPersonaAtom.ts";
import { currentUseCaseAtom } from "./app/atoms/currentUseCaseAtom.ts";
import { useCaseGroupingAtom } from "./app/atoms/useCaseGroupingAtom.ts";
import { RequirementsRouter } from "./app/RequirementsRouter.ts";
import { RequirementsShell } from "./app/shell/RequirementsShell.ts";

/**
 * The browser-safe half of `@lore/plan-requirements`, Plan's Requirements
 * (#E153): personas, use cases and requirements, their pages and their part
 * of the project shell.
 *
 * Registered by BOTH entries, after `LorePlanWeb`: the server renders and
 * the browser hydrates from the same page registry.
 *
 * It imports another package's `./api` or `./mcp` as `import type` only.
 *
 * @module
 */
export const LorePlanRequirementsWeb = $module({
  name: "lore.plan-requirements.web",
  // Plan first: Requirements extends Plan's sidebar, so booting this module
  // alone boots the shell it extends.
  imports: [LorePlanWeb],
  atoms: [currentPersonaAtom, currentUseCaseAtom, useCaseGroupingAtom],
  register(alepha) {
    // Injected rather than listed in `services`, as `LorePlanWeb` does: a
    // listed service is tagged with this module, and injecting it anywhere
    // would register the whole module.
    alepha.with(RequirementsRouter);
    alepha.inject(RequirementsShell);
    // The dashboard cards' declarative half, which the browser needs to
    // draw the tiles (#Q3775).
    alepha.inject(RequirementsDashboardMetrics);
  },
});

// What code outside `src/` imports from this barrel.

export { RequirementsRouter } from "./app/RequirementsRouter.ts";
export { currentPersonaAtom } from "./app/atoms/currentPersonaAtom.ts";
export { currentUseCaseAtom } from "./app/atoms/currentUseCaseAtom.ts";
export { RequirementsShell } from "./app/shell/RequirementsShell.ts";
export { REQUIREMENTS_NAV_ROUTES } from "./app/components/pages/requirementsNavRoutes.ts";

/**
 * Requirements' router in the app's router registry (#Q3187).
 */
declare module "alepha/react/router" {
  interface Routers {
    lorePlanRequirements: RequirementsRouter;
  }
}
