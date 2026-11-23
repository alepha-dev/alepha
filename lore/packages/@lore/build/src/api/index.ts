import { LoreCoreApi } from "@lore/core/api";
import { $module } from "alepha";

import { ArtifactsGitBackend } from "./backends/ArtifactsGitBackend.ts";
import { GitBackend } from "./backends/GitBackend.ts";
import { LocalGitBackend } from "./backends/LocalGitBackend.ts";
import { CodeBrowserController } from "./controllers/CodeBrowserController.ts";
import { CodeRepositoryController } from "./controllers/CodeRepositoryController.ts";
import { GitHttpController } from "./controllers/GitHttpController.ts";
import { QualityController } from "./controllers/QualityController.ts";
import { QualityReportsController } from "./controllers/QualityReportsController.ts";
import { CodeBackupJobs } from "./jobs/CodeBackupJobs.ts";
import { CodeBlameJobs } from "./jobs/CodeBlameJobs.ts";
import { CodeIndexJobs } from "./jobs/CodeIndexJobs.ts";
import { QualityJobs } from "./jobs/QualityJobs.ts";
import { AgentJobService } from "./services/AgentJobService.ts";
import { BuildDashboardMetrics } from "./services/BuildDashboardMetrics.ts";
import { BuildProjectDeletion } from "./services/BuildProjectDeletion.ts";
import { BuildProjectEvents } from "./services/BuildProjectEvents.ts";
import { BuildProjectMerge } from "./services/BuildProjectMerge.ts";
import { BuildReportsSummary } from "./services/BuildReportsSummary.ts";
import { CodeAuthors } from "./services/CodeAuthors.ts";
import { CodeBlameService } from "./services/CodeBlameService.ts";
import { CodeBrowserService } from "./services/CodeBrowserService.ts";
import { CodeCommitIndex } from "./services/CodeCommitIndex.ts";
import { CodeCompareService } from "./services/CodeCompareService.ts";
import { CodeDiffService } from "./services/CodeDiffService.ts";
import { CodePushRecorder } from "./services/CodePushRecorder.ts";
import { CodeReadAccess } from "./services/CodeReadAccess.ts";
import { CodeRepositoryService } from "./services/CodeRepositoryService.ts";
import { CoverageThreshold } from "./services/CoverageThreshold.ts";
import { GitAccessService } from "./services/GitAccessService.ts";
import { GitBrowserRedirect } from "./services/GitBrowserRedirect.ts";
import { GitReceivePack } from "./services/GitReceivePack.ts";
import { GitTreeDiff } from "./services/GitTreeDiff.ts";
import { ProjectQualityReportService } from "./services/ProjectQualityReportService.ts";
import { QualityNumericCatalog } from "./services/QualityNumericCatalog.ts";
import { QualityNumericMetrics } from "./services/QualityNumericMetrics.ts";
import { QualityService } from "./services/QualityService.ts";
import { QualityTrendMetric } from "./services/QualityTrendMetric.ts";

/**
 * The server half of `@lore/build`, Lore's fourth pillar: the code a project
 * holds, its git repositories, and Quality, which measures that code (moved
 * from `@lore/ship`, #E162).
 *
 * It depends on `@lore/core` only: a feature that spans two modules goes
 * through a core registry or a core link, never through an import of another
 * feature module (`check:conventions`).
 *
 * Registered by `apps/lore/src/main.server.ts`, after every entry-level
 * substitution, between Remember and Ship.
 *
 * @module
 */
