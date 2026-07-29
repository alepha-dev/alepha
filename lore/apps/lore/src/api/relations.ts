import { users } from "alepha/api/users";
import { $relations } from "alepha/orm";
import { campaigns } from "./entities/campaigns.ts";
import { characters } from "./entities/characters.ts";
import { petitions } from "./entities/petitions.ts";
import { quests } from "./entities/quests.ts";

/**
 * The slice of Lore's entity graph that relations are declared over.
 *
 * Deliberately partial: five entities of twenty-three. A `$relations` schema
 * does not have to cover the application — a relational repository and a plain
 * one address the same tables and coexist, so a controller migrates on its own
 * and the rest stays exactly as it was.
 */
export const schema = {
  users,
  campaigns,
  characters,
  petitions,
  quests,
};

/**
 * Every join Lore was writing by hand, declared once.
 *
 * Nothing here is inferred from `db.ref`: relations are a separate statement
 * because a self-referencing entity (`quests.dependsOn`) makes inference
 * circular. See `$relations` for the full reason.
 */
export const relations = $relations(schema, (r) => ({
  users: {
    characters: r.many.characters({
      from: r.users.id,
      to: r.characters.userId,
    }),
    /**
     * A user's campaigns, through the character that makes them a member.
     *
     * Safe as a plain many-to-many because `characters` carries a unique
     * index on `(userId, campaignId)`: one character per user per campaign,
     * so a campaign cannot come back twice. Drop that index and this relation
     * starts duplicating rows — which is why `CampaignController` has a test
     * pinning it.
     */
    campaigns: r.many.campaigns({
      from: r.users.id.through(r.characters.userId),
      to: r.campaigns.id.through(r.characters.campaignId),
    }),
  },

  campaigns: {
    characters: r.many.characters({
      from: r.campaigns.id,
      to: r.characters.campaignId,
    }),
    /** The other side of the same junction. */
    members: r.many.users({
      from: r.campaigns.id.through(r.characters.campaignId),
      to: r.users.id.through(r.characters.userId),
    }),
  },

  characters: {
    user: r.one.users({ from: r.characters.userId, to: r.users.id }),
    campaign: r.one.campaigns({
      from: r.characters.campaignId,
      to: r.campaigns.id,
    }),
  },

  petitions: {
    reporter: r.one.users({
      from: r.petitions.reporterUserId,
      to: r.users.id,
    }),
    campaign: r.one.campaigns({
      from: r.petitions.campaignId,
      to: r.campaigns.id,
    }),
    /** Quests raised from a petition, oldest first at the call site. */
    linkedQuests: r.many.quests({
      from: r.petitions.id,
      to: r.quests.petitionId,
    }),
  },

  quests: {
    petition: r.one.petitions({
      from: r.quests.petitionId,
      to: r.petitions.id,
    }),
  },
}));
