import { type Static, t } from "alepha";
import { $entity, db } from "alepha/orm";
import { campaigns } from "./campaigns.ts";
import { users } from "./users.ts";

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
    createdAt: db.createdAt(),
    deletedAt: db.deletedAt(),
    campaignId: db.ref(t.integer(), () => campaigns.cols.id, {
      onDelete: "cascade",
    }),
    reporterUserId: db.ref(t.uuid(), () => users.cols.id, {
      onDelete: "cascade",
    }),
    title: t.string({ minLength: 1, maxLength: 200 }),
    description: t.string({ maxLength: 10_000 }),
    reportType: t.enum(["bug", "feature"], { mode: "text" }),
    status: t.enum(["pending", "accepted", "rejected"], { mode: "text" }),
    /**
     * Attachment file ids (uploaded via `POST /campaigns/:id/petitions/attachments`).
     * Stored as `uuid[]` mirroring `quests.attachments`.
     */
    attachments: db.default(t.array(t.uuid()), []),
    /**
     * Free-form metadata captured at submission time (path, url, etc).
     * Kept as JSON so the schema can evolve without migrations.
     */
    context: db.default(
      t.object({
        url: t.optional(t.string({ maxLength: 2000 })),
        path: t.optional(t.string({ maxLength: 2000 })),
      }),
      {},
    ),
  }),
  indexes: [
    { columns: ["campaignId", "status", "deletedAt"] },
    { columns: ["campaignId", "createdAt"] },
    { columns: ["reporterUserId", "createdAt"] },
  ],
});

export type Petition = Static<typeof petitions.schema>;
export type PetitionInsert = Static<typeof petitions.insertSchema>;
