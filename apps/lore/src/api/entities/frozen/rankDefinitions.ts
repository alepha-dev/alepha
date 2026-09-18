import { z } from "alepha";
import { $entity, db } from "alepha/orm";

/**
 * Frozen legacy rank definitions.
 *
 * Lore now reads and writes `organization_ranks`. This declaration only
 * keeps the historical `rank_definitions` table in the migration snapshot.
 * Nothing may read it, write it, or build new behavior on it.
 */
export const frozenRankDefinitions = $entity({
  name: "rank_definitions",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    version: db.version(),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),
    type: z.text({ minLength: 1, maxLength: 100 }),
    scopeId: z.text({ minLength: 1, maxLength: 255 }),
    key: z.text({ minLength: 1, maxLength: 64 }),
    name: z.text({ minLength: 1, maxLength: 100 }),
    builtin: db.default(z.boolean(), false),
    permissions: z.array(z.text()),
  }),
  indexes: [
    { columns: ["type", "scopeId", "key"], unique: true },
    { columns: ["type", "scopeId"] },
  ],
});
