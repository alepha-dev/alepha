import { projects } from "@lore/core/schemas";
import { type Infer, z } from "alepha";
import { users } from "alepha/api/users";
import { $entity, db } from "alepha/orm";

/**
 * A room of one project (#E161): open to every project member who reads
 * chat, or private to its members.
 *
 * ⚠️ A private room does not exist for anyone outside it: absent from every
 * list and count, and a 404, never a 403, on every action (#Q3925).
 *
 * No room spans projects, and there is no special two-person kind: a private
 * talk is a private room with one invite.
 */
export const chatRooms = $entity({
  name: "chat_rooms",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),
    projectId: db.ref(z.integer(), () => projects.cols.id, {
      onDelete: "cascade",
    }),
    /**
     * Unique per project, in the `#name` form a mention or a link spells.
     */
    name: z.text({ minLength: 1, maxLength: 80 }),
    private: z.boolean().default(false),
    /**
     * Readable, and refusing new messages, while set.
     */
    archivedAt: z.datetime().optional(),
    createdBy: db.ref(z.uuid().optional(), () => users.cols.id, {
      onDelete: "set null",
    }),
    /**
     * A member's own room with an agent (#Q3942): private, theirs alone,
     * nobody invited in. Deleted with the account.
     */
    personalOf: db.ref(z.uuid().optional(), () => users.cols.id, {
      onDelete: "cascade",
    }),
    /**
     * The agent every message of a personal room prompts, without a
     * mention: `lore`.
     */
    agent: z.text({ maxLength: 40 }).optional(),
  }),
  indexes: [
    { columns: ["projectId", "name"], unique: true },
    { columns: ["projectId", "personalOf"] },
  ],
});

export type ChatRoom = Infer<typeof chatRooms.schema>;