export const LoreBuildApi = $module({
  name: "lore.build.api",
  // Core first: booting this module alone boots what it depends on.
  imports: [LoreCoreApi],
  services: [
    // Build's project events in the core catalog; listed because nothing
    // injects them.
    BuildProjectEvents,
    // Registers its Reports Summary line and its project merge step;
    // nothing injects them.
    BuildReportsSummary,
    BuildProjectMerge,
    BuildProjectDeletion,
    // The tiles: the trend and the numbers, and their resolvers.
    BuildDashboardMetrics,
    QualityTrendMetric,
    QualityNumericCatalog,
    QualityNumericMetrics,
    QualityJobs,
    QualityService,
    CoverageThreshold,
    ProjectQualityReportService,
    QualityController,
    QualityReportsController,
    // Git repositories (#E162): the rows and their API. The backend is
    // chosen per runtime in `register`.
    CodeRepositoryService,
    CodeRepositoryController,
    // git smart HTTP on `.git` URLs (#Q3932).
    GitReceivePack,
    GitAccessService,
    // The commit index (#Q4132): written at push, backfilled by a job.
    GitTreeDiff,
    CodeCommitIndex,
    CodeIndexJobs,
    // The code browser's reads (#E167), behind one gate.
    CodeReadAccess,
    CodeAuthors,
    CodeCompareService,
    // Blame from the index, cached, finished by a job (#Q4138).
    CodeBlameService,
    CodeBlameJobs,
    CodeBrowserService,
    // One line diff, in JS, on both backends (#Q4135).
    CodeDiffService,
    CodeBrowserController,
    // A browser opening a `.git` URL lands on its page (#Q4133).
    GitBrowserRedirect,
    // A push's commits on the quests they name, and its activity row (#Q3945).
    CodePushRecorder,
    // Every repository as a bundle in the storage, nightly (#Q3946).
    CodeBackupJobs,
    GitHttpController,
    // The agent job (#Q3986): Claude Code on the project's Agent host, its
    // profiles, its chain guard and the reader of its result.
    AgentJobService,
  ],
  register: (alepha) => {
    // Artifacts on the Worker, bare repositories on disk everywhere else
    // (Docker, `alepha dev`, the specs). Optional, so a spec substitutes
    // its own first.
    alepha.with({
      optional: true,
      provide: GitBackend,
      use: alepha.isServerless() ? ArtifactsGitBackend : LocalGitBackend,
    });
  },
});

export { ArtifactsGitBackend } from "./backends/ArtifactsGitBackend.ts";
export type {
  ArtifactsBinding,
  ArtifactsCommit,
  ArtifactsRepoHandle,
  ArtifactsTreeEntry,
} from "./backends/ArtifactsGitBackend.ts";
export { GitBackend } from "./backends/GitBackend.ts";
export { AgentJobService } from "./services/AgentJobService.ts";
export {
  AGENT_JOB_PROFILES,
  type AgentJobProfile,
} from "./schemas/agentJobProfiles.ts";
export type {
  GitBackendToken,
  GitBlobResult,
  GitCommitDetail,
  GitPerson,
  GitReadOptions,
  GitRefTip,
  GitTreeEntry,
  GitWalkCommit,
  GitRepositoryInfo,
  GitRpcRequest,
  GitRpcResponse,
  GitService,
  GitTokenScope,
} from "./backends/GitBackend.ts";
export { LocalGitBackend } from "./backends/LocalGitBackend.ts";
export { CodeRepositoryController } from "./controllers/CodeRepositoryController.ts";
export { CodeBrowserController } from "./controllers/CodeBrowserController.ts";
export { CodeBrowserService } from "./services/CodeBrowserService.ts";
export { CodeDiffService } from "./services/CodeDiffService.ts";
export {
  type CodeComparison,
  CodeCompareService,
} from "./services/CodeCompareService.ts";
export { LineDiff, type LineDiffOp } from "./services/LineDiff.ts";
export { CodeReadAccess } from "./services/CodeReadAccess.ts";
export { GitBrowserRedirect } from "./services/GitBrowserRedirect.ts";
export { GitHttpController } from "./controllers/GitHttpController.ts";
export { QualityController } from "./controllers/QualityController.ts";
export { QualityReportsController } from "./controllers/QualityReportsController.ts";
export { QualityJobs } from "./jobs/QualityJobs.ts";
export { CodeRepositoryService } from "./services/CodeRepositoryService.ts";
export { GitAccessService } from "./services/GitAccessService.ts";
export { GitReceivePack } from "./services/GitReceivePack.ts";
export { CodePushRecorder } from "./services/CodePushRecorder.ts";
export { CodeBackupJobs } from "./jobs/CodeBackupJobs.ts";
export { CodeIndexJobs } from "./jobs/CodeIndexJobs.ts";
export { CodeCommitIndex } from "./services/CodeCommitIndex.ts";
export {
  GitTreeDiff,
  type GitTreeChange,
  type GitTreeDiffResult,
} from "./services/GitTreeDiff.ts";
export { codeCommits, type CodeCommitRow } from "./entities/codeCommits.ts";
export { codeCommitPaths } from "./entities/codeCommitPaths.ts";
export { codeBlameCache } from "./entities/codeBlameCache.ts";
export { CodeBlameService } from "./services/CodeBlameService.ts";
export { CodeBlameJobs } from "./jobs/CodeBlameJobs.ts";
export { codeCommitParents } from "./entities/codeCommitParents.ts";
export { CoverageThreshold } from "./services/CoverageThreshold.ts";
export { QualityService } from "./services/QualityService.ts";
