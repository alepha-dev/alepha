import { type Infer, z } from "alepha";
import { $entity } from "../primitives/$entity.ts";
import { db } from "../providers/DatabaseTypeProvider.ts";

/**
 * Storage table for the {@link SequenceProvider}.
 *
 * Each row represents one counter, identified by `(name, scope)`:
 * - `name` is the sequence primitive name (defaulted from its property key).
 * - `scope` is an arbitrary string passed by the caller, defaulted to "default"
 *   for the global, unscoped form. Use this column to namespace per-tenant /
 *   per-campaign / per-anything counters off the same primitive.
 * - `value` is the current counter value. Incremented atomically by
 *   `SequenceProvider.advance()` through an `INSERT ... ON CONFLICT DO UPDATE`
 *   on `(name, scope)` — works identically on Postgres, SQLite, and D1.
 */
export const alephaSequences = $entity({
  name: "alepha_sequences",
  schema: z.object({
    id: db.primaryKey(z.uuid()),

    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),

    name: z.text({
      description: "Sequence primitive name (from $sequence's property key).",
    }),

    scope: z.text({
      description:
        "Caller-provided sub-scope. Defaults to 'default' for the unscoped form.",
      default: "default",
    }),

    value: z
      .integer()
      .describe("Current counter value, advanced atomically on each call."),
  }),
  indexes: [{ columns: ["name", "scope"], unique: true }],
});

export type AlephaSequence = Infer<typeof alephaSequences.schema>;
