import { z } from "alepha";
import { $parameter } from "alepha/api/parameters";

/**
 * Lore-wide soft caps on campaign / membership / quest growth. Versioned
 * via `$parameter` so an admin can bump them from `/admin/parameters`
 * without a redeploy. Each call site reads the current value with
 * `await this.limits.maxCampaignsPerUser.get()` (or the slim helpers
 * below) so a change goes live across instances within one notification
 * round-trip.
 */
export class CampaignLimits {
  limits = $parameter({
    name: "lore.campaign.limits",
    description:
      "Per-user / per-campaign hard caps. Bump for power users without a redeploy.",
    schema: z.object({
      maxCampaignsPerUser: z.integer().min(1).max(10_000),
      maxMembersPerCampaign: z.integer().min(1).max(10_000),
      maxQuestsPerCampaign: z.integer().min(1).max(100_000),
      maxChaptersPerCampaign: z.integer().min(1).max(1_000),
    }),
    default: {
      maxCampaignsPerUser: 10,
      maxMembersPerCampaign: 100,
      maxQuestsPerCampaign: 5_000,
      maxChaptersPerCampaign: 200,
    },
  });

  /**
   * Maximum number of campaigns a single user can create. Read at the
   * top of `CampaignController.createCampaign`.
   */
  public async maxCampaignsPerUser(): Promise<number> {
    return (await this.limits.get()).maxCampaignsPerUser;
  }

  /**
   * Maximum number of members (characters) on a single campaign.
   */
  public async maxMembersPerCampaign(): Promise<number> {
    return (await this.limits.get()).maxMembersPerCampaign;
  }

  /**
   * Maximum number of quests under a single campaign.
   */
  public async maxQuestsPerCampaign(): Promise<number> {
    return (await this.limits.get()).maxQuestsPerCampaign;
  }

  /**
   * Maximum number of chapters under a single campaign.
   */
  public async maxChaptersPerCampaign(): Promise<number> {
    return (await this.limits.get()).maxChaptersPerCampaign;
  }
}
