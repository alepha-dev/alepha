import { $module } from "../core/descriptors/$module.ts";
import { WorkflowController } from "./controllers/WorkflowController.ts";
import { WorkflowEngineService } from "./services/WorkflowEngineService.ts";
import { WorkflowExecutionService } from "./services/WorkflowExecutionService.ts";
import { WorkflowRegistryService } from "./services/WorkflowRegistryService.ts";
import { WorkflowQueues } from "./queues/WorkflowQueues.ts";

// ---------------------------------------------------------------------------------------------------------------------
// Descriptors
// ---------------------------------------------------------------------------------------------------------------------

export { $workflow } from "./descriptors/$workflow.ts";
export type {
  Workflow,
  WorkflowOptions,
  WorkflowHandler,
  WorkflowContext,
  Duration,
  RetryPolicy,
} from "./descriptors/$workflow.ts";

export { $activity } from "./descriptors/$activity.ts";
export type {
  Activity,
  ActivityOptions,
  ActivityHandler,
  ActivityContext,
} from "./descriptors/$activity.ts";

// ---------------------------------------------------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------------------------------------------------

export { workflowExecutionEntity } from "./entities/WorkflowExecutionEntity.ts";
export { workflowEventEntity } from "./entities/WorkflowEventEntity.ts";
export { workflowSignalQueueEntity } from "./entities/WorkflowSignalQueueEntity.ts";
export { humanTaskEntity } from "./entities/HumanTaskEntity.ts";

// ---------------------------------------------------------------------------------------------------------------------
// Services
// ---------------------------------------------------------------------------------------------------------------------

export { WorkflowEngineService } from "./services/WorkflowEngineService.ts";
export { WorkflowExecutionService } from "./services/WorkflowExecutionService.ts";
export { WorkflowRegistryService } from "./services/WorkflowRegistryService.ts";
export type { WorkflowExecutionInfo } from "./services/WorkflowEngineService.ts";

// ---------------------------------------------------------------------------------------------------------------------
// Queues
// ---------------------------------------------------------------------------------------------------------------------

export { WorkflowQueues } from "./queues/WorkflowQueues.ts";

// ---------------------------------------------------------------------------------------------------------------------
// Controllers
// ---------------------------------------------------------------------------------------------------------------------

export { WorkflowController } from "./controllers/WorkflowController.ts";

// ---------------------------------------------------------------------------------------------------------------------
// Module
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Provides durable workflow orchestration for Alepha applications.
 *
 * This module includes:
 * - $workflow and $activity descriptors
 * - Workflow execution engine
 * - Signal-based event handling
 * - HTTP API for workflow management
 *
 * Features:
 * - Event-sourced execution for complete auditability
 * - Fault tolerance with automatic recovery
 * - Saga pattern for compensation and rollback
 * - Human-in-the-loop support
 * - Type-safe workflow and activity definitions
 *
 * @module alepha.api.workflows
 */
export const AlephaApiWorkflows = $module({
  name: "alepha.api.workflows",
  services: [
    WorkflowRegistryService,
    WorkflowEngineService,
    WorkflowExecutionService,
    WorkflowQueues,
    WorkflowController,
  ],
  descriptors: [],
});
