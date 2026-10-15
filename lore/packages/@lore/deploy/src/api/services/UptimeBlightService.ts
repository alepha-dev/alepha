import { $repository } from "alepha/orm";

import { blights } from "../entities/blights.ts";
import { monitorIncidents } from "../entities/monitorIncidents.ts";
import type { UptimeTransition } from "./UptimeStateService.ts";

/**
 * One inbox item per monitor, with the incident table as its source of truth.
 */
export class UptimeBlightService {
  protected readonly blights = $repository(blights);
  protected readonly incidents = $repository(monitorIncidents);

  public async handle(transition: UptimeTransition): Promise<void> {
    const { monitor, incident, kind } = transition;
    const fingerprint = `uptime:${monitor.projectId}:${monitor.id}`;
    if (kind === "closed") {
      // A retention purge or manual deletion can remove the blight mid-outage.
      // Recovery never recreates it, and the exact incident history survives.
      await this.blights.updateMany(
        { projectId: monitor.projectId, fingerprint },
        {
          status: "resolved",
          lastSeenAt: incident.endedAt ?? monitor.statusSince,
        },
      );
      return;
    }
    const target = monitor.target || "Push receipt";
    const message =
      `${monitor.name}: ${incident.cause}${incident.lastError ? `: ${incident.lastError}` : ""}`.slice(
        0,
        2000,
      );
    const stack = [
      `Monitor: ${monitor.name} (${monitor.id})`,
      `Target: ${target}`,
      `Failure: ${incident.cause}`,
      `Error: ${incident.lastError ?? "No additional error"}`,
      `Incident started: ${incident.startedAt}`,
    ]
      .join("\n")
      .slice(0, 4096);
    // Counting source incidents makes a repeated delivery idempotent.
    const count = await this.incidents.count({ monitorId: monitor.id });
    await this.blights.upsertMany(
      [
        {
          projectId: monitor.projectId,
          fingerprint,
          name: "UptimeOutage",
          message,
          stack,
          sourceUrl: monitor.target.slice(0, 2000),
          origin: "server",
          firstSeenAt: incident.startedAt,
          lastSeenAt: incident.startedAt,
          status: "open",
          count: Math.max(1, count),
        },
      ],
      {
        target: ["projectId", "fingerprint"],
        set: {
          message,
          stack,
          sourceUrl: monitor.target.slice(0, 2000),
          lastSeenAt: incident.startedAt,
          status: "open",
          count: Math.max(1, count),
        },
      },
    );
  }
}
