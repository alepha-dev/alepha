import { $inject } from "alepha";
import { $job } from "alepha/api/jobs";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { $repository } from "alepha/orm";
import { campaigns } from "../entities/campaigns.ts";
import { sigilBlights } from "../entities/sigilBlights.ts";
import { sigils } from "../entities/sigils.ts";

/** Fallback Blights retention window when a campaign sets no `retentionDays`. */
export const DEFAULT_RETENTION_DAYS = 30;

/** Milliseconds in a day — for the retention-cutoff arithmetic. */
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Background jobs for the Sigils / Blights surface.
 *
 * Currently a single daily purge: deletes stale `open` blights so the inbox
 * does not grow without bound. Follows the `ChapterJobs` pattern — a `$job`
 * with a `cron` schedule and a `DateTimeProvider`-driven "now".
 */
export class SigilJobs {
  protected readonly log = $logger();
  protected readonly campaigns = $repository(campaigns);
  protected readonly sigils = $repository(sigils);
  protected readonly blights = $repository(sigilBlights);
  protected readonly dt = $inject(DateTimeProvider);

  /**
   * Daily purge of stale blights.
   *
   * For each campaign, deletes `sigil_blights` rows whose `lastSeenAt` is
   * older than `campaign.retentionDays ?? 30` days — but ONLY rows with
   * `status = 'open'`. Resolved blights (`status = 'resolved'`) and
   * quest-forwarded blights (`status` starts with `quest:`) are kept
   * indefinitely as an audit trail (see folio #10 §Blights "Auto-purge").
   *
   * Runs once a day — retention is measured in days/weeks so a coarse
   * cadence is fine; the cron is `5 4 * * *` (04:05 UTC, off-peak).
   */
  public readonly purgeStaleBlights = $job({
    cron: "5 4 * * *",
    handler: async () => {
      const nowMs = this.dt.nowMillis();
      const allCampaigns = await this.campaigns.findMany({});
      let totalDeleted = 0;

      for (const campaign of allCampaigns) {
        try {
          const retentionDays =
            campaign.retentionDays ?? DEFAULT_RETENTION_DAYS;
          const cutoff = new Date(nowMs - retentionDays * DAY_MS).toISOString();

          // Blights are scoped to sigils, sigils to campaigns — resolve
          // this campaign's sigil ids to filter the blight rows.
          const campaignSigils = await this.sigils.findMany(
            { where: { campaignId: { eq: campaign.id } } },
            { force: true },
          );
          if (campaignSigils.length === 0) continue;
          const sigilIds = campaignSigils.map((s) => s.id);

          // Hard-delete only OPEN blights past the cutoff. `sigil_blights`
          // has no `deletedAt`, so `deleteMany` is a real DELETE.
          const deleted = await this.blights.deleteMany({
            sigilId: { inArray: sigilIds },
            status: { eq: "open" },
            lastSeenAt: { lt: cutoff },
          });
          totalDeleted += deleted.length;
        } catch (err) {
          this.log.warn(
            `Blight purge failed for campaign ${campaign.id}: ${String(err)}`,
          );
        }
      }

      if (totalDeleted > 0) {
        this.log.info(`Purged ${totalDeleted} stale open blight(s)`);
      }
    },
  });
}
