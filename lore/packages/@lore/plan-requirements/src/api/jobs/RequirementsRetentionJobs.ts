import { $inject } from "alepha";
import { $job } from "alepha/api/jobs";

import { PersonaInsightService } from "../services/PersonaInsightService.ts";

/**
 * Run evidence retention (#E153, owner answer 76): once a day, the evidence
 * files outside the current release and the three before it, and those of
 * a run that is not its use case's latest in its release, are deleted. The
 * runs stay. Without it the bucket grows with every release.
 */
export class RequirementsRetentionJobs {
  protected readonly insights = $inject(PersonaInsightService);

  public readonly pruneEvidence = $job({
    name: "requirements.prune-evidence",
    description:
      "Deletes use case run evidence outside the last four releases, keeping the runs.",
    cron: "0 3 * * *",
    lock: true,
    timeout: [5, "minutes"],
    handler: async () => {
      await this.insights.pruneEvidence();
    },
  });
}
