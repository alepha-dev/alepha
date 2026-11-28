import type { Infer } from "alepha";
import { z } from "alepha";
import { $entity, db } from "alepha/orm";

import { sigils } from "./sigils.ts";

/**
 * One visitor of one app, for one period: the unit a visitor count counts.
 *
 * The app's own server hashes the visitor (its address and user-agent, or
 * its signed-in user id) with a salt that rotates per period, a UTC calendar
 * month by default, and stamps the period beside the hash. The same person
 * gives the same hash all month, so one row per `(sigilId, period,
 * visitorHash)` is one visitor of that month, exactly.
 *
 * **The hash does not outlive its period.** `SigilJobs` sets it to null once
 * the period has ended (`periodEndsAt`), so after that the row is a visitor
 * nobody can be recognised as, kept only to be counted. The row itself goes
 * after 400 days. A null hash never conflicts in the unique index (SQL
 * nulls are distinct), so expired rows never block a new period.
 *
 * Declared bots get no session: see `SigilIngestService.absorbViews`.
 */
export const sigilSessions = $entity({
  name: "sigil_sessions",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    sigilId: db.ref(z.uuid(), () => sigils.cols.id, { onDelete: "cascade" }),
    /**
     * `2026-11`, `2026-W48` or `2026-11-25`: the period the hash belongs to.
     */
    period: z.string().min(7).max(16),
    /**
     * When `period` ends, ISO 8601 UTC: what the hash-expiry sweep reads.
     */
    periodEndsAt: z.string().max(32),
    /**
     * The visitor hash while its period runs; null after.
     */
    visitorHash: z.string().max(128).nullable().optional(),
    firstSeenAt: z.string().max(32),
    lastSeenAt: z.string().max(32),
  }),
  indexes: [
    { columns: ["sigilId", "period", "visitorHash"], unique: true },
    { columns: ["periodEndsAt"] },
    { columns: ["lastSeenAt"] },
  ],
});

export type SigilSession = Infer<typeof sigilSessions.schema>;
