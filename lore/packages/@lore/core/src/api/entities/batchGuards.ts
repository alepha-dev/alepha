import { type Infer, z } from "alepha";
import { $entity, db, sql } from "alepha/orm";

/**
 * The guard rows of `GuardedBatch`: a batch whose first statement inserts a
 * row here with a NULL id when its condition is false, which the CHECK
 * constraint refuses, so the whole native batch aborts. The last statement of the same
 * batch deletes the row, so the table is empty between batches.
 *
 * A table of its own, rather than a guard kind in another table, so the
 * guarantee depends on nothing a feature may drop (#Q3899: it was a guard row
 * in `automation_receipts` before).
 */
export const batchGuards = $entity({
  name: "batch_guards",
  schema: z.object({
    id: db.primaryKey(z.string().min(1).max(64)),
    createdAt: db.createdAt(),
  }),
  constraints: [
    {
      // SQLite accepts NULL in a text primary key: this CHECK is what refuses
      // a false guard on every dialect.
      name: "batch_guards_valid_id",
      columns: ["id"],
      check: sql`id IS NOT NULL`,
    },
  ],
});

export type BatchGuard = Infer<typeof batchGuards.schema>;
