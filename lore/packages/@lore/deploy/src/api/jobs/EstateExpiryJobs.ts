import { LoreInboxNotifications } from "@lore/core/api";
import { $inject, Alepha } from "alepha";
import { $job } from "alepha/api/jobs";
import { users } from "alepha/api/users";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { $repository } from "alepha/orm";

import { estates } from "../entities/estates.ts";
import { EstateNotifications } from "../notifications/EstateNotifications.ts";
import { EstateService } from "../services/EstateService.ts";

/**
 * Tells the people who manage an estate, once, that a throwaway estate is past the TTL it
 * was given (#Q3138). Deletes nothing and stops nothing.
 *
 * ⚠️ The claim IS the update: `notifiedOverdueAt` is set by the same UPDATE
 * that selects the overdue rows (`expiresAt <= now AND notifiedOverdueAt IS
 * NULL`), so two sweeps racing never notify twice, and a TTL moved since
 * clears the claim and re-arms it.
 */
export class EstateExpiryJobs {
  protected readonly log = $logger();
  protected readonly alepha = $inject(Alepha);
  protected readonly dateTime = $inject(DateTimeProvider);
  protected readonly estates = $repository(estates);
  protected readonly users = $repository(users);
  protected readonly notifications = $inject(EstateNotifications);
  protected readonly inbox = $inject(LoreInboxNotifications);
  protected readonly service = $inject(EstateService);

  public readonly notifyOverdue = $job({
    name: "estates.notify-overdue",
    description:
      "Tells each owner, once, that a throwaway estate is past its TTL. Stops and deletes nothing.",
    cron: "*/10 * * * *",
    timeout: [60, "seconds"],
    retry: { retries: 2 },
    handler: async () => {
      await this.sweep();
    },
  });

  /**
   * Claim and notify every estate that became overdue since the last sweep.
   * Returns how many were claimed.
   */
  public async sweep(): Promise<number> {
    const now = this.dateTime.nowISOString();
    const claimed = await this.estates.updateMany(
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
    const rows = await this.estates.findMany({
      where: { id: { inArray: claimed.map(String) } },
    });
    const baseUrl = String(this.alepha.env.PUBLIC_URL ?? "");
    for (const estate of rows) {
      // Every member of the home project whose rank grants `estate:update`
      // (#Q3279), or the anchor of an estate with no home. The claim above is
      // one per estate: each recipient is told once, and one recipient's
      // failed send costs no other recipient theirs.
      const homeless = estate.projectId == null;
      const recipients = await this.service.recipientsOf(estate);
      const people = recipients.length
        ? await this.users.findMany({ where: { id: { inArray: recipients } } })
        : [];
      for (const person of people) {
        if (person.email) {
          await this.attempt(estate.slug, "email", () =>
            this.notifications.overdue.push({
              contact: person.email!,
              variables: {
                estateSlug: estate.slug,
                expiresAt: estate.expiresAt ?? now,
                estatesUrl: `${baseUrl}/account/estates`,
                homeless,
              },
            }),
          );
        }
        await this.attempt(estate.slug, "inbox", () =>
          this.overdueInbox(person.id, estate.slug),
        );
      }
    }
    this.log.info("Notified the people who manage overdue estates", {
      estates: rows.length,
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
      this.log.warn("Could not tell somebody an estate is overdue", {
        slug,
        channel,
        error,
      });
    }
  }

  protected async overdueInbox(userId: string, slug: string): Promise<void> {
    await this.notifications.overdueInbox.push({
      contact: `lore-user:${userId}`,
      lang: this.inbox.lang,
      variables: { estateSlug: slug, href: "/account/estates" },
    });
  }
}
