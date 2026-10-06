import { LoreCoreApi } from "@lore/core/api";
import { $module } from "alepha";

import { AreaController } from "./controllers/AreaController.ts";
import { EpicController } from "./controllers/EpicController.ts";
import { FeedbackCommentController } from "./controllers/FeedbackCommentController.ts";
import { FeedbackController } from "./controllers/FeedbackController.ts";
import { KanbanController } from "./controllers/KanbanController.ts";
import { ProjectQuestPortabilityController } from "./controllers/ProjectQuestPortabilityController.ts";
import { ProjectReportsController } from "./controllers/ProjectReportsController.ts";
import { QuestAuthorshipController } from "./controllers/QuestAuthorshipController.ts";
import { QuestCommentController } from "./controllers/QuestCommentController.ts";
import { QuestController } from "./controllers/QuestController.ts";
import { ReleaseController } from "./controllers/ReleaseController.ts";
import { RoadmapController } from "./controllers/RoadmapController.ts";
import { QuestMemberRemoval } from "./hooks/QuestMemberRemoval.ts";
import { EpicJobs } from "./jobs/EpicJobs.ts";
import { QuestJobs } from "./jobs/QuestJobs.ts";
import { QuestNotifications } from "./notifications/QuestNotifications.ts";
import { EpicResourceKind } from "./resources/EpicResourceKind.ts";
import { FeedbackResourceKind } from "./resources/FeedbackResourceKind.ts";
import { QuestResourceKind } from "./resources/QuestResourceKind.ts";
import { ReleaseResourceKind } from "./resources/ReleaseResourceKind.ts";
import { ActiveQuestsMetric } from "./services/ActiveQuestsMetric.ts";
import { AreaService } from "./services/AreaService.ts";
import { EpicDependencyService } from "./services/EpicDependencyService.ts";
import { EpicProgressMetric } from "./services/EpicProgressMetric.ts";
import { EpicProgressService } from "./services/EpicProgressService.ts";
import { EpicWorkflowService } from "./services/EpicWorkflowService.ts";
import { FeedbackRateLimiter } from "./services/FeedbackRateLimiter.ts";
import { HeldQuestsMetric } from "./services/HeldQuestsMetric.ts";
import { MentionNotifier } from "./services/MentionNotifier.ts";
import { OpenQuestScope } from "./services/OpenQuestScope.ts";
import { QuestCsvFormatter } from "./services/QuestCsvFormatter.ts";
import { QuestProjectDeletion } from "./services/QuestProjectDeletion.ts";
import { QuestService } from "./services/QuestService.ts";
import { QuestTagTallyService } from "./services/QuestTagTallyService.ts";
import { ReleaseAttachmentService } from "./services/ReleaseAttachmentService.ts";
import { ReleaseContentService } from "./services/ReleaseContentService.ts";
import { ReleaseNotifier } from "./services/ReleaseNotifier.ts";
import { ReleaseProgressMetric } from "./services/ReleaseProgressMetric.ts";
import { RoadmapService } from "./services/RoadmapService.ts";
import { TagCompletionMetric } from "./services/TagCompletionMetric.ts";
import { UntriagedFeedbackMetric } from "./services/UntriagedFeedbackMetric.ts";
import { WorkAssignedWork } from "./services/WorkAssignedWork.ts";
import { WorkDashboard } from "./services/WorkDashboard.ts";
import { WorkDashboardMetrics } from "./services/WorkDashboardMetrics.ts";
import { WorkFileAccess } from "./services/WorkFileAccess.ts";
import { WorkProjectCounts } from "./services/WorkProjectCounts.ts";

/**
 * The server half of `@lore/work`, Lore as Jira: quests, epics, releases, areas, the kanban, the roadmap and feedback.
 *
 * It depends on `@lore/core` only: a feature that spans two modules goes through a core registry or a core link, never through an import of another feature module (`check:conventions`).
 *
 * Registered by `apps/lore/src/main.server.ts`, after every entry-level
 * substitution.
 *
 * @module
 */
export const LoreWorkApi = $module({
  name: "lore.work.api",
  // Core first: booting this module alone boots what it depends on.
  imports: [LoreCoreApi],
  services: [
    // The dashboard metrics' declarative half, which the resolvers and the
    // scope proof read on the server (the browser gets it from
    // `LoreWorkWeb`).
    WorkDashboardMetrics,
    ReleaseAttachmentService,
    ReleaseContentService,
    RoadmapService,
    EpicDependencyService,
    // The epic rollup, on a service rather than on the controller now that
    // five surfaces read it: the Epics list, `epic_list`, `project_context`,
    // MCP output and the dashboard's epic card.
    EpicProgressService,
    // The one place the epic workflow's refusals are written (epic #31):
    // which quest action is allowed in which epic phase, and the words a
    // refusal carries. Injected by the quest and epic controllers.
    EpicWorkflowService,
    // The resource kinds each module registers on the core
    // `ResourceRegistry` (#E75, #Q2610), and Deploy's subscription to a
    // quest's deletion. Listed, because nothing injects them: a kind exists
    // only once its class is constructed.
    QuestResourceKind,
    EpicResourceKind,
    ReleaseResourceKind,
    FeedbackResourceKind,
    // Per-project counts each module registers on the core
    // `ProjectCountRegistry` (#Q2623); listed because nothing injects them.
    WorkProjectCounts,
    WorkAssignedWork,
    // Each module's part of the dashboard: scopes, default cards, and the
    // metric resolvers, which register themselves (#Q2623).
    WorkDashboard,
    // Who may read each module's attachment bucket (#Q2623).
    WorkFileAccess,
    // Work's parts of a member leaving and a project going (#Q2623).
    QuestMemberRemoval,
    QuestProjectDeletion,
    QuestAuthorshipController,
    QuestJobs,
    EpicJobs,
    QuestNotifications,
    // Turns `@name` in a comment into a message. Injected by the quest and
    // feedback comment controllers.
    MentionNotifier,
    // The release fan-out. Publish only; reopen notifies nobody.
    ReleaseNotifier,
    FeedbackRateLimiter,
    QuestCsvFormatter,
    QuestService,
    AreaService,
    // What "open quests" means, shared by the sidebar badge, the dashboard
    // rail and the Active Quests tile — all three are visible together.
    OpenQuestScope,
    // One resolver per metric, plus the registry that groups a card list by
    // metric so N cards on one metric stay one query.
    ActiveQuestsMetric,
    HeldQuestsMetric,
    EpicProgressMetric,
    ReleaseProgressMetric,
    TagCompletionMetric,
    // The per-tag fold, shared by Reports > Quests and the tag card. No
    // `GROUP BY` reaches inside a JSON array in a text column, so there is
    // one in-memory tally and it lives here.
    QuestTagTallyService,
    UntriagedFeedbackMetric,
    // Controllers
    QuestController,
    QuestCommentController,
    FeedbackCommentController,
    ReleaseController,
    RoadmapController,
    EpicController,
    AreaController,
    ProjectReportsController,
    ProjectQuestPortabilityController,
    KanbanController,
    FeedbackController,
  ],
});

