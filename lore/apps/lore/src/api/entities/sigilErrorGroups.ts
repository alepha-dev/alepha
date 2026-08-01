import { type Static, z } from "alepha";
import { $entity, db } from "alepha/orm";
import { sigils } from "./sigils.ts";

/**
 * One distinct failure in one sigil, and everything seen of it so far.
 *
 * The unit actually stored on ingest. Individual occurrences are never kept: a
 * crash loop is one fact with a count, and storing it a thousand times would
 * cost a thousand times more to learn the same thing.
 *
 * `fingerprint` comes from `@alepha/sigil/fingerprint`, computed identically by
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
    /** Release the error was first seen in, when the app reports one. */
    release: z.string().max(200).optional(),
    origin: db.default(
      z.enum(["client", "server"]).meta({ mode: "text" }),
      "client",
    ),
    firstSeenAt: z.string(),
    lastSeenAt: z.string(),
    count: db.default(z.integer().min(1), 1),
    /**
     * Last time this group was synced into the `blights` inbox, or absent if
     * never.
     *
     * Drives the sync window: only groups touched since their last sync are
     * upserted into `blights`, so a quiet group costs nothing to re-check.
     */
    forwardedAt: z.string().optional(),
  }),
  indexes: [
    { columns: ["sigilId", "fingerprint"], unique: true },
    { columns: ["sigilId", "lastSeenAt"] },
  ],
});

export type SigilErrorGroup = Static<typeof sigilErrorGroups.schema>;
export type SigilErrorGroupInsert = Static<
  typeof sigilErrorGroups.insertSchema
>;
