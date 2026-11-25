import { LoreCoreApi } from "@lore/core/api";
import { $module } from "alepha";

import { AgentHostController } from "./controllers/AgentHostController.ts";
import { PromptController } from "./controllers/PromptController.ts";
import { AgentHostJobs } from "./jobs/AgentHostJobs.ts";
import { AgentHostService } from "./services/AgentHostService.ts";
import { AgentJobProjectEvents } from "./services/AgentJobProjectEvents.ts";
import { AgentJobService } from "./services/AgentJobService.ts";
import { AgentRunPreamble } from "./services/AgentRunPreamble.ts";
import { PromptMerge } from "./services/PromptMerge.ts";
import { PromptReplyMail } from "./services/PromptReplyMail.ts";
import { PromptRunService } from "./services/PromptRunService.ts";
import { PromptsDashboardMetrics } from "./services/PromptsDashboardMetrics.ts";
import { PromptService } from "./services/PromptService.ts";
import { PromptTriggers } from "./services/PromptTriggers.ts";
import { RunningJobsMetric } from "./services/RunningJobsMetric.ts";

/**
 * The server half of `@lore/prompts` (#E175): the prompt engine, its
 * triggers, the start of agent jobs and the agent hosts they run on.
 *
 * It depends on `@lore/core` only, and nothing imports it: Plan, Ship and
 * Requirements contribute prompts through core's contract
 * (`PromptRegistry`, `AgentJobs`), which this package fills. The jobs
 * themselves (`host_jobs`, `HostJobs`) stay core's.
 *
 * Registered by `apps/lore/src/main.server.ts`, after every entry-level
 * substitution.
 *
 * @module
 */
export const LorePromptsApi = $module({
  name: "lore.prompts.api",
  imports: [LoreCoreApi],
  services: [
    // The agent role (#Q3985): hosts that run agent jobs, their daily
    // check. Registers the Agent host directory and role on `HostJobs`.
    AgentHostService,
    AgentHostController,
    AgentHostJobs,
    // Untrusted input in an agent's prompt (#Q3987), and the run's preamble.
    AgentRunPreamble,
    // The runner of core's `AgentJobs` port: registers itself on it.
    AgentJobService,
    // Prompts (#E174): the project's own, rendered and run.
    PromptService,
    PromptRunService,
    PromptController,
    // A job that ends tells its subscribers (#Q4276).
    AgentJobProjectEvents,
    // A prompt's triggers (#Q4277): events, schedule, check, ceilings.
    PromptTriggers,
    // A member arg emails the run's reply (#Q4278).
    PromptReplyMail,
    // Prompts move with a merged project (#Q4274); nothing injects it.
    PromptMerge,
    // The Running jobs dashboard card (#Q4342): its catalogue entry, its rows.
    PromptsDashboardMetrics,
    RunningJobsMetric,
  ],
});

export { AgentHostController } from "./controllers/AgentHostController.ts";
export { PromptController } from "./controllers/PromptController.ts";
export { type Prompt, prompts } from "./entities/prompts.ts";
export { AgentHostJobs } from "./jobs/AgentHostJobs.ts";
export { AgentHostService } from "./services/AgentHostService.ts";
export { AgentJobProjectEvents } from "./services/AgentJobProjectEvents.ts";
export { AgentJobService } from "./services/AgentJobService.ts";
export { AgentRunPreamble } from "./services/AgentRunPreamble.ts";
export { PromptMerge } from "./services/PromptMerge.ts";
export { PromptReplyMail } from "./services/PromptReplyMail.ts";
export {
  type PromptRunBody,
  PromptRunService,
} from "./services/PromptRunService.ts";
export { PromptsDashboardMetrics } from "./services/PromptsDashboardMetrics.ts";
export { PromptService } from "./services/PromptService.ts";
export { PromptTriggers } from "./services/PromptTriggers.ts";
export { RunningJobsMetric } from "./services/RunningJobsMetric.ts";
