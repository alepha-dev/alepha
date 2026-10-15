import { $inject, z } from "alepha";
import { $job } from "alepha/api/jobs";

import { AutomationClaims } from "../services/AutomationClaims.ts";
import { AutomationWorker } from "../services/AutomationWorker.ts";

export class AutomationWorkerJobs {
  protected readonly claims = $inject(AutomationClaims);
  protected readonly worker = $inject(AutomationWorker);
  constructor() {
    this.claims.registerRecovery(async (receipt) => {
      await this.work.push(
        {
          receiptId: receipt.id,
          ...(receipt.leaseToken ? { token: receipt.leaseToken } : {}),
        },
        {
          key: `automation:${receipt.id}:${receipt.leaseToken ?? receipt.queueAttempts}`,
        },
      );
    });
  }
  public readonly work = $job({
    name: "automations.work",
    description:
      "Evaluates or executes at most five ordered automation steps from a durable occurrence.",
    schema: z
      .object({ receiptId: z.string().max(255), token: z.uuid().optional() })
      .strict(),
    timeout: [90, "seconds"],
    retry: { retries: 2 },
    handler: async ({ payload, attempt, reschedule }) => {
      const next = await this.worker.step(payload, attempt);
      if (next) reschedule({ delay: [1, "second"], payload: next });
    },
  });
}
