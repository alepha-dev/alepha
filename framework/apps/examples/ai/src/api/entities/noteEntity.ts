import { type Infer, z } from "alepha";
import { $entity, db } from "alepha/orm";

/**
 * A note: the one thing this example reads and writes.
 */
export const noteEntity = $entity({
  name: "notes",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    createdAt: db.createdAt(),
    text: z.text({ maxLength: 500 }),
  }),
});

export type NoteEntity = Infer<typeof noteEntity.schema>;
