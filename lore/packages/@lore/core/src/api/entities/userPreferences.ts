import { type Infer, z } from "alepha";
import { users } from "alepha/api/users";
import { $entity, db } from "alepha/orm";

/**
 * What a preference key may be: letters, digits and `.`, `_`, `:`, `-`, up to
 * 120 characters. Wide enough for a DataTable's `persistenceKey`
 * (`lor.board.12`), narrow enough to travel in a path unescaped.
 */
export const USER_PREFERENCE_KEY_PATTERN = "^[A-Za-z0-9._:-]{1,120}$";

/**
 * A person's preferences kept on the server rather than in one browser
 * (#Q4417): one row per user and key, the value a JSON object.
 *
 * Generic on purpose. The first tenant is the Quests table's state (filters,
 * the filters on the bar, columns, sort, page size, under the table's
 * `persistenceKey`), so it follows the reader to another device; every other
 * DataTable can move here by naming its key, with no migration.
 *
 * ## What the key is
 *
 * The caller's own name for the preference (`lor.board.12`), checked against
 * {@link USER_PREFERENCE_KEY_PATTERN}. Lore never parses it: a project id in
 * it is not a foreign key, and a deleted project leaves its row behind,
 * harmless because nothing reads a key nobody asks for.
 *
 * ## No row means "never written"
 *
 * Which is what lets the client carry a value the browser still holds over
 * once: a missing row reads as `null`, a written one, even emptied, as an
 * object.
 */
export const userPreferences = $entity({
  name: "user_preferences",
  schema: z.object({
    id: db.primaryKey(z.integer()),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),
    /**
     * A real foreign key: deleting the account deletes its preferences.
     */
    userId: db.ref(z.uuid(), () => users.cols.id, { onDelete: "cascade" }),
    key: z.text({ maxLength: 120, pattern: USER_PREFERENCE_KEY_PATTERN }),
    value: db.default(z.record(z.text(), z.any()), {}),
  }),
  indexes: [{ columns: ["userId", "key"], unique: true }],
});

export type UserPreference = Infer<typeof userPreferences.schema>;
