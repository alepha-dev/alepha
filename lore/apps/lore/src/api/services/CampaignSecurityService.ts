import { $repository } from "alepha/orm";
import type { UserAccountToken } from "alepha/security";
import { ForbiddenError } from "alepha/server";
import { type Campaign, campaigns } from "../entities/campaigns.ts";
import { type Member, members } from "../entities/members.ts";

/**
 * Campaign access gates.
 *
 * Deliberately separate from `AppSecurityProvider`, which declares the
 * `$realm`. `$realm` registers services into the container from inside a
 * class-field initializer, so anything that both declares it *and* is widely
 * injected becomes a hub in the dependency graph — `LoreFileAccessProvider`
 * needs a membership check, and injecting the realm-declaring class from
 * there closed a loop back into its own construction.
 *
 * Authorization is domain logic; realm configuration is infrastructure. They
 * do not belong in one class.
 */
export class CampaignSecurityService {
  campaigns = $repository(campaigns);
  members = $repository(members);

  /**
   * Membership gate. Requires the caller to be the campaign owner or a
   * member (membership row exists). Used for every campaign-scoped read
   * AND write — Lore campaigns are always private; there is no
   * non-member visibility path.
   *
   * `user.ownership === false` is a privileged identity (admin without
   * narrow ownership scope) and bypasses the membership check.
   */
  async assertMember(
    campaignId: number,
    user: UserAccountToken,
  ): Promise<CampaignGuard> {
    const campaign = await this.campaigns.getOne({
      where: { id: { eq: campaignId } },
    });

    if (campaign.createdBy === user.id || !user.ownership) {
      return { campaign };
    }

    const member = await this.members.findOne({
      where: {
        campaignId: { eq: campaignId },
        userId: { eq: user.id },
      },
    });

    if (!member) {
      throw new ForbiddenError("Not a member of this campaign");
    }
    return { campaign, member };
  }

  /**
   * Non-throwing **literal** membership check — `true` when the caller created
   * the campaign or holds a membership in it.
   *
   * Unlike {@link assertMember}, this deliberately does NOT honor the
   * `user.ownership` privileged-identity bypass: that bypass governs *access*
   * (a privileged admin may read member-gated data), whereas this answers
   * "does the caller *belong* to this campaign?". Used to branch on membership
   * (e.g. exempting members from the petition rate limit), not to gate access.
   */
  async isMember(campaignId: number, user: UserAccountToken): Promise<boolean> {
    const campaign = await this.campaigns.findOne({
      where: { id: { eq: campaignId } },
    });
    if (!campaign) {
      return false;
    }
    if (campaign.createdBy === user.id) {
      return true;
    }
    const member = await this.members.findOne({
      where: {
        campaignId: { eq: campaignId },
        userId: { eq: user.id },
      },
    });
    return !!member;
  }

  /**
   * Owner-only gate. Requires the caller to be the campaign creator (or a
   * privileged identity with `user.ownership === false`). Use for
   * destructive or campaign-configuration endpoints: delete campaign,
   * change features, manage kanban columns, manage chapters, import quests,
   * send invitations.
   */
  async assertOwner(
    campaignId: number,
    user: UserAccountToken,
  ): Promise<CampaignGuard> {
    const campaign = await this.campaigns.getOne({
      where: { id: { eq: campaignId } },
    });

    if (campaign.createdBy !== user.id && user.ownership) {
      throw new ForbiddenError(
        "Only the campaign owner can perform this action",
      );
    }

    return { campaign };
  }
}

export interface CampaignGuard {
  campaign: Campaign;
  member?: Member;
}
