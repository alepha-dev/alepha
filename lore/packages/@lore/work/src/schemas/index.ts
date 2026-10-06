/**
 * The browser-safe schemas of `@lore/work`, Lore as Jira: quests, epics, releases, areas, the kanban, the roadmap and feedback.
 *
 * What another package, a browser page or an end-to-end spec may import as a
 * runtime value. Nothing here reaches a server-only module.
 *
 * @module
 */

// What code outside `src/` imports from this barrel: other packages and the
// specs (`apps/lore/test`, `apps/e2e`, Work's own `test/`). Everything else
// stays internal, reached by relative import.

export { areas } from "../api/entities/areas.ts";
export { epics } from "../api/entities/epics.ts";
export { feedback } from "../api/entities/feedback.ts";
export { questComments } from "../api/entities/questComments.ts";
export { quests } from "../api/entities/quests.ts";
export { releases } from "../api/entities/releases.ts";
export { KanbanColumnConfig } from "../api/schemas/KanbanColumnConfig.ts";
export type { AreaResource } from "../api/schemas/areaResourceSchema.ts";
export type { QuestCommentResource } from "../api/schemas/questCommentResourceSchema.ts";
export {
  MAX_QUEST_OBJECTIVES,
  exceedsObjectiveCap,
} from "../api/schemas/questObjectivesLimit.ts";
export { QUEST_RELEASE_NONE } from "../api/schemas/questReleaseFilter.ts";
export type { QuestResource } from "../api/schemas/questResourceSchema.ts";
export { supportCapabilityOptionsSchema } from "../api/schemas/supportCapabilityOptionsSchema.ts";
export { workCapabilityOptionsSchema } from "../api/schemas/workCapabilityOptionsSchema.ts";

// Browser-loadable although it sits in `api/services`: the dashboard's
// declarative half, read by the catalogue on both sides.
export { WorkDashboardMetrics } from "../api/services/WorkDashboardMetrics.ts";

// Pure, and read by the browser and the e2e suite alike.
export { compareReleaseTags } from "../api/releaseOrder.ts";
