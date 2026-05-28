import { type Static, t } from "alepha";
import { users } from "alepha/api/users";
import { $entity, db } from "alepha/orm";
import { campaigns } from "./campaigns.ts";

export const characters = $entity({
  name: "characters",
  schema: t.object({
    id: db.primaryKey(t.integer()),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),
    userId: db.ref(t.uuid(), () => users.cols.id, {
      onDelete: "cascade",
    }),
    campaignId: db.ref(t.integer(), () => campaigns.cols.id, {
      onDelete: "cascade",
    }),
    xp: t.integer(),
    balance: db.default(t.integer(), 0),
    owner: db.default(t.boolean(), true),
    /**
     * Campaign-scoped display name override. When null, the user's display
     * name (derived from `user.name` / email) is used. See folio
     * "Character — vision and economy".
     */
    alias: t.optional(t.string()),
    /**
     * Character avatar file id (Alepha files API). Fallback chain when null:
     * `character.picture` → `user.picture` → initials placeholder.
     */
    picture: t.optional(t.uuid()),
    /**
     * One equipped achievement key, surfaced as the character's Title in
     * hover-cards. Must be a member of `achievements` — the controller
     * enforces this on write.
     */
    equippedTitle: t.optional(t.string()),
    /**
     * Granted achievement keys (e.g. "first-steps", "hard-worker",
     * "zone-master:UX"). Server-evaluated by the achievement engine on
     * quest-complete / folio-save / character-join. Append-only.
     */
    achievements: db.default(t.array(t.string()), []),
  }),
  indexes: [
    {
      columns: ["userId", "campaignId"],
      unique: true,
    },
  ],
});

export type Character = Static<typeof characters.schema>;
