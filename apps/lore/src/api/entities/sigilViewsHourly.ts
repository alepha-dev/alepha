import { type Infer, z } from "alepha";
import { $entity, db } from "alepha/orm";
import { sigils } from "./sigils.ts";

/**
 * Page views, rolled up on write.
 *
 * One row per `(sigilId, hour, path, country)`, incremented on ingest. Storage
 * is bounded by how many distinct pages an app has, not by how much traffic it
 * gets — the difference between a table that grows with the site and one that
 * grows with its success.
 *
 * Hourly rather than daily: a deploy at 14:00 that breaks a page should be
 * visible against 13:00, and a day bucket hides exactly that.
 *
 * ⚠️ The count is best-effort. Nothing throttles an app's own reporting, so the
 * number is inflatable by whoever holds the sigil token. The trustworthy metric
 * is the unique-visitor count.
 */
export const sigilViewsHourly = $entity({
  name: "sigil_views_hourly",
  schema: z.object({
    id: db.primaryKey(z.integer()),
    sigilId: db.ref(z.uuid(), () => sigils.cols.id, { onDelete: "cascade" }),
    /** UTC hour bucket, `YYYY-MM-DDTHH`. */
    hour: z.string().min(13).max(13),
    /** Page path, query and fragment stripped. */
    path: z.string().min(1).max(1024),
    /** Coarse ISO-3166 country from the edge; `ZZ` when unknown. */
    country: db.default(z.string().min(1).max(8), "ZZ"),
    count: db.default(z.integer().min(1), 1),
  }),
  indexes: [
    { columns: ["sigilId", "hour", "path", "country"], unique: true },
    { columns: ["sigilId", "hour"] },
  ],
});

export type SigilViewHourly = Infer<typeof sigilViewsHourly.schema>;
export type SigilViewHourlyInsert = Infer<typeof sigilViewsHourly.insertSchema>;
