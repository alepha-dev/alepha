import { $hook, $inject, z } from "alepha";
import { $job, type JobPriority } from "alepha/api/jobs";
import { WorkflowProvider } from "../providers/WorkflowProvider.ts";

// -----------------------------------------------------------------------------------------------------------------

/**
 * Background plumbing for the workflow engine:
 *
 * - `dispatchStep` — queue-mode `$job` carrying (workflowId, stepName).
 *   Every step dispatch goes through it, so steps inherit the job
 *   system's durability (outbox row, sweep re-dispatch, priority).
 * - three crons: workflow deadline sweep, crashed-step recovery sweep,
 *   and the retention purge.
 */
export class WorkflowJobs {
  protected readonly workflowProvider = $inject(WorkflowProvider);

  protected readonly priorityReverse: Record<number, JobPriority> = {
    0: "critical",
    1: "high",
    2: "normal",
    3: "low",
  };

  protected readonly dispatchStep = $job({
    name: "api:workflows:dispatchStep",
    description: "Executes one workflow step.",
    schema: z.object({
      workflowId: z.uuid(),
      stepName: z.text(),
    }),
    retry: { retries: 2 },
    timeout: [10, "minute"],
    record: "error",
    handler: async ({ payload }) => {
      await this.workflowProvider.processStep(
        payload.workflowId,
        payload.stepName,
      );
    },
  });

  protected readonly timeoutSweep = $job({
    name: "api:workflows:timeoutSweep",
    description: "Times out workflow executions past their deadline.",
    cron: "* * * * *",
    lock: true,
    record: "error",
    handler: async () => {
      await this.workflowProvider.timeoutSweep();
    },
  });

  protected readonly recoverySweep = $job({
    name: "api:workflows:recoverySweep",
    description: "Recovers workflow steps whose process crashed.",
    cron: "*/5 * * * *",
    lock: true,
    record: "error",
    handler: async () => {
      await this.workflowProvider.recoverySweep();
    },
  });

  protected readonly purge = $job({
    name: "api:workflows:purge",
    description: "Deletes terminal workflow executions past retention.",
    cron: "0 3 * * *",
    lock: true,
    handler: async () => {
      await this.workflowProvider.purge();
    },
  });

  protected readonly onStart = $hook({
    on: "start",
    handler: async () => {
      this.workflowProvider.stepDispatch = async (
        workflowId,
        stepName,
        priority,
        delayMs,
      ) => {
        await this.dispatchStep.push(
          { workflowId, stepName },
          {
            priority: this.priorityReverse[priority] ?? "normal",
            delay: delayMs ? [delayMs, "millisecond"] : undefined,
          },
        );
      };
    },
  });
}
