import { LorePlanApi } from "@lore/plan/api";
import { LoreRememberApi } from "@lore/remember/api";
import { LoreShipApi } from "@lore/ship/api";
import { $module } from "alepha";

import { PersonaController } from "./controllers/PersonaController.ts";
import { UseCaseController } from "./controllers/UseCaseController.ts";
import { PersonaResourceKind } from "./resources/PersonaResourceKind.ts";
import { UseCaseResourceKind } from "./resources/UseCaseResourceKind.ts";
import { RequirementsCommentService } from "./services/RequirementsCommentService.ts";
import { RequirementsProjectMerge } from "./services/RequirementsProjectMerge.ts";
import { UseCaseService } from "./services/UseCaseService.ts";

/**
 * The server half of `@lore/plan-requirements`, Plan's Requirements (#E153):
 * personas, use cases, requirements and their runs.
 *
 * It registers on Plan's capability (its option `requirements`), so a reader
 * only ever sees Plan. It is a package of its own because it writes errors
 * and reads telemetry that are Ship's, and reads folio revisions that are
 * Remember's, none of which `@lore/plan` may import. The edges go one way:
 * Plan, Remember and Ship never import it (`check:conventions`).
 *
 * Registered by `apps/lore/src/main.server.ts` after core, plan, remember
 * and ship.
 *
 * @module
 */
export const LorePlanRequirementsApi = $module({
  name: "lore.plan-requirements.api",
  // What it builds on first: booting this module alone boots them.
  imports: [LorePlanApi, LoreRememberApi, LoreShipApi],
  services: [
    RequirementsCommentService,
    UseCaseService,
    // The resource kinds on core's `ResourceRegistry`: listed, because
    // nothing injects them.
    PersonaResourceKind,
    UseCaseResourceKind,
    // Its step of a project merge, on core's `ProjectMergeService`.
    RequirementsProjectMerge,
    // Controllers
    PersonaController,
    UseCaseController,
  ],
});

// What code outside `src/` imports from this barrel.

export { PersonaController } from "./controllers/PersonaController.ts";
export { UseCaseController } from "./controllers/UseCaseController.ts";
