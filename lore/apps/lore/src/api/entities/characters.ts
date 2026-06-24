import { type Static, z } from "alepha";
import { users } from "alepha/api/users";
import { $entity, db } from "alepha/orm";
import { campaigns } from "./campaigns.ts";

export const characters = $entity({
  name: "characters",
  schema: z.object({
    id: db.primaryKey(z.integer()),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),
    userId: db.ref(z.uuid(), () => users.cols.id, {
      onDelete: "cascade",
    }),
    campaignId: db.ref(z.integer(), () => campaigns.cols.id, {
      onDelete: "cascade",
    }),
    xp: z.integer(),
    balance: db.default(z.integer(), 0),
    owner: db.default(z.boolean(), true),
    /**
     * Campaign-scoped display name override. When null, the user's display
     * name (derived from `user.name` / email) is used. See folio
     * "Character — vision and economy".
     */
    alias: z.string().optional(),
    /**
     * Character avatar file id (Alepha files API). Fallback chain when null:
     * `character.picture` → `user.picture` → initials placeholder.
     */
    picture: z.uuid().optional(),
    /**
     * One equipped achievement key, surfaced as the character's Title in
     * hover-cards. Must be a member of `achievements` — the controller
     * enforces this on write.
     */
    equippedTitle: z.string().optional(),
    /**
     * Granted achievement keys (e.g. "first-steps", "hard-worker",
     * "zone-master:UX"). Server-evaluated by the achievement engine on
     * quest-complete / folio-save / character-join. Append-only.
     */
    achievements: db.default(z.array(z.string()), []),
  }),
  indexes: [
    {
      columns: ["userId", "campaignId"],
      unique: true,
    },
  ],
});

export type Character = Static<typeof characters.schema>;
