import { type Static, z } from "alepha";
import { $entity, db } from "alepha/orm";
import { petitionSourceSchema } from "../schemas/petitionSourceSchema.ts";
import { campaigns } from "./campaigns.ts";
import { users } from "./users.ts";

/**
 * Petitions are user-submitted bug reports or feature requests. They land in
 * an inbox the campaign owner triages: each petition is either accepted (and
 * promoted to one or more quests) or rejected.
 *
 * The link lives on the quest, as `quests.petitionId` — there is no
 * `promotedQuestId` column here, and there never was one. Keeping the pointer
 * on that side is what allows an accepted petition to spawn several quests,
 * and it means deleting a quest leaves no dangling reference to chase.
 *
 * Submitters must be authenticated — anonymous submissions are not allowed.
 * Petitions can carry attachments (screenshots, CSVs, logs) to give triagers
 * enough context to decide and, eventually, for AI tooling to read.
 */
export const petitions = $entity({
  name: "petitions",
  schema: z.object({
    id: db.primaryKey(z.integer()),
    /**
     * Per-campaign sequential id, 1-based. Stable user-facing reference used
     * in MCP responses and UI display ("#5"). Allocated by
     * `$sequence(scope=campaignId)` on insert.
     */
    shortId: z.integer().min(1),
    createdAt: db.createdAt(),
    deletedAt: db.deletedAt(),
    campaignId: db.ref(z.integer(), () => campaigns.cols.id, {
      onDelete: "cascade",
    }),
    reporterUserId: db.ref(z.uuid().optional(), () => users.cols.id, {
      onDelete: "cascade",
    }),
    title: z.string().min(1).max(200),
    description: z.string().max(10_000),
    status: z.enum(["pending", "accepted", "rejected"]).meta({ mode: "text" }),
    /**
     * Attachment file ids (uploaded via `POST /campaigns/:id/petitions/attachments`).
     * Stored as `uuid[]` mirroring `quests.attachments`.
     */
    attachments: db.default(z.array(z.uuid()), []),
    /**
     * Free-form tags. The `key=value` convention is documentation, not law —
     * common keys: `type=bug|feature`, `host=lore.alepha.dev`, `path=/foo`,
     * `severity=high`. Used for inbox filtering and reporting context.
     */
    tags: db.default(z.array(z.string().max(100)).max(20), []),
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
    source: petitionSourceSchema.optional(),
  }),
  indexes: [
    { columns: ["campaignId", "status", "deletedAt"] },
    { columns: ["campaignId", "createdAt"] },
    { columns: ["campaignId", "shortId"], unique: true },
    { columns: ["reporterUserId", "createdAt"] },
  ],
});

export type Petition = Static<typeof petitions.schema>;
export type PetitionInsert = Static<typeof petitions.insertSchema>;
