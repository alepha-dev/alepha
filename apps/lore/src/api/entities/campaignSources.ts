import { type Static, z } from "alepha";
import { $entity, db } from "alepha/orm";
import { campaigns } from "./campaigns.ts";

/**
 * A system allowed to file blights into a campaign.
 *
 * One row per Sigil — or per anything else that reports. Where a sigil was a
 * credential handed to a *website* so it could push raw telemetry, a source is
 * a credential handed to an *observer* that has already done the deduplication.
 * Lore stopped being an ingestion endpoint for the public web; it is now the
 * place where an aggregate becomes a decision.
 *
 * **Not `api_keys`.** Those belong to a user and carry a snapshot of their
 * roles, so a leaked one is a person's whole account. A source authenticates a
 * machine and grants exactly one verb.
 *
 * **Not `sigils` either.** That table is vestigial, and giving it new semantics
 * would leave two things called the same name meaning different things — the
 * confusion this rename exists to end.
 */
export const campaignSources = $entity({
  name: "campaign_sources",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    campaignId: db.ref(z.integer(), () => campaigns.cols.id, {
      onDelete: "cascade",
    }),
    /** What an operator calls it in the settings list. */
    name: z.string().min(1).max(200),
    tokenHash: z.string().min(1).max(256),
    /** First characters, so the UI can name a key it cannot reconstruct. */
    tokenPrefix: z.string().min(1).max(32),
    tokenSuffix: db.default(z.string().max(32), ""),
    /**
     * What this source may do. `["blight:write"]` is the only value in v1.
     *
     * A list from the start because the alternative — a boolean, widened later
     * — silently grants the new power to every key that already exists.
     */
    scopes: db.default(z.array(z.string()), ["blight:write"]),
    createdBy: z.uuid().optional(),
    createdAt: db.createdAt(),
    revokedAt: z.string().optional(),
    /**
     * Last time this source reported anything.
     *
     * The groundwork for a dead-man's switch: an observer that stops reporting
     * is indistinguishable from one with nothing to report, and the only way to
     * tell is to have said in advance how often to expect it.
     */
    lastSeenAt: z.string().optional(),
    /** How often this source is expected to report, when it promises to. */
    expectedIntervalMinutes: z.integer().min(1).optional(),
  }),
  indexes: [
    { columns: ["tokenHash"], unique: true },
    { columns: ["campaignId"] },
  ],
});

export type CampaignSource = Static<typeof campaignSources.schema>;
export type CampaignSourceInsert = Static<typeof campaignSources.insertSchema>;
