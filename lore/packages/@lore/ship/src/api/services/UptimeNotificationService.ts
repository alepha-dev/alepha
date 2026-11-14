import { projects } from "@lore/core/schemas";
import { $inject, Alepha } from "alepha";
import { organizationMembers } from "alepha/api/organizations";
import { users } from "alepha/api/users";
import { $repository } from "alepha/orm";

import { UptimeNotifications } from "../notifications/UptimeNotifications.ts";
import type { UptimeTransition } from "./UptimeStateService.ts";

/**
 * Incident transitions are the unit of alerting. A failed probe is not an alert.
 */
export class UptimeNotificationService {
  protected readonly alepha = $inject(Alepha);
  protected readonly projects = $repository(projects);
  protected readonly members = $repository(organizationMembers);
  protected readonly users = $repository(users);
  protected readonly templates = $inject(UptimeNotifications);

  public async handle(transition: UptimeTransition): Promise<void> {
    const { monitor, incident, kind } = transition;
    if (!monitor.notifications.email) return;
    const project = await this.projects.findById(monitor.projectId);
    if (!project || project.deletedAt) return;
    let recipients = monitor.notifications.recipients;
    if (!recipients.length && project.organizationId) {
      const owners = await this.members.findMany({
        where: { organizationId: project.organizationId, rank: "owner" },
      });
      const accounts = owners.length
        ? await this.users.findMany({
            where: { id: { inArray: owners.map((owner) => owner.userId) } },
          })
        : [];
      recipients = accounts.flatMap((account) =>
        account.email ? [account.email] : [],
      );
    }
    const template =
      kind === "opened" ? this.templates.outage : this.templates.recovery;
    for (const contact of new Set(
      recipients.map((recipient) => recipient.trim().toLowerCase()),
    )) {
      await template.push({
        contact,
        // A replay before the outbox has been delivered must not enqueue twice.
        key: `uptime:${incident.id}:${kind}:${contact}`,
        variables: {
          monitorName: monitor.name,
          target: monitor.target || "Push receipt",
          cause: incident.cause,
          error: incident.lastError ?? "",
          startedAt: incident.startedAt,
          endedAt: incident.endedAt,
          durationSecs: incident.endedAt
            ? Math.max(
                0,
                Math.round(
                  (Date.parse(incident.endedAt) -
                    Date.parse(incident.startedAt)) /
                    1000,
                ),
              )
            : 0,
          detailsUrl: `${String(this.alepha.env.PUBLIC_URL ?? "").replace(/\/$/, "")}/${project.slug}/uptime/${monitor.id}`,
        },
      });
    }
  }
}
