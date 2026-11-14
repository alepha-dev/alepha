import { LoreInboxNotifications } from "@lore/core/api";
import { $inject, Alepha } from "alepha";
import { $job } from "alepha/api/jobs";
import { users } from "alepha/api/users";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { $repository } from "alepha/orm";

import { hosts } from "../entities/hosts.ts";
import { HostNotifications } from "../notifications/HostNotifications.ts";
import { HostService } from "../services/HostService.ts";

/**
 * Tells the people who manage a host, once, that a throwaway host is past the TTL it
 * was given (#Q3138). Deletes nothing and stops nothing.
 *
 * ⚠️ The claim IS the update: `notifiedOverdueAt` is set by the same UPDATE
 * that selects the overdue rows (`expiresAt <= now AND notifiedOverdueAt IS
 * NULL`), so two sweeps racing never notify twice, and a TTL moved since
 * clears the claim and re-arms it.
 */
export class HostExpiryJobs {
  protected readonly log = $logger();
  protected readonly alepha = $inject(Alepha);
  protected readonly dateTime = $inject(DateTimeProvider);
  protected readonly hosts = $repository(hosts);
  protected readonly users = $repository(users);
  protected readonly notifications = $inject(HostNotifications);
  protected readonly inbox = $inject(LoreInboxNotifications);
  protected readonly service = $inject(HostService);

  public readonly notifyOverdue = $job({
    name: "hosts.notify-overdue",
    description:
      "Tells each owner, once, that a throwaway host is past its TTL. Stops and deletes nothing.",
    cron: "*/10 * * * *",
    timeout: [60, "seconds"],
    retry: { retries: 2 },
    handler: async () => {
      await this.sweep();
    },
  });

  /**
   * Claim and notify every host that became overdue since the last sweep.
   * Returns how many were claimed.
   */
  public async sweep(): Promise<number> {
    const now = this.dateTime.nowISOString();
    const claimed = await this.hosts.updateMany(
      {
        expiresAt: { lte: now },
        notifiedOverdueAt: { isNull: true },
      },
      { notifiedOverdueAt: now },
      { touch: false },
    );
    if (claimed.length === 0) {
      return 0;
    }
    const rows = await this.hosts.findMany({
      where: { id: { inArray: claimed.map(String) } },
    });
    const baseUrl = String(this.alepha.env.PUBLIC_URL ?? "");
    for (const host of rows) {
      // Every member of the home project whose rank grants `host:update`
      // (#Q3279), or the anchor of a host with no home. The claim above is
      // one per host: each recipient is told once, and one recipient's
      // failed send costs no other recipient theirs.
      const homeless = host.projectId == null;
      const path = await this.service.pagePath(host);
      const recipients = await this.service.recipientsOf(host);
      const people = recipients.length
        ? await this.users.findMany({ where: { id: { inArray: recipients } } })
        : [];
      for (const person of people) {
        if (person.email) {
          await this.attempt(host.slug, "email", () =>
            this.notifications.overdue.push({
              contact: person.email!,
              variables: {
                hostSlug: host.slug,
                expiresAt: host.expiresAt ?? now,
                hostsUrl: `${baseUrl}${path}`,
                homeless,
              },
            }),
          );
        }
        await this.attempt(host.slug, "inbox", () =>
          this.overdueInbox(person.id, host.slug, path),
        );
      }
    }
    this.log.info("Notified the people who manage overdue hosts", {
      hosts: rows.length,
    });
    return rows.length;
  }

  protected async attempt(
    slug: string,
    channel: string,
    push: () => Promise<unknown>,
  ): Promise<void> {
    try {
      await push();
    } catch (error) {
      this.log.warn("Could not tell somebody a host is overdue", {
        slug,
        channel,
        error,
      });
    }
  }

  protected async overdueInbox(
    userId: string,
    slug: string,
    href: string,
  ): Promise<void> {
    await this.notifications.overdueInbox.push({
      contact: `lore-user:${userId}`,
      lang: this.inbox.lang,
      variables: { hostSlug: slug, href },
    });
  }
}
