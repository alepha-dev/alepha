import { $inject } from "alepha";
import { $job } from "alepha/api/jobs";

import { AutomationClaims } from "../services/AutomationClaims.ts";
import { AutomationEvents } from "../services/AutomationEvents.ts";
import { AutomationOrigin } from "../services/AutomationOrigin.ts";
import { AutomationRunEvidence } from "../services/AutomationRunEvidence.ts";

export class AutomationEvidenceJobs {
  protected readonly origin = $inject(AutomationOrigin);
  protected readonly claims = $inject(AutomationClaims);
  protected readonly events = $inject(AutomationEvents);
  protected readonly evidence = $inject(AutomationRunEvidence);
  public readonly prune = $job({
    name: "automations.prune-run-detail",
    description:
      "Prunes at most 100 terminal automation runs older than 30 days, preserving live work and durable receipts.",
    cron: "0 0 * * *",
    handler: async () => {
      await this.evidence.prune();
      await this.claims.expireReady();
      await this.claims.repairTerminals();
      await this.claims.pruneSnapshots();
      await this.claims.prune();
      await this.events.prune();
      await this.origin.prune();
    },
  });
}
