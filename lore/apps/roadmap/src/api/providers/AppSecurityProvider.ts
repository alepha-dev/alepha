import { $env, t } from "alepha";
import { $realm } from "alepha/api/users";
import { $repository } from "alepha/orm";
import type { UserAccountToken } from "alepha/security";
import { type Campaign, campaigns } from "../entities/campaigns.ts";
import { type Character, characters } from "../entities/characters.ts";

export class AppSecurityProvider {
  campaigns = $repository(campaigns);
  characters = $repository(characters);

  env = $env(
    t.object({
      ADMIN_EMAIL: t.optional(t.email()),
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
      // Auto-derive a stable handle from the registration email at signup
      // (and from the OAuth profile email on Google/GitHub login). The
      // registration form never shows a username input — the slugger does
      // its work server-side and the DB unique index settles ties via the
      // `-<random>` retry path. Same handle gets shown in the UI, used in
      // mentions, and embedded in profile URLs.
      username: "email",
      // Reserved handles that no user — credentials or OAuth — should be
      // able to claim. Default empty in the framework; we opt in here for a
      // few obvious ones.
      usernameBlocklist: ["admin", "root", "me", "api", "support", "system"],
      resetPasswordAllowed: true,
      verifyEmailRequired: true,
      adminEmails: this.env.ADMIN_EMAIL ? [this.env.ADMIN_EMAIL] : [],
    },
    identities: {
      github: true,
      google: true,
      credentials: true,
    },
  });

  async checkOwnership(
    campaignId: number,
    user: UserAccountToken,
  ): Promise<CampaignGuard> {
    const campaign = await this.campaigns.getOne({
      where: {
        id: { eq: campaignId },
      },
    });

    if (campaign.createdBy !== user.id && !campaign.public && user.ownership) {
      return {
        campaign,
        character: await this.characters.getOne({
          where: {
            campaignId: { eq: campaignId },
            userId: { eq: user.id },
          },
        }),
      };
    }

    return { campaign };
  }
}

export interface CampaignGuard {
  campaign: Campaign;
  character?: Character;
}