// ---- re-exports, generated by the extraction (#E75) ----

export { AreaController } from "./controllers/AreaController.ts";
export { EpicController } from "./controllers/EpicController.ts";
export { FeedbackCommentController } from "./controllers/FeedbackCommentController.ts";
export { FeedbackController } from "./controllers/FeedbackController.ts";
export { KanbanController } from "./controllers/KanbanController.ts";
export { ProjectQuestPortabilityController } from "./controllers/ProjectQuestPortabilityController.ts";
export { ProjectReportsController } from "./controllers/ProjectReportsController.ts";
export { QuestAuthorshipController } from "./controllers/QuestAuthorshipController.ts";
export { QuestCommentController } from "./controllers/QuestCommentController.ts";
export { QuestController } from "./controllers/QuestController.ts";
export { ReleaseController } from "./controllers/ReleaseController.ts";
export { RoadmapController } from "./controllers/RoadmapController.ts";
export { QuestMemberRemoval } from "./hooks/QuestMemberRemoval.ts";
export { EpicJobs } from "./jobs/EpicJobs.ts";
export { QuestJobs } from "./jobs/QuestJobs.ts";
export { QuestNotifications } from "./notifications/QuestNotifications.ts";
export { workRelations } from "./relations/workRelations.ts";
export { EpicResourceKind } from "./resources/EpicResourceKind.ts";
export { FeedbackResourceKind } from "./resources/FeedbackResourceKind.ts";
export { QuestResourceKind } from "./resources/QuestResourceKind.ts";
export { ReleaseResourceKind } from "./resources/ReleaseResourceKind.ts";
export { ActiveQuestsMetric } from "./services/ActiveQuestsMetric.ts";
export { AreaService, type AreaStats } from "./services/AreaService.ts";
export { BoardRank } from "./services/BoardRank.ts";
export { DefaultReleaseService } from "./services/DefaultReleaseService.ts";
export { EpicDependencyService } from "./services/EpicDependencyService.ts";
export { EpicProgressMetric } from "./services/EpicProgressMetric.ts";
export {
  type EpicProgress,
  EpicProgressService,
} from "./services/EpicProgressService.ts";
export { EpicVisibilityService } from "./services/EpicVisibilityService.ts";
export {
  type EpicPlanEdit,
  EpicWorkflowService,
  type EpicWorkflowVerb,
} from "./services/EpicWorkflowService.ts";
export {
  FeedbackNotifier,
  type FeedbackNotifierSubject,
} from "./services/FeedbackNotifier.ts";
export { FeedbackRateLimiter } from "./services/FeedbackRateLimiter.ts";
export { HeldQuestsMetric } from "./services/HeldQuestsMetric.ts";
export {
  MentionNotifier,
  type MentionSubject,
} from "./services/MentionNotifier.ts";
export { OpenQuestScope } from "./services/OpenQuestScope.ts";
export {
  type ExportRow,
  QuestCsvFormatter,
} from "./services/QuestCsvFormatter.ts";
export { QuestProjectDeletion } from "./services/QuestProjectDeletion.ts";
export { QuestResourceMapper } from "./services/QuestResourceMapper.ts";
export {
  type CreateQuestInput,
  QuestService,
} from "./services/QuestService.ts";
export { QuestTagTallyService } from "./services/QuestTagTallyService.ts";
export { ReleaseAttachmentService } from "./services/ReleaseAttachmentService.ts";
export { ReleaseCascadeService } from "./services/ReleaseCascadeService.ts";
export {
  ReleaseContentService,
  type ReleaseContents,
} from "./services/ReleaseContentService.ts";
export { ReleaseNotifier } from "./services/ReleaseNotifier.ts";
export { ReleaseProgressMetric } from "./services/ReleaseProgressMetric.ts";
export { RoadmapService } from "./services/RoadmapService.ts";
export { TagCompletionMetric } from "./services/TagCompletionMetric.ts";
export { UntriagedFeedbackMetric } from "./services/UntriagedFeedbackMetric.ts";
export { WorkAssignedWork } from "./services/WorkAssignedWork.ts";
export { WorkDashboard } from "./services/WorkDashboard.ts";
export { WorkFileAccess } from "./services/WorkFileAccess.ts";
export { WorkProjectCounts } from "./services/WorkProjectCounts.ts";
export {
  type FeedbackOptions,
  feedbackOptionsAtom,
} from "./atoms/feedbackOptionsAtom.ts";
