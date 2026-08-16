import { $module } from "alepha";
import { AlephaApiJobs } from "alepha/api/jobs";
import { AlephaLock } from "alepha/lock";
import { AdminWorkflowController } from "./controllers/AdminWorkflowController.ts";
import { WorkflowJobs } from "./jobs/WorkflowJobs.ts";
import { $workflow } from "./primitives/$workflow.ts";
import { WorkflowProvider } from "./providers/WorkflowProvider.ts";
import { workflowConfig } from "./schemas/workflowConfigAtom.ts";
import { WorkflowService } from "./services/WorkflowService.ts";
import { WorkflowTestKit } from "./services/WorkflowTestKit.ts";

// -----------------------------------------------------------------------------------------------------------------

export * from "./controllers/AdminWorkflowController.ts";
export * from "./entities/workflowExecutions.ts";
export * from "./entities/workflowStepExecutions.ts";
export * from "./entities/workflowStepLogs.ts";
export * from "./jobs/WorkflowJobs.ts";
export * from "./primitives/$workflow.ts";
export * from "./providers/WorkflowProvider.ts";
export * from "./schemas/workflowActivityQuerySchema.ts";
export * from "./schemas/workflowActivitySchema.ts";
export * from "./schemas/workflowConfigAtom.ts";
export * from "./schemas/workflowExecutionDetailSchema.ts";
export * from "./schemas/workflowExecutionQuerySchema.ts";
export * from "./schemas/workflowExecutionResourceSchema.ts";
export * from "./schemas/workflowRegistrationSchema.ts";
export * from "./schemas/workflowStatsSchema.ts";
export * from "./schemas/workflowStepExecutionResourceSchema.ts";
export * from "./services/WorkflowService.ts";
export * from "./services/WorkflowTestKit.ts";

// -----------------------------------------------------------------------------------------------------------------

declare module "alepha" {
  interface Hooks {
    "workflow:started": { workflowName: string; workflowId: string };
    "workflow:step:begin": {
      workflowName: string;
      workflowId: string;
      stepName: string;
    };
    "workflow:step:completed": {
      workflowName: string;
      workflowId: string;
      stepName: string;
      result: unknown;
    };
    "workflow:step:failed": {
      workflowName: string;
      workflowId: string;
      stepName: string;
      error: Error;
    };
    "workflow:step:skipped": {
      workflowName: string;
      workflowId: string;
      stepName: string;
    };
    "workflow:step:repeat": {
      workflowName: string;
      workflowId: string;
      stepName: string;
      iteration: number;
    };
    "workflow:completed": { workflowName: string; workflowId: string };
    "workflow:failed": {
      workflowName: string;
      workflowId: string;
      error: Error;
      stepName: string;
    };
    "workflow:compensating": {
      workflowName: string;
      workflowId: string;
      stepName: string;
    };
    "workflow:compensated": { workflowName: string; workflowId: string };
    "workflow:compensation:failed": {
      workflowName: string;
      workflowId: string;
      stepName: string;
      error: Error;
    };
    "workflow:cancelled": { workflowName: string; workflowId: string };
    "workflow:timed_out": { workflowName: string; workflowId: string };
  }
}

// -----------------------------------------------------------------------------------------------------------------

/**
 * Durable workflow engine for long-running business processes.
 *
 * **Features:**
 * - Declarative, multi-step workflows with typed payloads
 * - Saga-pattern compensation for failure recovery
 * - Per-step retry with exponential backoff, delivered through the job
 *   outbox — a retry scheduled before a crash still fires after it
 * - Durable delayed steps (`delay` on a step) and delayed starts, for
 *   sequences like "send a reminder after 24h"
 * - Durable loops (`repeat` on a step): the handler resolves
 *   `{ repeat: true }` to run the same step again after a persisted wait,
 *   with `context.iteration` as the round counter — offer/claim cascades
 *   without self-chaining workflows
 * - Context propagation (`context: [someAtom]`): atom values captured at
 *   `start()` follow the execution to whatever process runs each step,
 *   `when()` guard, or compensation — the canonical use is tenancy
 * - Workflow-level timeout and cancellation, including `cancelByKey` for
 *   disarm-style listeners
 * - Deduplication via unique keys (race-safe: backed by a partial unique
 *   index) and `startEach` for re-drivable per-item fan-out
 * - Per-execution log capture
 *
 * Every wait is persisted (`scheduledAt` on the step row) before any
 * timer is armed: timers and queue deliveries only optimize latency,
 * the recovery sweep re-dispatches anything due from the DB alone.
 *
 * **Sharp edges, learned by dogfooding:**
 * - Dedup keys are kept on terminal rows — the partial unique index only
 *   spans live statuses, so a finished key can be re-used by a new run.
 *   Look executions up by key or payload; `WorkflowTestKit.findByPayload`
 *   works for unkeyed workflows too.
 * - Admin action names are app-global. Two controllers exporting an
 *   action named `getExecution` collide at boot, not at typecheck.
 * - Step, `when()` and compensation handlers should be idempotent: crash
 *   recovery replays the last unacknowledged unit of work.
 * - Testing with `travel()`: park before travel (wait for the next step
 *   to be pending WITH its `scheduledAt` stamp), and nudge the recovery
 *   sweep while polling afterwards — the post-travel clock is frozen, so
 *   no cron ever ticks again on its own. `WorkflowTestKit` packages both
 *   disciplines (`awaitParked`, `settle`, `awaitStatus`).
 *
 * @module alepha.api.workflows
 */
export const AlephaApiWorkflows = $module({
  name: "alepha.api.workflows",
  primitives: [$workflow],
  atoms: [workflowConfig],
  services: [
    WorkflowProvider,
    WorkflowService,
    WorkflowJobs,
    WorkflowTestKit,
    AdminWorkflowController,
  ],
  imports: [AlephaApiJobs, AlephaLock],
});
