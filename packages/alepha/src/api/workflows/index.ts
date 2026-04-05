import { $module, type Alepha } from "alepha";
import { AlephaApiJobs } from "alepha/api/jobs";
import { AlephaLock } from "alepha/lock";
import { AdminWorkflowController } from "./controllers/AdminWorkflowController.ts";
import { WorkflowJobs } from "./jobs/WorkflowJobs.ts";
import { $workflow } from "./primitives/$workflow.ts";
import { WorkflowProvider } from "./providers/WorkflowProvider.ts";
import { WorkflowService } from "./services/WorkflowService.ts";

// -----------------------------------------------------------------------------------------------------------------

export * from "./controllers/AdminWorkflowController.ts";
export * from "./entities/workflowExecutions.ts";
export * from "./entities/workflowStepExecutions.ts";
export * from "./entities/workflowStepLogs.ts";
export * from "./primitives/$workflow.ts";
export * from "./providers/WorkflowProvider.ts";
export * from "./schemas/workflowActivitySchema.ts";
export * from "./schemas/workflowConfigAtom.ts";
export * from "./schemas/workflowExecutionDetailSchema.ts";
export * from "./schemas/workflowExecutionQuerySchema.ts";
export * from "./schemas/workflowExecutionResourceSchema.ts";
export * from "./schemas/workflowRegistrationSchema.ts";
export * from "./schemas/workflowStatsSchema.ts";
export * from "./schemas/workflowStepExecutionResourceSchema.ts";
export * from "./services/WorkflowService.ts";

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
    "workflow:signal:received": {
      workflowName: string;
      workflowId: string;
      stepName: string;
      payload: unknown;
    };
    "workflow:signal:timeout": {
      workflowName: string;
      workflowId: string;
      stepName: string;
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
 * - Per-step retry with exponential backoff
 * - Workflow-level timeout and cancellation
 * - Deduplication via unique keys
 * - Per-execution log capture
 *
 * @module alepha.api.workflows
 */
export const AlephaApiWorkflows = $module({
  name: "alepha.api.workflows",
  primitives: [$workflow],
  services: [
    AlephaApiJobs,
    AlephaLock,
    WorkflowProvider,
    WorkflowService,
    WorkflowJobs,
    AdminWorkflowController,
  ],
  register: (alepha: Alepha) => {
    alepha.with(AlephaApiJobs);
    alepha.with(AlephaLock);
    alepha.with(WorkflowProvider);
    alepha.with(WorkflowService);
    alepha.with(WorkflowJobs);
    alepha.with(AdminWorkflowController);
  },
});
