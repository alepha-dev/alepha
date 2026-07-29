import { $relations } from "alepha/orm";
import { campaigns } from "./entities/campaigns.ts";
import { characters } from "./entities/characters.ts";
import { quests } from "./entities/quests.ts";
import { users } from "./entities/users.ts";

/**
 * Every entity, keyed by the name relations address it by.
 */
export const schema = { users, campaigns, characters, quests };

/**
 * The whole relation graph, in one place.
 *
 * Note what is *not* here: no relation is attached to an entity, and none is
 * inferred from `db.ref`. Both are impossible — see `$relations`' own docs for
 * the TS7022 reason. `quests.blockedBy` below is the proof: it points at
 * `quests` from inside the quests entry, which is exactly the self reference
 * that breaks inference-based designs.
 *
 * Both sides of every join are typed. Swap `r.campaigns.id` for
 * `r.campaigns.title` in the `characters` relation and it stops compiling,
 * because a `string` column cannot pair with `characters.campaignId`.
 */
export const relations = $relations(schema, (r) => ({
  users: {
    characters: r.many.characters({
      from: r.users.id,
      to: r.characters.userId,
    }),
    campaigns: r.many.campaigns({
      from: r.users.id,
      to: r.campaigns.ownerId,
    }),
  },

  campaigns: {
    owner: r.one.users({ from: r.campaigns.ownerId, to: r.users.id }),
    characters: r.many.characters({
      from: r.campaigns.id,
      to: r.characters.campaignId,
    }),
    quests: r.many.quests({ from: r.campaigns.id, to: r.quests.campaignId }),
  },

  characters: {
    campaign: r.one.campaigns({
      from: r.characters.campaignId,
      to: r.campaigns.id,
    }),
    user: r.one.users({ from: r.characters.userId, to: r.users.id }),
  },

  quests: {
    campaign: r.one.campaigns({
      from: r.quests.campaignId,
      to: r.campaigns.id,
    }),
    author: r.one.users({ from: r.quests.createdBy, to: r.users.id }),
    /**
     * The self relation. Nothing special is required to declare it.
     */
    blockedBy: r.one.quests({ from: r.quests.dependsOn, to: r.quests.id }),
  },
}));
