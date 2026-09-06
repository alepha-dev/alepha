import { $inject, Alepha } from "alepha";
import { $job } from "alepha/api/jobs";
import { users } from "alepha/api/users";
import { $logger } from "alepha/logger";
import { $repository } from "alepha/orm";

import { estates } from "../entities/estates.ts";
import { EstateNotifications } from "../notifications/EstateNotifications.ts";
import { EstateCloudflareService } from "../services/EstateCloudflareService.ts";

/**
 * Every night, every Cloudflare token is asked again whether it still works.
 *
 * A token revoked or narrowed at Cloudflare is otherwise discovered by the
 * first person a deploy refuses, which is after the fact. This makes it a
 * day, at most, and tells the one person who can fix it.
 *
 * On `0 0 * * *`, an expression Lore already emits (`QuestJobs`): a Worker's
 * cron triggers are counted per account and shared across every Worker on
 * it, so a repeated expression adds no trigger and a new cadence would
 * (`EstateCommandJobs` records the same reasoning; the crons reach the
 * Worker from `dist/manifest.json`).
 *
 * ⚠️ `dateTime.travel()` releases every `$job` cron in the container, so
 * this runs in any spec in this module that travels. Its own spec therefore
 * asserts the rows' end state and the outbox's contents, never call counts.
 */
export class EstateCredentialJobs {
  protected readonly log = $logger();
  protected readonly alepha = $inject(Alepha);
  protected readonly estates = $repository(estates);
  protected readonly users = $repository(users);
  protected readonly cloudflare = $inject(EstateCloudflareService);
  protected readonly notifications = $inject(EstateNotifications);

  public readonly recheckCloudflareEstates = $job({
    cron: "0 0 * * *",
    handler: async () => {
      const rows = await this.estates.findMany({
        where: { type: { eq: "cloudflare" } },
        orderBy: [{ column: "createdAt", direction: "asc" }],
      });
      if (rows.length === 0) {
        return;
      }

      let valid = 0;
      let flipped = 0;
      let inconclusive = 0;

      for (const estate of rows) {
        try {
          // Whether this row counted as usable BEFORE tonight, which is the
          // whole edge the email is triggered on: a row that was already
          // invalid last night sends nothing tonight.
          const wasValid = this.cloudflare.credentialStatus(estate) === "valid";
          const check = await this.cloudflare.recheck(estate);

          if (check.outcome === "inconclusive") {
            inconclusive++;
            continue;
          }
          if (check.outcome === "passed") {
            valid++;
            continue;
          }
          if (wasValid) {
            flipped++;
            await this.notifyOwner(
              estate.ownerUserId,
              estate.slug,
              check.message,
            );
          }
        } catch (error) {
          // Isolated per estate: one revoked token, one unreadable
          // credential or one owner mid-deletion must never stop the sweep
          // before the estates that come after it alphabetically.
          inconclusive++;
          this.log.warn("Could not re-check an estate credential", {
            estateId: estate.id,
            error,
          });
        }
      }

      this.log.info("Re-checked cloudflare estate credentials", {
        checked: rows.length,
        valid,
        flipped,
        inconclusive,
      });
    },
  });

  /**
   * Emails the owner, or says why it could not.
   *
   * `push()` only enqueues an outbox row, so a delivery that fails later can
   * never break the sweep; that is the same pipeline `QuestJobs.questReminder`
   * uses, with its retries and its receipt. Without SMTP the mail lands under
   * `DATA_DIR/emails` through `LocalEmailProvider`, and the outbox row plus
   * its receipt are the record either way.
   */
  protected async notifyOwner(
    ownerUserId: string,
    slug: string,
    reason: string,
  ): Promise<void> {
    const owner = await this.users.findOne({
      where: { id: { eq: ownerUserId } },
    });
    if (!owner?.email) {
      // An owner mid-deletion, or one who never had an address. The row
      // still carries the failure and the drawer still shows it.
      this.log.warn("An estate credential went invalid with no owner to tell", {
        slug,
      });
      return;
    }

    const baseUrl = this.alepha.env.PUBLIC_URL ?? "";
    await this.notifications.credentialInvalid.push({
      contact: owner.email,
      variables: {
        estateSlug: slug,
        reason,
        estatesUrl: `${baseUrl}/account/estates`,
      },
    });
  }
}
