import { type Infer, z } from "alepha";
import { $entity, db } from "alepha/orm";

import { sigils } from "./sigils.ts";

/**
 * One distinct failure in one sigil, and everything seen of it so far.
 *
 * The unit actually stored on ingest. Individual occurrences are never kept: a
 * crash loop is one fact with a count, and storing it a thousand times would
 * cost a thousand times more to learn the same thing.
 *
 * `fingerprint` comes from `@alepha/sigil`, computed identically by
 * the app that sends and by this table. It survives a deploy: bundle hashes
 * and line numbers are normalised away, so a bug that is not fixed keeps its
 * history instead of reappearing as new after every release.
 *
 * `stackSample` is the FIRST occurrence's stack, not the latest. The newest
 * sample of a recurring error is rarely the informative one, and letting it
 * drift means the recorded stack no longer matches the recorded `firstSeenAt`.
 */
export const sigilErrorGroups = $entity({
  name: "sigil_error_groups",
  schema: z.object({
    id: db.primaryKey(z.integer()),
    sigilId: db.ref(z.uuid(), () => sigils.cols.id, { onDelete: "cascade" }),
    fingerprint: z.string().min(1).max(128),
    name: z.string().min(1).max(200),
    message: z.string().max(2000),
    stackSample: z.string().max(4096),
    sourceUrl: z.string().max(2000),
    origin: db.default(
      z.enum(["client", "server"]).meta({ mode: "text" }),
      "client",
    ),
    firstSeenAt: z.string(),
    lastSeenAt: z.string(),
    count: db.default(z.integer().min(1), 1),
  }),
  indexes: [
    { columns: ["sigilId", "fingerprint"], unique: true },
    { columns: ["sigilId", "lastSeenAt"] },
  ],
});

export type SigilErrorGroup = Infer<typeof sigilErrorGroups.schema>;
export type SigilErrorGroupInsert = Infer<typeof sigilErrorGroups.insertSchema>;
