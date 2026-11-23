import {
  HostProjectEvents,
  SourceRepository,
  HostEventFields,
} from "@lore/core/api";
import { projects, hosts } from "@lore/core/schemas";
import { $inject } from "alepha";
import { $job } from "alepha/api/jobs";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { $repository } from "alepha/orm";
import { ConflictError } from "alepha/server";

/**
 * Raises `host.expired`, once, when a throwaway host is past the TTL it was
 * given (#Q3138, #Q3627). Deletes nothing and stops nothing.
 *
 * ⚠️ The claim IS the update: `notifiedOverdueAt` is set by the same guarded
 * UPDATE that records the event (`notifiedOverdueAt IS NULL`), so two sweeps
 * racing never raise it twice, and a TTL moved since clears the claim and
 * re-arms it.
 */
export class HostExpiryJobs {
  /**
   * Injected so the events this class records are in the catalog
   * whatever booted it (#Q3889).
   */
  protected readonly eventDefinitions = $inject(HostProjectEvents);
  protected readonly log = $logger();
  protected readonly dateTime = $inject(DateTimeProvider);
  protected readonly hosts = $repository(hosts);
  protected readonly projects = $repository(projects);
  protected readonly sources = $inject(SourceRepository.of(hosts));
  protected readonly fields = $inject(HostEventFields);

  public readonly notifyOverdue = $job({
    name: "hosts.notify-overdue",
    description:
      "Raises host.expired, once, for a throwaway host past its TTL. Stops and deletes nothing.",
    cron: "*/10 * * * *",
    timeout: [60, "seconds"],
    retry: { retries: 2 },
    handler: async () => {
      await this.sweep();
    },
  });

  /**
   * Claim every host that became overdue since the last sweep, each in one
   * write that raises `host.expired` in its home project (#Q3627): telling
   * people is the subscriptions' job. The claim (`notifiedOverdueAt`) is
   * the once-per-occurrence guard, so a host is raised once until its TTL is
   * extended and it expires again. Returns how many were claimed.
   */
  public async sweep(): Promise<number> {
    const now = this.dateTime.nowISOString();
    const due = await this.hosts.findMany({
      where: { expiresAt: { lte: now }, notifiedOverdueAt: { isNull: true } },
      limit: 100,
    });
    let claimed = 0;
    for (const host of due) {
      const since = host.expiresAt ?? now;
      try {
        await this.sources.sourceUpdate(
          { id: host.id, notifiedOverdueAt: { isNull: true } },
          { notifiedOverdueAt: now },
          {
            projectId: host.projectId,
            resourceId: host.id,
            name: "host.expired",
            subjectId: host.id,
            fields: this.fields.build(
              await this.projects.getById(host.projectId),
              host,
              "expired",
              since,
            ),
          },
        );
        claimed++;
      } catch (error) {
        // Another sweep claimed it first.
        if (!(error instanceof ConflictError)) throw error;
      }
    }
    if (claimed)
      this.log.info("Raised host.expired for overdue hosts", {
        hosts: claimed,
      });
    return claimed;
  }
}
