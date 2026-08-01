import { type Static, z } from "alepha";
import { $entity, db } from "alepha/orm";
import { campaigns } from "./campaigns.ts";
import { sigils } from "./sigils.ts";

/**
 * A deduplicated failure — the inbox Lore triages.
 *
 * One row per `(campaignId, fingerprint)`, incremented on ingest rather than
 * stored per-occurrence: a crash loop is one fact with a count, not a log.
 *
 * ⚠️ SECURITY: `name`, `message`, `stack` and `sourceUrl` are entirely
 * attacker-controlled — they originate in an app's runtime, which handles input
 * from the public. Render them as escaped plain text only, never through
 * markdown or `dangerouslySetInnerHTML`, and treat them as data when they reach
 * an agent through MCP.
 */
export const blights = $entity({
  name: "blights",
  schema: z.object({
    id: db.primaryKey(z.integer()),
    campaignId: db.ref(z.integer(), () => campaigns.cols.id, {
      onDelete: "cascade",
    }),
    /**
     * Which sigil filed it. Nulled rather than cascaded on sigil deletion:
     * revoking a token must not erase the bugs it reported.
     */
    sigilId: db
      .ref(z.uuid(), () => sigils.cols.id, { onDelete: "set null" })
      .optional(),
    /**
     * `sha256(errorName + ":" + normalizedFirstFrame)`, computed by the
     * client with the shared helper from `@alepha/sigil/fingerprint`.
     *
     * Survives a deploy: bundle hashes and line numbers are normalised away,
     * so a bug that is not fixed keeps its identity instead of reappearing as
     * new after every release.
     */
    fingerprint: z.string().min(1).max(128),
    name: z.string().max(200),
    message: z.string().max(2_000),
    stack: db.default(z.string().max(4_096), ""),
    sourceUrl: db.default(z.string().max(2_000), ""),
    /** Release the failure was seen in, when the reporter knows one. */
    release: z.string().max(200).optional(),
    /**
     * Deep link back to the observer's error page for this group. With Lore
     * as its own observer, this points at Lore's own blight detail view.
     *
     * The cheapest integration there is: a blight here, one click to the group
     * it was aggregated from, with its samples and its curve.
     */
    sigilUrl: z.string().max(2_000).optional(),
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
