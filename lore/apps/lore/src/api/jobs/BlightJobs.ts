import { $inject } from "alepha";
import { $job } from "alepha/api/jobs";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { $repository } from "alepha/orm";
import { blights } from "../entities/blights.ts";
import { campaigns } from "../entities/campaigns.ts";
import { sigilBlights } from "../entities/sigilBlights.ts";
import { sigils } from "../entities/sigils.ts";

/** Fallback Blights retention window when a campaign sets no `retentionDays`. */
export const DEFAULT_RETENTION_DAYS = 30;

/** Milliseconds in a day — for the retention-cutoff arithmetic. */
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Keeps the blights inbox from growing without bound.
 *
 * Purges BOTH tables. `blights` is where reports land now; `sigil_blights` is
 * the legacy one, still read by the inbox during the retention window and
 * emptied by this same sweep — which is what lets that branch of the controller
 * be deleted later without anyone migrating rows by hand.
 */
export class BlightJobs {
  protected readonly log = $logger();
  protected readonly campaigns = $repository(campaigns);
  protected readonly sigils = $repository(sigils);
  protected readonly legacyBlights = $repository(sigilBlights);
  protected readonly blights = $repository(blights);
  protected readonly dt = $inject(DateTimeProvider);

  /**
   * Hourly purge of stale blights.
   *
   * For each campaign, deletes `sigil_blights` rows whose `lastSeenAt` is
   * older than `campaign.retentionDays ?? 30` days — but ONLY rows with
   * `status = 'open'`. Resolved blights (`status = 'resolved'`) and
   * quest-forwarded blights (`status` starts with `quest:`) are kept
   * indefinitely as an audit trail (see folio #10 §Blights "Auto-purge").
   *
   * Retention is measured in days/weeks so the exact cadence isn't
   * significant; runs on the shared `0 * * * *` slot to keep the Cloudflare
   * cron-trigger count down.
   */
  public readonly purgeStaleBlights = $job({
    cron: "0 * * * *",
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
          // The current table is scoped straight to the campaign — no sigil
          // indirection to resolve.
          const purged = await this.blights.deleteMany({
            campaignId: { eq: campaign.id },
            status: { eq: "open" },
            lastSeenAt: { lt: cutoff },
          });
          totalDeleted += purged.length;

          if (campaignSigils.length === 0) continue;
          const sigilIds = campaignSigils.map((s) => s.id);

          // Hard-delete only OPEN blights past the cutoff. `sigil_blights`
          // has no `deletedAt`, so `deleteMany` is a real DELETE.
          const deleted = await this.legacyBlights.deleteMany({
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
