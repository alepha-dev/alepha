import { type Infer, z } from "alepha";
import { $entity, db } from "alepha/orm";

/**
 * One assistant conversation, owned by one user.
 *
 * `userId` is a bare id with no foreign key, as in `notification_inbox`:
 * this module imports nothing from `alepha/api/users`, so a deleted
 * account's conversations are the app's to remove (or the retention job's).
 *
 * ## The pause lives here
 *
 * A turn that waits on the user stores the call in `pendingCall`, and its id
 * again in `pendingCallId`, a plain column a resume claims with a
 * conditional update: of two concurrent approvals, one clears it and runs,
 * the other finds nothing to claim.
 */
export const aiConversationEntity = $entity({
  name: "ai_conversations",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),
    userId: z.text({ maxLength: 128 }),
    title: z.text().nullable().optional(),
    pendingCallId: z.text({ maxLength: 128 }).nullable().optional(),
    pendingCall: z.record(z.text(), z.any()).nullable().optional(),
  }),
  indexes: [
    // The caller's list, newest first.
    { columns: ["userId", "updatedAt"] },
    // The retention sweep.
    { columns: ["updatedAt"] },
  ],
});

export type AiConversationEntity = Infer<typeof aiConversationEntity.schema>;
