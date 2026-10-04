import { type Infer, z } from "alepha";
import { users } from "alepha/api/users";
import { $entity, db } from "alepha/orm";

/**
 * A note belongs to the user who wrote it. The list, the form and the delete
 * confirmation of the test app all work on this one table.
 */
export const notes = $entity({
  name: "notes",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    createdAt: db.createdAt(),
    userId: db.ref(z.uuid(), () => users.cols.id, { onDelete: "cascade" }),
    title: z.text({ minLength: 1, maxLength: 120 }),
  }),
});

export type Note = Infer<typeof notes.schema>;
