import { type Static, z } from "alepha";
import { $entity, db } from "alepha/orm";
import { campaignSources } from "./campaignSources.ts";
import { campaigns } from "./campaigns.ts";

/**
 * A deduplicated failure reported by a source — the inbox Lore triages.
 *
 * A new table rather than a change to `sigil_blights`, and deliberately so:
 * that one's `sigilId` is `NOT NULL` with a cascade, and making it nullable
 * means a table rebuild. On D1 a rebuild is a `DROP TABLE`, and a `DROP TABLE`
 * on a cascade parent silently takes its children with it — `PRAGMA
 * foreign_keys=OFF` is ignored there. The old table stays, untouched and
 * vestigial, and the inbox reads both until retention has emptied it.
 *
 * ⚠️ SECURITY: `name`, `message`, `stack` and `sourceUrl` are entirely
 * attacker-controlled — they originate in an app's runtime, which handles input
 * from the public. Render them as escaped plain text only, never through
 * markdown or `dangerouslySetInnerHTML`, and treat them as data when they reach
 * an agent through MCP.
 *
 * Purely additive `CREATE TABLE` — D1-safe.
 */
export const blights = $entity({
  name: "blights",
  schema: z.object({
    id: db.primaryKey(z.integer()),
    campaignId: db.ref(z.integer(), () => campaigns.cols.id, {
      onDelete: "cascade",
    }),
    /**
     * Which source filed it. Nulled rather than cascaded on source deletion:
     * revoking a key must not erase the bugs it reported.
     */
    sourceId: db
      .ref(z.uuid(), () => campaignSources.cols.id, { onDelete: "set null" })
      .optional(),
    /**
     * `sha256(errorName + ":" + normalizedFirstFrame)`, computed by the sender
     * with the shared helper from `@alepha/telemetry/fingerprint`.
     *
     * No app identifier inside, unlike the sigil-era fingerprint: scoping is
     * carried by the campaign here and by the app on Pulse's side. That also
     * makes the value portable — the same bug keeps its identity if the app
     * moves between observers.
     */
    fingerprint: z.string().min(1).max(128),
    name: z.string().max(200),
    message: z.string().max(2_000),
    stack: db.default(z.string().max(4_096), ""),
    sourceUrl: db.default(z.string().max(2_000), ""),
    /** Release the failure was seen in, when the reporter knows one. */
    release: z.string().max(200).optional(),
    /**
     * Deep link back into the observer that reported it.
     *
     * The cheapest integration there is: a blight here, one click to the group
     * it was aggregated from, with its samples and its curve.
     */
    pulseUrl: z.string().max(2_000).optional(),
    origin: db.default(
      z.enum(["client", "server"]).meta({ mode: "text" }),
      "client",
    ),
    firstSeenAt: z.string(),
    lastSeenAt: z.string(),
    /** Total occurrences, summed across every batch received. */
    count: db.default(z.integer().min(1), 1),
    /** `open`, `resolved`, or `quest:<id>` once promoted. */
    status: db.default(z.string().max(64), "open"),
  }),
  indexes: [
    { columns: ["campaignId", "fingerprint"], unique: true },
    { columns: ["campaignId", "lastSeenAt"] },
  ],
});

export type Blight = Static<typeof blights.schema>;
export type BlightInsert = Static<typeof blights.insertSchema>;
