import { $inject } from "alepha";
import { $job } from "alepha/api/jobs";

import { AutomationRunEvidence } from "../services/AutomationRunEvidence.ts";

export class AutomationEvidenceJobs {
  protected readonly evidence = $inject(AutomationRunEvidence);
  public readonly prune = $job({
    name: "automations.prune-run-detail",
    description:
      "Prunes at most 100 terminal automation runs older than 30 days, preserving live work and durable receipts.",
    cron: "0 0 * * *",
    handler: async () => {
      await this.evidence.prune();
    },
  });
}
