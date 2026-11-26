import { $inject } from "alepha";
import { $repository } from "alepha/orm";

import { monitorIncidents } from "../entities/monitorIncidents.ts";
import { projectErrors } from "../entities/projectErrors.ts";
import { ProjectErrorThread } from "./ProjectErrorThread.ts";
import type { UptimeTransition } from "./UptimeStateService.ts";

/**
 * One inbox item per monitor, with the incident table as its source of truth.
 *
 * Lore resolves it when the monitor recovers and reopens it on the next
 * outage, and each of the two leaves its line in the error's thread, with
 * no actor (#E185).
 *
 * ⚠️ **A forwarded error keeps its quest.** Only an `open` row is resolved by
 * a recovery, and only a `resolved` row is reopened by an outage: a row
 * carrying `quest:<id>` is a member's decision, and neither the outage nor
 * the recovery writes over it. Both used to, unconditionally, which erased
 * the quest of every forwarded outage. `RunErrorService` follows the same
 * rule.
 */
export class UptimeErrorService {
  protected readonly projectErrors = $repository(projectErrors);
  protected readonly incidents = $repository(monitorIncidents);
  protected readonly thread = $inject(ProjectErrorThread);

  public async handle(transition: UptimeTransition): Promise<void> {
    const { monitor, incident, kind } = transition;
    const fingerprint = `uptime:${monitor.projectId}:${monitor.id}`;
    const [existing] = await this.projectErrors.findMany({
      where: {
        projectId: { eq: monitor.projectId },
        fingerprint: { eq: fingerprint },
      },
      columns: ["id", "status"],
      limit: 1,
    });
    if (kind === "closed") {
      // A retention purge or manual deletion can remove the error mid-outage.
      // Recovery never recreates it, and the exact incident history survives.
      // A forwarded or already resolved row is left as it is.
      if (existing?.status !== "open") return;
      await this.projectErrors.updateById(existing.id, {
        status: "resolved",
        lastSeenAt: incident.endedAt ?? monitor.statusSince,
      });
      await this.thread.record(existing.id, "monitor_resolved");
      return;
    }
    const reopens = existing?.status === "resolved";
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
    await this.projectErrors.upsertMany(
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
          // Reopened only when it was resolved: `quest:<id>` stays.
          ...(reopens ? { status: "open" } : {}),
          count: Math.max(1, count),
        },
      },
    );
    if (existing && reopens) {
      await this.thread.record(existing.id, "monitor_reopened");
    }
  }
}
