import { LoreAudits } from "@lore/core/api";
import { $inject } from "alepha";

import type { UptimeTransition } from "./UptimeStateService.ts";

/**
 * Writes an uptime transition to the project's Activity feed (#Q3596).
 *
 * Fed by `UptimeJobs.transition`, beside the blight and the alert, so it sees
 * exactly the transitions `UptimeStateService.apply` confirmed: a failed probe
 * under the monitor's confirmation threshold never reaches it. The row is the
 * `monitor` audit type, `down` with the failure and `up` with how long the
 * outage lasted, and names no actor: nobody did it.
 */
export class UptimeActivityService {
  protected readonly audits = $inject(LoreAudits);

  public async handle(transition: UptimeTransition): Promise<void> {
    const { monitor, incident, kind } = transition;
    const base = {
      ...this.audits.scope(monitor.projectId),
      resourceType: "monitor",
      resourceId: monitor.id,
      description: monitor.name,
    };
    if (kind === "opened") {
      await this.audits.monitor.logSuccess("down", {
        ...base,
        metadata: {
          cause: incident.cause,
          ...(incident.lastError ? { error: incident.lastError } : {}),
          since: incident.startedAt,
        },
      });
      return;
    }
    const endedAt = incident.endedAt ?? monitor.statusSince;
    await this.audits.monitor.logSuccess("up", {
      ...base,
      metadata: {
        downSecs: Math.max(
          0,
          Math.round(
            (Date.parse(endedAt) - Date.parse(incident.startedAt)) / 1000,
          ),
        ),
        since: incident.startedAt,
        recoveredAt: endedAt,
      },
    });
  }
}
