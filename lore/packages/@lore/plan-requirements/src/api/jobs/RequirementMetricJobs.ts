import { $inject } from "alepha";
import { $job } from "alepha/api/jobs";

import { RequirementMetricService } from "../services/RequirementMetricService.ts";

/**
 * Metric requirements (#E153, #Q3773): every one is evaluated once an hour
 * and its result stored, so a list, a matrix or a dashboard card reads
 * columns and never sends one analytics query per requirement.
 *
 * ⚠️ On `0 * * * *`, the expression Lore's hourly jobs already share, so it
 * adds no Cloudflare cron trigger (#F1325).
 */
export class RequirementMetricJobs {
  protected readonly metrics = $inject(RequirementMetricService);

  public readonly evaluate = $job({
    name: "requirements.evaluate-metrics",
    description: "Evaluates every metric requirement from Ship's telemetry.",
    cron: "0 * * * *",
    lock: true,
    timeout: [10, "minutes"],
    handler: async () => {
      await this.metrics.evaluateAll();
    },
  });
}
