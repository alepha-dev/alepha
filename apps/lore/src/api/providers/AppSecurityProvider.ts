import { $env, t } from "alepha";
import { $realm } from "alepha/api/users";
import { $repository } from "alepha/orm";
import type { UserAccountToken } from "alepha/security";
import { ForbiddenError } from "alepha/server";
import { type Campaign, campaigns } from "../entities/campaigns.ts";
import { type Character, characters } from "../entities/characters.ts";

export class AppSecurityProvider {
  campaigns = $repository(campaigns);
  characters = $repository(characters);

  env = $env(
    t.object({
      ADMIN_EMAIL: t.optional(t.email()),
      // When set, lore registers `TurnstileCaptchaProvider` in `main.server.ts`
      // and the register flow gates on a Turnstile token. When absent, the
      // realm advertises `captchaRequired: false` so the client doesn't try to
      // render a widget it can't satisfy.
      TURNSTILE_SITE_KEY: t.optional(t.text()),
      // Per-IP registration cap. Defaults to the framework default (10).
      // E2E test env bumps this to 1000 so a single localhost IP doesn't
      // burn through the limit while the suite runs.
      REGISTRATION_IP_MAX_ATTEMPTS: t.optional(t.integer({ minimum: 1 })),
    }),
  );

  realm = $realm({
    features: {
      apiKeys: true,
      avatars: true,
      audits: true,
      jobs: true,
      notifications: true,
    },
    settings: {
      username: "email",
      usernameBlocklist: ["admin", "root", "me", "api", "support", "system"],
      resetPasswordAllowed: true,
      verifyEmailRequired: true,
      captchaRequired: !!this.env.TURNSTILE_SITE_KEY,
      registrationIpMaxAttempts: this.env.REGISTRATION_IP_MAX_ATTEMPTS
        ? Number(this.env.REGISTRATION_IP_MAX_ATTEMPTS)
        : undefined,
      adminEmails: this.env.ADMIN_EMAIL ? [this.env.ADMIN_EMAIL] : [],
    },
    identities: {
      github: true,
      google: true,
      credentials: true,
    },
  });

  /**
   * Read-side gate. Allows the campaign owner, any character (member), and
   * any authenticated user if the campaign is `public`. Use for endpoints
   * that only read campaign data — never for mutations.
   *
   * `user.ownership === false` is a privileged identity (admin without
   * narrow ownership scope) and bypasses the membership check.
   */
  async assertVisible(
    campaignId: number,
    user: UserAccountToken,
  ): Promise<CampaignGuard> {
    const campaign = await this.campaigns.getOne({
      where: { id: { eq: campaignId } },
    });

    if (campaign.createdBy === user.id || !user.ownership) {
      return { campaign };
    }

    const character = await this.characters.findOne({
      where: {
        campaignId: { eq: campaignId },
        userId: { eq: user.id },
      },
    });

    if (character) {
      return { campaign, character };
    }

    if (campaign.public) {
      return { campaign };
    }

    throw new ForbiddenError("Not a member of this campaign");
  }

  /**
   * Write-side gate. Requires the caller to be the campaign owner or a
   * member (character row exists). The `campaign.public` flag is IGNORED —
   * being a public campaign does not grant write access.
   *
   * Use for any endpoint that mutates campaign-scoped data members can
   * legitimately act on (their quests, kanban moves, etc.).
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

    const character = await this.characters.findOne({
      where: {
        campaignId: { eq: campaignId },
        userId: { eq: user.id },
      },
    });

    if (!character) {
      throw new ForbiddenError("Not a member of this campaign");
    }
    return { campaign, character };
  }

  /**
   * Owner-only gate. Requires the caller to be the campaign creator (or a
   * privileged identity with `user.ownership === false`). Use for
   * destructive or campaign-configuration endpoints: delete campaign,
   * toggle `public`, change features, manage kanban columns, manage
   * chapters, import quests, send invitations.
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
  character?: Character;
}
