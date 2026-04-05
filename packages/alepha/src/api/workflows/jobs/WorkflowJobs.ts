import { $hook, $inject, t } from "alepha";
import { $job } from "alepha/api/jobs";
import { WorkflowProvider } from "../providers/WorkflowProvider.ts";

// -----------------------------------------------------------------------------------------------------------------

export class WorkflowJobs {
  protected readonly workflowProvider = $inject(WorkflowProvider);

  protected readonly dispatchStep = $job({
    schema: t.object({
      workflowId: t.uuid(),
      stepName: t.text(),
    }),
    retry: { retries: 2, backoff: [1, "second"] },
    timeout: [10, "minute"],
    concurrency: 10,
    handler: async ({ items }) => {
      for (const item of items) {
        await this.workflowProvider.processStep(
          item.payload.workflowId,
          item.payload.stepName,
        );
      }
    },
  });

  protected readonly timeoutSweep = $job({
    cron: "* * * * *",
    lock: true,
    handler: async () => {
      await this.workflowProvider.timeoutSweep();
    },
  });

  protected readonly purge = $job({
    cron: "0 3 * * *",
    lock: true,
    handler: async () => {
      await this.workflowProvider.purge();
    },
  });

  protected readonly recoverySweep = $job({
    cron: "*/5 * * * *",
    lock: true,
    handler: async () => {
      await this.workflowProvider.recoverySweep();
    },
  });

  protected readonly onStart = $hook({
    on: "start",
    handler: async () => {
      // Wire up queue dispatch
      this.workflowProvider.stepDispatch = async (
        workflowId,
        stepName,
        priority,
      ) => {
        const priorityMap: Record<
          number,
          "critical" | "high" | "normal" | "low"
        > = {
          0: "critical",
          1: "high",
          2: "normal",
          3: "low",
        };
        await this.dispatchStep.push(
          { workflowId, stepName },
          { priority: priorityMap[priority] ?? "normal" },
        );
      };
    },
  });
}
