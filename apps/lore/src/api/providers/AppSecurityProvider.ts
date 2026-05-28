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
      // OAuth 2.1 authorization server — lets MCP clients (Claude) connect
      // to `/mcp` via Dynamic Client Registration instead of a pasted
      // `?api_key=` query string. The legacy api-key path stays working.
      oauth: true,
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
      // Sliding idle window: a session (web login or OAuth/MCP connection)
      // unused for 30 days is invalidated even before the absolute ceiling.
      // Actively-used connections keep refreshing and never hit this.
      refreshToken: {
        expirationIdle: 30 * 24 * 60 * 60 * 1000,
      },
    },
    issuer: {
      settings: {
        // Absolute ceiling: even a continuously-used session must re-auth
        // after 180 days. Pairs with `expirationIdle` above — active
        // connections live up to here, abandoned ones die at 30 days idle.
        refreshToken: {
          expiration: [180, "days"],
        },
      },
    },
    identities: {
      github: true,
      google: true,
      credentials: true,
    },
  });

  /**
   * Membership gate. Requires the caller to be the campaign owner or a
   * member (character row exists). Used for every campaign-scoped read
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
