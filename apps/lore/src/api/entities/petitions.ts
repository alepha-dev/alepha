import { type Static, t } from "alepha";
import { $entity, db } from "alepha/orm";
import { petitionSourceSchema } from "../schemas/petitionSourceSchema.ts";
import { campaigns } from "./campaigns.ts";

/**
 * Petitions are user-submitted bug reports or feature requests. They land in
 * an inbox the campaign owner triages: each petition is either accepted (and
 * promoted to a quest, linked via `promotedQuestId`) or rejected.
 *
 * Submitters must be authenticated — anonymous submissions are not allowed.
 * Petitions can carry attachments (screenshots, CSVs, logs) to give triagers
 * enough context to decide and, eventually, for AI tooling to read.
 */
export const petitions = $entity({
  name: "petitions",
  schema: t.object({
    id: db.primaryKey(t.integer()),
    /**
     * Per-campaign sequential id, 1-based. Stable user-facing reference used
     * in MCP responses and UI display ("#5"). Allocated by
     * `$sequence(scope=campaignId)` on insert.
     */
    shortId: t.integer({ minimum: 1 }),
    createdAt: db.createdAt(),
    deletedAt: db.deletedAt(),
    campaignId: db.ref(t.integer(), () => campaigns.cols.id, {
      onDelete: "cascade",
    }),
    /**
     * Identity of the petition submitter.
     *
     * First-party petitions (submitted via the in-app `/c/:id/request` form by
     * a logged-in Lore user) store that user's verified account email here.
     * Anonymous sigil petitions submitted via an embedded widget store the
     * partner-supplied email when one is available, or `null` when none was
     * provided — so the field may be absent even on accepted petitions.
     *
     * ⚠️ SECURITY: this value is attacker-controlled on the anonymous-sigil
     * path. Render it as escaped plain text only — never markdown or
     * `dangerouslySetInnerHTML`. See folio #12.
     */
    reporterEmail: t.optional(t.string({ maxLength: 320 })),
    title: t.string({ minLength: 1, maxLength: 200 }),
    description: t.string({ maxLength: 10_000 }),
    status: t.enum(["pending", "accepted", "rejected"], { mode: "text" }),
    /**
     * Attachment file ids (uploaded via `POST /campaigns/:id/petitions/attachments`).
     * Stored as `uuid[]` mirroring `quests.attachments`.
     */
    attachments: db.default(t.array(t.uuid()), []),
    /**
     * Free-form tags. The `key=value` convention is documentation, not law —
     * common keys: `type=bug|feature`, `host=lore.alepha.dev`, `path=/foo`,
     * `severity=high`. Used for inbox filtering and reporting context.
     */
    tags: db.default(
      t.array(t.string({ maxLength: 100 }), { maxItems: 20 }),
      [],
    ),
    /**
     * Provenance of an embedded submission. `null`/absent for first-party
     * petitions (the in-app `/c/:id/request` form). When a petition arrives
     * via a sigil-embedded widget the embedding page supplies this block so
     * the campaign owner sees where it came from.
     *
     * ⚠️ SECURITY: `hostUrl`, `hostPath` and `userAgent` are 100%
     * attacker-controlled (the embedding page sets them). They are shown to
     * the campaign owner — render them as escaped plain text only, NEVER
     * through markdown / `dangerouslySetInnerHTML`. See folio #12.
     *
     * Optional + nullable so the column is an additive `ALTER TABLE ... ADD
     * COLUMN` migration — D1-safe, no table rebuild.
     *
     * Shape lives in `petitionSourceSchema` (shared with the request body).
     */
    source: t.optional(petitionSourceSchema),
  }),
  indexes: [
    { columns: ["campaignId", "status", "deletedAt"] },
    { columns: ["campaignId", "createdAt"] },
    { columns: ["campaignId", "shortId"], unique: true },
    { columns: ["reporterEmail", "createdAt"] },
  ],
});

export type Petition = Static<typeof petitions.schema>;
export type PetitionInsert = Static<typeof petitions.insertSchema>;
