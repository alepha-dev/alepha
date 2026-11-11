import { $inject, Alepha, z } from "alepha";
import { $job } from "alepha/api/jobs";
import { users } from "alepha/api/users";
import { $logger } from "alepha/logger";
import { $repository } from "alepha/orm";

import { type Estate, estates } from "../entities/estates.ts";
import { EstateNotifications } from "../notifications/EstateNotifications.ts";
import { EstateCloudflareService } from "../services/EstateCloudflareService.ts";
import { EstateService } from "../services/EstateService.ts";

/**
 * Every night, every Cloudflare token is asked again whether it still works.
 *
 * A token revoked or narrowed at Cloudflare is otherwise discovered by the
 * first person a deploy refuses, which is after the fact. This makes it a
 * day, at most, and tells the one person who can fix it.
 *
 * ## Two jobs, because one estate is one unit of work
 *
 * The cron selects the ids and pushes; {@link recheckCloudflareEstate} does
 * one estate. Until 2026-09-20 this was a single handler looping over every
 * row and awaiting one Cloudflare round-trip each, serially, inside the
 * scheduled Worker invocation, with a per-row `try`/`catch` as the only
 * isolation. Unbounded in a number nobody controls, and a failure meant
 * waiting a day.
 *
 * What the split buys: per-estate retry with backoff instead of the next
 * night, real isolation rather than a catch that counts the failure as
 * `inconclusive`, an admin-visible execution row per estate, and a
 * scheduled invocation that returns in milliseconds.
 *
 * What it costs: the one summary line naming `checked / valid / flipped /
 * inconclusive` is gone, since the work no longer happens in one place.
 * Each execution row carries its own outcome, which is the better record.
 *
 * On `0 3 * * *`, with the other daily purges. It ran at `0 0 * * *`
 * alongside `QuestJobs` until 2026-09-20; that sweep went hourly, which
 * would have left this job holding a whole expression by itself. A
 * Worker's cron triggers are counted per account and shared across every
 * Worker on it, so an expression with one tenant is a slot every app on
 * the account pays for (`EstateCommandJobs` records the same reasoning;
 * the crons reach the Worker from `dist/manifest.json`). Midnight carried
 * no meaning here - the window this job promises is "within a day".
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
  protected readonly service = $inject(EstateService);

  /**
   * The fan-out. Reads ids and pushes; it contacts nothing itself.
   *
   * No `key` on the pushes. A key dedupes against ANY existing row with
   * that key, with no window, so `estate.id` would dedupe tonight's push
   * against last night's completed row and the sweep would never run
   * twice. Dating the key would work and costs two queries per estate;
   * the instant lock already claims a tick once across every replica, so
   * it would be buying a guarantee that is already held.
   *
   * It declares `retry` for the same reason the per-estate job does: a
   * daily tick that fails has otherwise lost a day. A retry re-pushes
   * estates the first attempt may already have pushed, which is safe -
   * re-probing a token is idempotent, and the first pass has by then
   * written `credentialError`, so `wasValid` is false and no owner is
   * emailed twice.
   */
  public readonly recheckCloudflareEstates = $job({
    name: "estates.recheck-cloudflare",
    description:
      "Pushes one credential re-check per Cloudflare estate, nightly.",
    cron: "0 3 * * *",
    // One minute: since the split this is one SELECT and one batched
    // insert, and it contacts nothing. The Cloudflare round-trips live in
    // estates.recheck-cloudflare-one, which carries its own 30 s.
    timeout: [60, "seconds"],
    retry: { retries: 2 },
    handler: async () => {
      const rows = await this.estates.findMany({
        where: { type: { eq: "cloudflare" } },
        columns: ["id"],
        orderBy: [{ column: "createdAt", direction: "asc" }],
      });
      if (rows.length === 0) {
        return;
      }

      await this.recheckCloudflareEstate.pushMany(
        rows.map((estate) => ({ payload: { estateId: estate.id } })),
      );
      this.log.info("Queued cloudflare estate credential re-checks", {
        estates: rows.length,
      });
    },
  });

  /**
   * One estate's re-check.
   *
   * ⚠️ `wasValid` is read HERE, before the probe, and that ordering is the
   * whole edge the email is triggered on: a row that was already invalid
   * last night sends nothing tonight. It cannot be hoisted into the
   * fan-out - by the time this runs, the row is what it is.
   *
   * An `inconclusive` answer is a completed execution, not a failure. It
   * means Cloudflare could not be reached, {@link EstateCloudflareService.recheck}
   * deliberately leaves the row untouched for exactly that case, and a
   * retry fifteen minutes later would re-probe an outage for nothing.
   * A genuine throw - a broken fetch, a database error - propagates, and
   * that is what `retry` is for.
   */
  public readonly recheckCloudflareEstate = $job({
    name: "estates.recheck-cloudflare-one",
    description:
      "Re-checks one Cloudflare estate token and emails the owner when a valid one turns invalid.",
    schema: z.object({ estateId: estates.schema.shape.id }),
    retry: { retries: 2 },
    timeout: [30, "seconds"],
    handler: async ({ payload }) => {
      const estate = await this.estates.findOne({
        where: { id: { eq: payload.estateId } },
      });
      if (!estate) {
        // Deleted between the fan-out and here. Nothing to check and
        // nothing wrong.
        return;
      }

      const wasValid = this.cloudflare.credentialStatus(estate) === "valid";
      const check = await this.cloudflare.recheck(estate);

      if (check.outcome === "inconclusive") {
        this.log.info("Could not reach Cloudflare to re-check an estate", {
          estateId: estate.id,
        });
        return;
      }
      if (check.outcome === "passed") {
        return;
      }
      if (wasValid) {
        await this.notifyManagers(estate, check.message);
      }
    },
  });

  /**
   * Emails every member of the estate's home project whose rank grants
   * `estate:update` (#Q3279), the people who can replace the token, or the
   * anchor of an estate with no home; says so when nobody can be reached.
   *
   * `push()` only enqueues an outbox row, so a delivery that fails later can
   * never break the sweep; that is the same pipeline `QuestJobs.questReminder`
   * uses, with its retries and its receipt. Without SMTP the mail lands under
   * `DATA_DIR/emails` through `LocalEmailProvider`, and the outbox row plus
   * its receipt are the record either way. One recipient's failed push costs
   * no other recipient theirs.
   */
  protected async notifyManagers(
    estate: Estate,
    reason: string,
  ): Promise<void> {
    const recipients = await this.service.recipientsOf(estate);
    const people = recipients.length
      ? await this.users.findMany({ where: { id: { inArray: recipients } } })
      : [];
    const reachable = people.filter((person) => !!person.email);
    if (reachable.length === 0) {
      // Everybody mid-deletion, or nobody with an address. The row still
      // carries the failure and the drawer still shows it.
      this.log.warn("An estate credential went invalid with nobody to tell", {
        slug: estate.slug,
      });
      return;
    }

    const baseUrl = this.alepha.env.PUBLIC_URL ?? "";
    const path = await this.service.pagePath(estate);
    for (const person of reachable) {
      try {
        await this.notifications.credentialInvalid.push({
          contact: person.email!,
          variables: {
            estateSlug: estate.slug,
            reason,
            estatesUrl: `${baseUrl}${path}`,
            homeless: estate.projectId == null,
          },
        });
      } catch (error) {
        this.log.warn("Could not tell somebody an estate credential failed", {
          slug: estate.slug,
          error,
        });
      }
    }
  }
}
